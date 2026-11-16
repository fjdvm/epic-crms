import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { structuredOutput } from "@/lib/ai/structured";

function model(text: string) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 10, text: 10, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}
const schema = z.object({ summary: z.string().min(1) });

describe("schema-checked AI output", () => {
  it("returns Groq's checked output without using Gemini", async () => {
    const gemini = new MockLanguageModelV4({ doGenerate: async () => { throw new Error("must not run"); } });
    expect(await structuredOutput({ schema, system: "Summarise", prompt: "A leaking pouch", models: [
      { name: "groq", model: model('{"summary":"A pouch leaks."}') }, { name: "gemini", model: gemini },
    ] })).toEqual({ ok: true, model: "groq", output: { summary: "A pouch leaks." } });
    expect(gemini.doGenerateCalls).toHaveLength(0);
  });
  it("uses Gemini when Groq returns output outside the schema", async () => {
    expect(await structuredOutput({ schema, system: "Summarise", prompt: "A leaking pouch", models: [
      { name: "groq", model: model('{"summary":42}') },
      { name: "gemini", model: model('{"summary":"A pouch leaks."}') },
    ] })).toEqual({ ok: true, model: "gemini", output: { summary: "A pouch leaks." } });
  });
  it("reports missing keys and exhausted providers without throwing", async () => {
    expect(await structuredOutput({ schema, system: "S", prompt: "P", models: [] })).toEqual({ ok: false, reason: "no-keys" });
    expect(await structuredOutput({ schema, system: "S", prompt: "P", models: [
      { name: "groq", model: new MockLanguageModelV4({ doGenerate: async () => { throw new Error("down"); } }) },
      { name: "gemini", model: model('{"wrong":"shape"}') },
    ] })).toEqual({ ok: false, reason: "model-failed" });
  });
});
