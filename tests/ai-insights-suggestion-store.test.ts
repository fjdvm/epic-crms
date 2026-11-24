import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { decideSuggestion, explainSuggestion, loadSuggestions } from "@/features/ai-insights/suggestion-store";
import type { SuggestionInputs } from "@/features/ai-insights/suggestions";
import * as structured from "@/lib/ai/structured";
import type { AuditEvent } from "@/lib/audit-trail";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const now = new Date("2026-11-25T08:00:00Z");
const person = (role: string, id = "s1") => ({ id, name: "Rhea", username: "rhea", email: "rhea@example.com", role });
const manager = person("CREOMS Manager");
const ceo = person("CEO", "s2");
const admin = person("Admin", "a1");
const modules = ["Customer Profiles", "Payments"];
let loyal = 5;
const inputs = async (): Promise<SuggestionInputs> => ({ customers: { loyalAtRisk: loyal } as SuggestionInputs["customers"] });
const sources = () => ({ source: db.sql, crms: db.sql, inputs });
const models = () => [{ name: "m", model: {} as never }];
let spy: ReturnType<typeof vi.spyOn>;
let audited: AuditEvent[];
const audit = async (event: AuditEvent) => { audited.push(event); };

beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql.unsafe(readFileSync("docs/db/crms-ai-insights.sql", "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  vi.restoreAllMocks();
  spy = vi.spyOn(structured, "structuredOutput");
  audited = [];
  loyal = 5;
  await db.sql`truncate crms.ai_insight_decisions, crms.ai_insight_notes`;
});

describe("suggestion decisions", () => {
  it("lists suggestions only from Modules the person holds", async () => {
    expect((await loadSuggestions(sources(), manager, modules, now)).map((s) => s.key)).toEqual(["loyal-at-risk"]);
    expect(await loadSuggestions(sources(), manager, ["Payments"], now)).toEqual([]);
  });

  it("records a Manager's dismissal with their name in the Audit Logs, and hides it for them only until it gets worse", async () => {
    expect(await decideSuggestion(sources(), audit, manager, modules, "loyal-at-risk", { customers: 5 }, "dismissed", now)).toEqual({ ok: true });
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({ action: "ai_insight.dismissed", actor: { id: "s1", display_name: "Rhea" }, target: { id: "loyal-at-risk" } });
    expect(audited[0].description).toContain("Rhea dismissed the AI Insights suggestion");
    const [row] = await db.sql`select staff_name, decision, numbers from crms.ai_insight_decisions`;
    expect(row).toEqual({ staff_name: "Rhea", decision: "dismissed", numbers: { customers: 5 } });

    expect(await loadSuggestions(sources(), manager, modules, now)).toEqual([]);
    expect(await loadSuggestions(sources(), ceo, modules, now)).toHaveLength(1);
    loyal = 6;
    expect(await loadSuggestions(sources(), manager, modules, now)).toHaveLength(1);
  });

  it("returns where to go when a CEO accepts", async () => {
    expect(await decideSuggestion(sources(), audit, ceo, modules, "loyal-at-risk", { customers: 5 }, "accepted", now))
      .toEqual({ ok: true, href: "/customer-profiles?stage=at-risk" });
    expect(audited[0].action).toBe("ai_insight.accepted");
  });

  it("refuses Admin and changed figures with a reason, saving nothing", async () => {
    expect(await decideSuggestion(sources(), audit, admin, modules, "loyal-at-risk", { customers: 5 }, "dismissed", now))
      .toEqual({ ok: false, reason: "Your Role can only view suggestions." });
    expect(await decideSuggestion(sources(), audit, manager, modules, "loyal-at-risk", { customers: 4 }, "dismissed", now))
      .toEqual({ ok: false, reason: "This suggestion changed or no longer applies. Reload the page to see the latest." });
    expect(await decideSuggestion(sources(), audit, manager, modules, "no-such", { customers: 5 }, "dismissed", now)).toMatchObject({ ok: false });
    expect(audited).toEqual([]);
    expect(await db.sql`select * from crms.ai_insight_decisions`).toHaveLength(0);
  });
});

describe("why it matters", () => {
  it("is written once from the suggestion's own sentence and numbers, kept, and shown with it", async () => {
    spy.mockResolvedValue({ ok: true, model: "m", output: { why: "5 loyal buyers lost means repeat sales lost." } });
    expect(await explainSuggestion(sources(), manager, modules, "loyal-at-risk", models, now)).toBe("5 loyal buyers lost means repeat sales lost.");
    expect(await explainSuggestion(sources(), manager, modules, "loyal-at-risk", models, now)).toBe("5 loyal buyers lost means repeat sales lost.");
    expect(spy).toHaveBeenCalledTimes(1);
    const [row] = await db.sql`select sent_text, numbers from crms.ai_insight_notes`;
    expect(row.sent_text).toContain("customers=5");
    expect((await loadSuggestions(sources(), manager, modules, now))[0].why).toBe("5 loyal buyers lost means repeat sales lost.");
    loyal = 7;
    expect((await loadSuggestions(sources(), manager, modules, now))[0].why).toBeNull();
  });

  it("is never asked for by Admin, and a sentence quoting a number not in the suggestion is thrown away", async () => {
    spy.mockResolvedValue({ ok: true, model: "m", output: { why: "This could cost ₱90,000." } });
    expect(await explainSuggestion(sources(), admin, modules, "loyal-at-risk", models, now)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(await explainSuggestion(sources(), manager, modules, "loyal-at-risk", models, now)).toBeNull();
    expect(await db.sql`select * from crms.ai_insight_notes`).toHaveLength(0);
  });
});
