import { describe, expect, it, vi } from "vitest";

import { configuredClients, geminiClient, groqClient, parseSentiment, parseTopProduct } from "@/features/feedback/sentiment-clients";

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

describe("parseTopProduct", () => {
  it("reads the product and reason from a JSON reply, even inside a code fence", () => {
    expect(parseTopProduct('```json\n{"product": "Halaya Smooth", "reason": "Rich and smooth."}\n```')).toEqual({
      product: "Halaya Smooth",
      reason: "Rich and smooth.",
    });
  });

  it("rejects a reply that is not JSON or lacks either field, so the next model is tried", () => {
    expect(() => parseTopProduct("Halaya Smooth")).toThrow();
    expect(() => parseTopProduct('{"product": "Halaya Smooth"}')).toThrow();
    expect(() => parseTopProduct('{"product": "", "reason": "x"}')).toThrow();
    expect(() => parseTopProduct(undefined)).toThrow();
  });
});

const CANDIDATES = [{ product: "Halaya Smooth", feedbackCount: 5, feedback: [{ rating: 5, comment: "So creamy" }] }];

describe("groqClient", () => {
  it("sends the Feedback to Groq with its key and model and reads the label", async () => {
    const fetcher = vi.fn(async () => json({ choices: [{ message: { content: "negative" } }] }));
    const client = groqClient({ apiKey: "groq-key", model: "groq-4", fetcher: fetcher as unknown as typeof fetch });

    expect(await client.classify({ comment: "Too sweet", rating: 2 })).toBe("negative");

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer groq-key");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "groq-4" });
    expect(init.body).toContain("Too sweet");
  });

  it("throws when Groq refuses", async () => {
    const client = groqClient({ apiKey: "k", model: "m", fetcher: (async () => json({}, 429)) as unknown as typeof fetch });

    await expect(client.classify({ comment: "x", rating: 3 })).rejects.toThrow(/429/);
  });
});

describe("choosing the Top product", () => {
  it("sends each candidate's Feedback to Groq and reads its choice", async () => {
    const fetcher = vi.fn(async () =>
      json({ choices: [{ message: { content: '{"product": "Halaya Smooth", "reason": "Customers call it creamy."}' } }] }),
    );
    const client = groqClient({ apiKey: "k", model: "groq-4", fetcher: fetcher as unknown as typeof fetch });

    expect(await client.pickTopProduct(CANDIDATES)).toEqual({ product: "Halaya Smooth", reason: "Customers call it creamy." });

    const body = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string;
    expect(body).toContain("Product: Halaya Smooth (5 feedback)");
    expect(body).toContain("5 stars: So creamy");
  });

  it("reads Gemini's choice, and throws when Gemini refuses", async () => {
    const answer = json({ candidates: [{ content: { parts: [{ text: '{"product": "Halaya Smooth", "reason": "Creamy."}' }] } }] });
    const gemini = geminiClient({ apiKey: "k", model: "m", fetcher: (async () => answer) as unknown as typeof fetch });

    expect(await gemini.pickTopProduct(CANDIDATES)).toMatchObject({ product: "Halaya Smooth" });

    const refusing = geminiClient({ apiKey: "k", model: "m", fetcher: (async () => json({}, 503)) as unknown as typeof fetch });
    await expect(refusing.pickTopProduct(CANDIDATES)).rejects.toThrow(/503/);
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
    const { groq, gemini } = configuredClients({ GROQ_API_KEY: "k", GROQ_MODEL: "groq-4", GOOGLE_GENERATIVE_AI_API_KEY: "", GEMINI_MODEL: "g" });

    expect(groq?.model).toBe("groq-4");
    expect(gemini).toBeNull();
  });
});
