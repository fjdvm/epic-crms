import { createGroq } from "@ai-sdk/groq";
import { createGoogle } from "@ai-sdk/google";
import { generateText, Output, type LanguageModel } from "ai";
import type { z } from "zod";

export interface StructuredModel {
  name: string;
  model: LanguageModel;
}

/** Direct providers only, preserving the existing Groq → Gemini order and environment names. */
export function configuredStructuredModels(env: Record<string, string | undefined> = process.env): StructuredModel[] {
  const models: StructuredModel[] = [];
  if (env.GROQ_API_KEY && env.GROQ_MODEL)
    models.push({ name: env.GROQ_MODEL, model: createGroq({ apiKey: env.GROQ_API_KEY })(env.GROQ_MODEL) });
  if (env.GOOGLE_GENERATIVE_AI_API_KEY && env.GEMINI_MODEL)
    models.push({ name: env.GEMINI_MODEL, model: createGoogle({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })(env.GEMINI_MODEL) });
  return models;
}

/** Each provider gets one bounded attempt; invalid structured output also falls back. Never log prompts or provider errors. */
export async function structuredOutput<T>({ schema, system, prompt, models, maxOutputTokens = 600, image, timeoutMs = 20_000 }: {
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  models: StructuredModel[];
  maxOutputTokens?: number;
  /** One image sent beside the prompt, for a model that reads pictures. */
  image?: Uint8Array;
  timeoutMs?: number;
}): Promise<{ ok: true; output: T; model: string } | { ok: false; reason: "no-keys" | "model-failed" }> {
  for (const { name, model } of models) {
    try {
      const { output } = await generateText({
        model, system,
        ...(image
          ? { messages: [{ role: "user" as const, content: [{ type: "text" as const, text: prompt }, { type: "file" as const, mediaType: "image/*" as const, data: image }] }] }
          : { prompt }),
        output: Output.object({ schema }),
        temperature: 0,
        maxOutputTokens,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(timeoutMs),
      });
      return { ok: true, model: name, output };
    } catch {
      // Failure is optional assistance being unavailable, never a Ticket failure.
    }
  }
  return { ok: false, reason: models.length ? "model-failed" : "no-keys" };
}
