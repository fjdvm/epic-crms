"use server";

import { revalidatePath } from "next/cache";

import { recordAudit, staffAuditActor } from "@/lib/audit-trail";
import { crmsDatabase } from "@/lib/crms-db";
import { ticketsDatabase } from "@/lib/tickets-db";

import { gatewayAuditTrail } from "@/lib/gateway";
import { feedbackWriterDatabase } from "@/lib/feedback-db";
import { FEEDBACK_MODULE } from "@/lib/portal/config";
import { canWork } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";

import { runAnalysis, type AnalysisResult } from "./analysis";
import { openProductAdvice, type ProductAdviceResponse } from "./product-advice";
import { configuredClients } from "./sentiment-clients";

export type AnalyzeOutcome = AnalysisResult | { status: "unavailable" | "read-only" };

/**
 * The Analyze button: the same run as the schedule, started by the Staff member, who is named in the
 * audit event. Server actions are public endpoints, so it proves the Staff member holds the Feedback Module.
 */
export async function analyze(): Promise<AnalyzeOutcome> {
  const staff = await requireModule(FEEDBACK_MODULE);

  if (!canWork(staff)) return { status: "read-only" };
  try {
    const result = await runAnalysis({
      sql: feedbackWriterDatabase(),
      ...configuredClients(),
      actor: { kind: "staff", id: staff.id, name: staff.name },
      audit: gatewayAuditTrail,
      cooldown: true,
    });

    revalidatePath("/feedback");

    return result;
  } catch (error) {
    console.error("Feedback analysis could not run", error);

    return { status: "unavailable" };
  }
}

/** The Analyze drawer: ranks the products and asks for suggestions. Staff and Managers only; the person is named in the audit event. */
export async function generateProductAdvice(): Promise<ProductAdviceResponse> {
  const staff = await requireModule(FEEDBACK_MODULE);

  if (!canWork(staff)) return { result: null, unavailable: true, refused: "read-only" };

  const response = await openProductAdvice({ tickets: ticketsDatabase(), crms: crmsDatabase() }, staff, { generate: true });

  if (response.result) {
    await recordAudit(gatewayAuditTrail, {
      module: "Feedback",
      action: "feedback.product_advice",
      outcome: response.result.adviceUnavailable ? "failure" : "success",
      actor: staffAuditActor(staff),
      target: { type: "feedback-product-advice", id: response.result.createdAt, display_name: "Feedback product suggestions" },
      description: `${staff.name} asked for AI suggestions on ${response.result.products.length} ranked products.`,
      occurred_at: response.result.createdAt,
      metadata: { products: response.result.products.length, model: response.result.model },
      operationId: `feedback.product_advice:${response.result.createdAt}`,
    });
  }

  return response;
}

/** The last saved suggestions, for anyone who can open Feedback. Never causes a model call. */
export async function loadProductAdvice(): Promise<ProductAdviceResponse> {
  const staff = await requireModule(FEEDBACK_MODULE);

  return openProductAdvice({ tickets: ticketsDatabase(), crms: crmsDatabase() }, staff, { generate: false });
}
