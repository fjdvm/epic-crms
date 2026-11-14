import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const script = path.join(repoRoot, "scripts/deploy/render-container-app.py");

// Set at deploy time by the workflow, so they are not read from GitHub secrets.
const fixedKeys = ["PORTAL_URL", "PORTAL_SYSTEM_NAME", "CREOMS_APP_URL", "CREOMS_STOREFRONT_URL", "CREOMS_GATEWAY_URL"];

function exampleKeys() {
  const example = readFileSync(path.join(repoRoot, ".env.example"), "utf8");
  return [...example.matchAll(/^([A-Z_]+)=/gm)].map((match) => match[1]);
}

function secretKeys() {
  return exampleKeys().filter((key) => !fixedKeys.includes(key) && key !== "CREOMS_UPLOAD_SECRET" && key !== "PORTAL_SYSTEM_SECRET");
}

describe("render-container-app.py", () => {
  let dir: string;
  let output: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "render-creoms-"));
    output = path.join(dir, "manifest.json");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function render(secrets: Record<string, string>, overrides: Record<string, string | undefined> = {}) {
    const env: Record<string, string | undefined> = {
      PATH: process.env.PATH,
      DEPLOY_SECRETS: JSON.stringify({ GHCR_PULL_TOKEN: "pull", ...secrets }),
      CONTAINER_ENVIRONMENT_ID: "/subscriptions/sub/environments/cae",
      GHCR_USERNAME: "fjdvm",
      REVISION_SUFFIX: "gh-1-1",
      CREOMS_IMAGE: "ghcr.io/fjdvm/epic-crms@sha256:abc",
      CREOMS_PUBLIC_URL: "https://creoms.buildwrite.me",
      ...overrides,
    };
    return spawnSync("python3", ["-I", script, output], { cwd: repoRoot, env: env as NodeJS.ProcessEnv, encoding: "utf8" });
  }

  const allSecrets = () => Object.fromEntries(secretKeys().map((key) => [key, `value-of-${key}`]));
  const manifest = () => JSON.parse(readFileSync(output, "utf8"));

  it("keeps one replica running with a small maximum, 0.5 vCPU and 1 GiB", () => {
    expect(render(allSecrets()).status).toBe(0);
    const { template } = manifest().properties;

    expect(template.scale).toEqual({ minReplicas: 1, maxReplicas: 2 });
    expect(template.containers[0].resources).toEqual({ cpu: 0.5, memory: "1Gi" });
  });

  it("probes the health route", () => {
    render(allSecrets());
    const probes = manifest().properties.template.containers[0].probes;

    expect(probes.map((probe: { type: string }) => probe.type).sort()).toEqual(["Liveness", "Readiness", "Startup"]);
    for (const probe of probes) expect(probe.httpGet.path).toBe("/api/health");
  });

  it("gives every .env.example key to the container, secrets by reference and public values in the clear", () => {
    render(allSecrets());
    const { template, configuration } = manifest().properties;
    const env = Object.fromEntries(template.containers[0].env.map((entry: { name: string }) => [entry.name, entry]));
    const secretNames = configuration.secrets.map((secret: { name: string }) => secret.name);

    for (const key of secretKeys()) {
      expect(env[key].secretRef).toBe(key.toLowerCase().replaceAll("_", "-"));
      expect(secretNames).toContain(env[key].secretRef);
    }
    expect(env.CREOMS_APP_URL.value).toBe("https://creoms.buildwrite.me");
    expect(env.PORTAL_URL.value).toBe("https://portal.buildwrite.me");
    expect(env.CREOMS_STOREFRONT_URL.value).toBe("https://shop.buildwrite.me");
    expect(env.CREOMS_GATEWAY_URL.value).toBe("https://api.buildwrite.me");
  });

  it("names every missing secret and writes nothing", () => {
    const { CREOMS_DATABASE_URL: _a, GROQ_API_KEY: _b, ...rest } = allSecrets();
    const result = render(rest);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("CREOMS_DATABASE_URL");
    expect(result.stderr).toContain("GROQ_API_KEY");
    expect(existsSync(output)).toBe(false);
  });

  it("uses a placeholder for the Portal System secret until the real one is set, and the real one afterwards", () => {
    render(allSecrets());
    const placeholder = manifest().properties.configuration.secrets.find((s: { name: string }) => s.name === "portal-system-secret");
    expect(placeholder.value).toMatch(/pending/);

    rmSync(output);
    render({ ...allSecrets(), PORTAL_SYSTEM_SECRET: "the-real-one" });
    const real = manifest().properties.configuration.secrets.find((s: { name: string }) => s.name === "portal-system-secret");
    expect(real.value).toBe("the-real-one");
  });

  it("omits the optional upload secret when unset", () => {
    render(allSecrets());

    const names = manifest().properties.template.containers[0].env.map((entry: { name: string }) => entry.name);
    expect(names).not.toContain("CREOMS_UPLOAD_SECRET");
  });

  it("keeps an already-bound custom domain so a deploy never unbinds it", () => {
    const customDomains = [{ name: "creoms.buildwrite.me", bindingType: "SniEnabled", certificateId: "/cert/1" }];
    render(allSecrets(), { EXISTING_CUSTOM_DOMAINS: JSON.stringify(customDomains) });

    expect(manifest().properties.configuration.ingress.customDomains).toEqual(customDomains);
  });

  it("declares no custom domain before one is bound", () => {
    render(allSecrets());

    expect(manifest().properties.configuration.ingress.customDomains ?? []).toEqual([]);
  });
});
