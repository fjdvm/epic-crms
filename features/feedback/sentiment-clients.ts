import { SENTIMENTS, type ModelClient, type Sentiment } from "./analysis";
import type { TopProductCandidate } from "./top-product";

const PROMPT =
  "You label customer feedback about an ecommerce order. Reply with exactly one word: positive, neutral or negative. " +
  "Judge the comment; if there is none, judge by the star rating (1 to 2 negative, 3 neutral, 4 to 5 positive).";

const TOP_PRODUCT_PROMPT =
  "You choose the product customers like most at a small food store, from their feedback. Each product lists the " +
  "star rating (1 to 5) and comment of every order that contained it; an order with several products is listed under " +
  'each. Reply with JSON only: {"product": "<the product name exactly as listed>", "reason": "<one short sentence on ' +
  'why customers like it, under 120 characters>"}.';

function describe({ comment, rating }: { comment: string; rating: number }): string {
  return `Stars: ${rating} out of 5\nComment: ${comment.trim() || "(none)"}`;
}

function describeCandidates(candidates: TopProductCandidate[]): string {
  return candidates
    .map((c) =>
      [
        `Product: ${c.product} (${c.feedbackCount} feedback)`,
        ...c.feedback.map((f) => `- ${f.rating} stars: ${f.comment.trim().replace(/\s+/g, " ") || "(no comment)"}`),
      ].join("\n"),
    )
    .join("\n\n");
}

/** The one-word label in a model's reply, or a throw when it is not one of the three. */
export function parseSentiment(reply: unknown): Sentiment {
  const word = typeof reply === "string" ? reply.trim().toLowerCase().replace(/[^a-z]/g, "") : "";
  const found = SENTIMENTS.find((s) => s === word);

  if (!found) throw new Error(`The model replied with "${String(reply)}", not a Sentiment`);

  return found;
}

/** The product and reason in a model's JSON reply, even when wrapped in a code fence; a throw otherwise. */
export function parseTopProduct(reply: unknown): { product: string; reason: string } {
  const text = typeof reply === "string" ? reply : "";
  const object = text.match(/\{[\s\S]*\}/)?.[0];

  let parsed: unknown = null;

  try {
    if (object) parsed = JSON.parse(object);
  } catch {
    // Not JSON: rejected below.
  }

  const { product, reason } = (parsed ?? {}) as { product?: unknown; reason?: unknown };

  if (typeof product !== "string" || typeof reason !== "string" || !product.trim() || !reason.trim()) {
    throw new Error(`The model replied with "${String(reply)}", not a Top product`);
  }

  return { product, reason };
}

interface ClientOptions {
  apiKey: string;
  model: string;
  fetcher?: typeof fetch;
}

/** A model, from one function that sends a system and a user message and returns the reply's text. */
function modelClient(model: string, complete: (system: string, user: string) => Promise<unknown>): ModelClient {
  return {
    model,
    async classify(feedback) {
      return parseSentiment(await complete(PROMPT, describe(feedback)));
    },
    async pickTopProduct(candidates) {
      return parseTopProduct(await complete(TOP_PRODUCT_PROMPT, describeCandidates(candidates)));
    },
  };
}

/** Groq, through Groq's OpenAI-compatible chat API. */
export function groqClient({ apiKey, model, fetcher = fetch }: ClientOptions): ModelClient {
  return modelClient(model, async (system, user) => {
    const response = await fetcher("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) throw new Error(`Groq refused the request: ${response.status}`);

    const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };

    return body.choices?.[0]?.message?.content;
  });
}

/** Gemini, through the Generative Language API. */
export function geminiClient({ apiKey, model, fetcher = fetch }: ClientOptions): ModelClient {
  return modelClient(model, async (system, user) => {
    const response = await fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0 },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );

    if (!response.ok) throw new Error(`Gemini refused the request: ${response.status}`);

    const body = (await response.json()) as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] };

    return body.candidates?.[0]?.content?.parts?.[0]?.text;
  });
}

/** The clients whose key is set in the environment; a missing key gives null so the run can say "AI keys not set". */
export function configuredClients(env: Record<string, string | undefined> = process.env): {
  groq: ModelClient | null;
  gemini: ModelClient | null;
} {
  return {
    groq: env.GROQ_API_KEY && env.GROQ_MODEL ? groqClient({ apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL }) : null,
    gemini:
      env.GOOGLE_GENERATIVE_AI_API_KEY && env.GEMINI_MODEL ? geminiClient({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY, model: env.GEMINI_MODEL }) : null,
  };
}
