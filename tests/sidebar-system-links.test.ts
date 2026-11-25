import { afterEach, describe, expect, it, vi } from "vitest";

const links = [
  ["Enterprise Portal", "NEXT_PUBLIC_HOST_URL", "https://portal.buildwrite.me/"],
  ["Customer Relation and Ecommerce Ordering Management System", "NEXT_PUBLIC_CRMS_URL", "https://creoms.buildwrite.me/"],
  ["Human Resource Management System", "NEXT_PUBLIC_HRMS_URL", "https://hrms.buildwrite.me/"],
  ["Point of Sale System", "NEXT_PUBLIC_POS_URL", "https://web-pos-alpha-vert.vercel.app/"],
  ["Inventory Management System", "NEXT_PUBLIC_IMS_URL", "https://br-sims.vercel.app/"],
] as const;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("sidebar system links", () => {
  it.each(links)("%s uses its default when its environment value is absent", async (name, env, expected) => {
    vi.stubEnv(env, undefined);
    vi.resetModules();
    const { systems } = await import("@/components/layout/sidebar-nav");

    expect(systems.find((system) => system.fullName === name)?.url).toBe(expected);
  });

  it.each(links)("%s uses its configured environment value", async (name, env) => {
    vi.stubEnv(env, "https://configured.example.test/");
    vi.resetModules();
    const { systems } = await import("@/components/layout/sidebar-nav");

    expect(systems.find((system) => system.fullName === name)?.url).toBe("https://configured.example.test/");
  });
});
