import { createGroq } from "@ai-sdk/groq";
import { createGoogle } from "@ai-sdk/google";
import { z } from "zod";
import { configuredStructuredModels, structuredOutput, type StructuredModel } from "@/lib/ai/structured";
import { SENTIMENTS, type ModelClient, type Sentiment } from "./analysis";
import type { TopProductCandidate } from "./top-product";

const PROMPT =
  "You label customer feedback about an ecommerce order. Return the sentiment as positive, neutral or negative. " +
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

export const sentimentSchema = z.object({ sentiment: z.enum(SENTIMENTS) });
export const topProductSchema = z.object({
  product: z.string().refine((value) => value.trim().length > 0),
  reason: z.string().refine((value) => value.trim().length > 0),
});

interface ClientOptions {
  apiKey: string;
  model: string;
  fetcher?: typeof fetch;
}

/** The completer seam accepts a schema; SDK providers own request encoding and reply parsing. */
export type Completer = (system: string, user: string, schema: z.ZodType) => Promise<unknown>;

function sdkCompleter(model: StructuredModel): Completer {
  return async (system, prompt, schema) => {
    const result = await structuredOutput({ system, prompt, schema, models: [model] });
    if (!result.ok) throw new Error("AI model unavailable");
    return result.output;
  };
}

function modelClient(model: string, complete: Completer): ModelClient {
  return {
    model,
    async classify(feedback): Promise<Sentiment> {
      return sentimentSchema.parse(await complete(PROMPT, describe(feedback), sentimentSchema)).sentiment;
    },
    async pickTopProduct(candidates) {
      return topProductSchema.parse(await complete(TOP_PRODUCT_PROMPT, describeCandidates(candidates), topProductSchema));
    },
  };
}

export function groqClient({ apiKey, model, fetcher }: ClientOptions): ModelClient {
  return modelClient(model, sdkCompleter({ name: model, model: createGroq({ apiKey, fetch: fetcher })(model) }));
}

export function geminiClient({ apiKey, model, fetcher }: ClientOptions): ModelClient {
  return modelClient(model, sdkCompleter({ name: model, model: createGoogle({ apiKey, fetch: fetcher })(model) }));
}

/** Keep the existing per-feature fallback loops and missing-key results. */
export function configuredCompleters(env: Record<string, string | undefined> = process.env): { model: string; complete: Completer }[] {
  return configuredStructuredModels(env).map((model) => ({ model: model.name, complete: sdkCompleter(model) }));
}

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
