"use server";

import { revalidatePath } from "next/cache";

import { writeAuditEvent } from "@/lib/gateway";
import { feedbackWriterDatabase } from "@/lib/feedback-db";
import { FEEDBACK_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

import { runAnalysis, type AnalysisResult } from "./analysis";
import { configuredClients } from "./sentiment-clients";

export type AnalyzeOutcome = AnalysisResult | { status: "unavailable" };

/**
 * The Analyze button: the same run as the schedule, started by the Staff member, who is named in the
 * audit event. Server actions are public endpoints, so it proves the Staff member holds the Feedback Module.
 */
export async function analyze(): Promise<AnalyzeOutcome> {
  const staff = await requireModule(FEEDBACK_MODULE);

  try {
    const result = await runAnalysis({
      sql: feedbackWriterDatabase(),
      ...configuredClients(),
      actor: { kind: "staff", id: staff.username, name: staff.name },
      audit: writeAuditEvent,
      cooldown: true,
    });

    revalidatePath("/feedback");

    return result;
  } catch (error) {
    console.error("Feedback analysis could not run", error);

    return { status: "unavailable" };
  }
}
