import { describe, expect, it, vi } from "vitest";
import { suggestionSchema } from "@/features/tickets/suggest";
import { configuredClients, configuredCompleters, geminiClient, groqClient } from "@/features/feedback/sentiment-clients";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const groqReply = (text: string) => json({ id: "1", created: 1, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: text } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
const geminiReply = (text: string) => json({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } });
const candidates = [{ product: "Halaya Smooth", feedbackCount: 5, feedback: [{ rating: 5, comment: "So creamy" }] }];

describe("Feedback through SDK providers", () => {
  it("sends Feedback to Groq with its key and model and returns the Sentiment", async () => {
    const fetcher = vi.fn(async () => groqReply('{"sentiment":"negative"}'));
    const client = groqClient({ apiKey: "groq-key", model: "groq-4", fetcher });
    expect(await client.classify({ comment: "Too sweet", rating: 2 })).toBe("negative");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer groq-key");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "groq-4", temperature: 0, response_format: { type: "json_schema" } });
    expect(init.body).toContain("Too sweet");
  });
  it("sends each candidate's Feedback and returns the Top product", async () => {
    const fetcher = vi.fn(async () => groqReply('{"product":"Halaya Smooth","reason":"Creamy."}'));
    expect(await groqClient({ apiKey: "k", model: "m", fetcher }).pickTopProduct(candidates)).toEqual({ product: "Halaya Smooth", reason: "Creamy." });
    const body = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body;
    expect(body).toContain("Product: Halaya Smooth (5 feedback)");
    expect(body).toContain("5 stars: So creamy");
  });
  it("uses Gemini's key and endpoint and describes a blank comment by its stars", async () => {
    const fetcher = vi.fn(async () => geminiReply('{"sentiment":"neutral"}'));
    expect(await geminiClient({ apiKey: "g-key", model: "gemini-2.5-flash", fetcher }).classify({ comment: " ", rating: 3 })).toBe("neutral");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("/models/gemini-2.5-flash:generateContent");
    expect(new Headers(init.headers).get("x-goog-api-key")).toBe("g-key");
    expect(init.body).toContain("Stars: 3 out of 5");
  });
  it("reads Gemini's Top product", async () => {
    expect(await geminiClient({ apiKey: "k", model: "m", fetcher: async () => geminiReply('{"product":"Halaya Smooth","reason":"Creamy."}') }).pickTopProduct(candidates)).toEqual({ product: "Halaya Smooth", reason: "Creamy." });
  });
  it("rejects provider failures and invalid output so callers can fall back", async () => {
    for (const client of [groqClient({ apiKey: "k", model: "m", fetcher: async () => json({}, 429) }), geminiClient({ apiKey: "k", model: "m", fetcher: async () => json({}, 503) }), groqClient({ apiKey: "k", model: "m", fetcher: async () => groqReply('{"sentiment":"mixed"}') })]) {
      await expect(client.classify({ comment: "x", rating: 3 })).rejects.toThrow();
    }
    await expect(groqClient({ apiKey: "k", model: "m", fetcher: async () => groqReply('{"product":"","reason":"x"}') }).pickTopProduct(candidates)).rejects.toThrow();
  });
});

describe("configured models", () => {
  it("runs the Ticket completer through the shared schema-checked SDK helper", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => groqReply(JSON.stringify({
      category: "delivery issue", categoryReason: "Leak", priority: " HIGH ", priorityReason: "x".repeat(130),
    })));
    try {
      const [model] = configuredCompleters({ GROQ_API_KEY: "k", GROQ_MODEL: "groq" });
      expect(await model.complete("Triage this Ticket", "Leaking pouch", suggestionSchema)).toEqual({
        category: "Delivery Issue", categoryReason: "Leak", priority: "high", priorityReason: "x".repeat(120),
      });
    } finally {
      fetcher.mockRestore();
    }
  });
  it("builds only clients with a key and model, and keeps Groq before Gemini", () => {
    expect(configuredClients({ GROQ_API_KEY: "k", GROQ_MODEL: "groq", GEMINI_MODEL: "gemini" })).toMatchObject({ groq: { model: "groq" }, gemini: null });
    expect(configuredCompleters({ GROQ_API_KEY: "k", GROQ_MODEL: "groq", GOOGLE_GENERATIVE_AI_API_KEY: "g", GEMINI_MODEL: "gemini" }).map((m) => m.model)).toEqual(["groq", "gemini"]);
    expect(configuredCompleters({})).toEqual([]);
  });
});
