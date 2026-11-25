import { createHash } from "node:crypto";

import { recordAudit, staffAuditActor } from "@/lib/audit-trail";
import { gatewayAuditTrail } from "@/lib/gateway";
import { FEEDBACK_MODULE } from "@/lib/portal/config";

/**
 * Audit Events for the Feedback gaps (#750): a refused or failed Analyze or product-suggestion attempt. CREOMS has no
 * Feedback reply or review publish/hide action yet (those live in the storefront); when they are built they join here.
 * Metadata holds the reason (and the cooldown end) only, never Feedback text or Customer details. Best effort:
 * recordAudit never throws and never blocks.
 */
export type FeedbackAttempt = "feedback.analysis_run" | "feedback.product_advice";

const TARGETS: Record<FeedbackAttempt, { type: string; id: string; display_name: string; attempt: string }> = {
  "feedback.analysis_run": { type: "feedback-analysis", id: "analysis", display_name: "Feedback analysis", attempt: "run Feedback analysis" },
  "feedback.product_advice": { type: "feedback-product-advice", id: "advice", display_name: "Feedback product suggestions", attempt: "ask for Feedback product suggestions" },
};

const digest = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/**
 * Same action name as the success event, outcome `failure`, the reason in the description and metadata. The identity is
 * per person, action and reason (plus the cooldown end when there is one), so a replayed refusal records once.
 */
export async function auditFeedbackDenied(
  staff: { id: string; name: string },
  action: FeedbackAttempt,
  reason: string,
  metadata: Record<string, unknown> = {},
) {
  const { attempt, ...target } = TARGETS[action];

  await recordAudit(gatewayAuditTrail, {
    module: FEEDBACK_MODULE,
    action,
    outcome: "failure",
    actor: staffAuditActor(staff),
    target,
    description: `${staff.name} could not ${attempt}: ${reason}`,
    metadata: { ...metadata, reason },
    occurred_at: new Date().toISOString(),
    operationId: `feedback:${action}:denied:${staff.id}:${digest(`${reason}\n${JSON.stringify(metadata)}`)}`,
  });
}
