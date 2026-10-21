import { describe, expect, it, vi } from "vitest";

import { configuredClients, geminiClient, grokClient, parseSentiment } from "@/features/feedback/sentiment-clients";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("parseSentiment", () => {
  it("accepts a bare label in any case, with punctuation or whitespace", () => {
    expect(parseSentiment("Positive.")).toBe("positive");
    expect(parseSentiment("  NEGATIVE\n")).toBe("negative");
    expect(parseSentiment("neutral")).toBe("neutral");
  });

  it("rejects anything else, so the next model is tried", () => {
    expect(() => parseSentiment("mixed")).toThrow();
    expect(() => parseSentiment(undefined)).toThrow();
  });
});

describe("grokClient", () => {
  it("sends the Feedback to xAI with its key and model and reads the label", async () => {
    const fetcher = vi.fn(async () => json({ choices: [{ message: { content: "negative" } }] }));
    const client = grokClient({ apiKey: "xai-key", model: "grok-4", fetcher: fetcher as unknown as typeof fetch });

    expect(await client.classify({ comment: "Too sweet", rating: 2 })).toBe("negative");

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer xai-key");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "grok-4" });
    expect(init.body).toContain("Too sweet");
  });

  it("throws when xAI refuses", async () => {
    const client = grokClient({ apiKey: "k", model: "m", fetcher: (async () => json({}, 429)) as unknown as typeof fetch });

    await expect(client.classify({ comment: "x", rating: 3 })).rejects.toThrow(/429/);
  });
});

describe("geminiClient", () => {
  it("sends the Feedback to the model's endpoint with its key and reads the label", async () => {
    const fetcher = vi.fn(async () => json({ candidates: [{ content: { parts: [{ text: "Positive" }] } }] }));
    const client = geminiClient({ apiKey: "g-key", model: "gemini-2.5-flash", fetcher: fetcher as unknown as typeof fetch });

    expect(await client.classify({ comment: "Loved it", rating: 5 })).toBe("positive");

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/models/gemini-2.5-flash:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("g-key");
  });

  it("describes a blank comment by its stars", async () => {
    const fetcher = vi.fn(async () => json({ candidates: [{ content: { parts: [{ text: "neutral" }] } }] }));

    await geminiClient({ apiKey: "k", model: "m", fetcher: fetcher as unknown as typeof fetch }).classify({ comment: "  ", rating: 3 });

    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body).toContain("Stars: 3 out of 5");
  });
});

describe("configuredClients", () => {
  it("builds only the clients whose key and model are both set", () => {
    const { grok, gemini } = configuredClients({ GROK_API_KEY: "k", GROK_MODEL: "grok-4", GEMINI_API_KEY: "", GEMINI_MODEL: "g" });

    expect(grok?.model).toBe("grok-4");
    expect(gemini).toBeNull();
  });
});
