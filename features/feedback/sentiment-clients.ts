import { SENTIMENTS, type Sentiment, type SentimentClient } from "./analysis";

const PROMPT =
  "You label customer feedback about an ecommerce order. Reply with exactly one word: positive, neutral or negative. " +
  "Judge the comment; if there is none, judge by the star rating (1 to 2 negative, 3 neutral, 4 to 5 positive).";

function describe({ comment, rating }: { comment: string; rating: number }): string {
  return `Stars: ${rating} out of 5\nComment: ${comment.trim() || "(none)"}`;
}

/** The one-word label in a model's reply, or a throw when it is not one of the three. */
export function parseSentiment(reply: unknown): Sentiment {
  const word = typeof reply === "string" ? reply.trim().toLowerCase().replace(/[^a-z]/g, "") : "";
  const found = SENTIMENTS.find((s) => s === word);

  if (!found) throw new Error(`The model replied with "${String(reply)}", not a Sentiment`);

  return found;
}

interface ClientOptions {
  apiKey: string;
  model: string;
  fetcher?: typeof fetch;
}

/** Groq, through Groq's OpenAI-compatible chat API. */
export function groqClient({ apiKey, model, fetcher = fetch }: ClientOptions): SentimentClient {
  return {
    model,
    async classify(feedback) {
      const response = await fetcher("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            { role: "system", content: PROMPT },
            { role: "user", content: describe(feedback) },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      });

      if (!response.ok) throw new Error(`Groq refused the request: ${response.status}`);

      const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };

      return parseSentiment(body.choices?.[0]?.message?.content);
    },
  };
}

/** Gemini, through the Generative Language API. */
export function geminiClient({ apiKey, model, fetcher = fetch }: ClientOptions): SentimentClient {
  return {
    model,
    async classify(feedback) {
      const response = await fetcher(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: PROMPT }] },
            contents: [{ role: "user", parts: [{ text: describe(feedback) }] }],
            generationConfig: { temperature: 0 },
          }),
          signal: AbortSignal.timeout(20_000),
        },
      );

      if (!response.ok) throw new Error(`Gemini refused the request: ${response.status}`);

      const body = (await response.json()) as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] };

      return parseSentiment(body.candidates?.[0]?.content?.parts?.[0]?.text);
    },
  };
}

/** The clients whose key is set in the environment; a missing key gives null so the run can say "AI keys not set". */
export function configuredClients(env: Record<string, string | undefined> = process.env): {
  groq: SentimentClient | null;
  gemini: SentimentClient | null;
} {
  return {
    groq: env.GROQ_API_KEY && env.GROQ_MODEL ? groqClient({ apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL }) : null,
    gemini:
      env.GOOGLE_GENERATIVE_AI_API_KEY && env.GEMINI_MODEL ? geminiClient({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY, model: env.GEMINI_MODEL }) : null,
  };
}
