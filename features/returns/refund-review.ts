// What Staff must settle before they mark a Return Refunded (#615). Pure, so the screen and the server read the same rules.
import { rejudge, type ProofCorrection } from "@/features/orders/proof-read";
import { FIELDS, type Field, type Finding, type Findings } from "@/features/orders/proof-reader";

/** The refund proof and details Staff saved, before the Return is marked Refunded. */
export interface RefundDraft {
  returnId: number; fileId: string; amountInCentavos: number; expectedInCentavos: number; method: string; refundedOn: string;
  reference: string; deliveryFeeReason: string | null; savedByName: string; savedAt: Date;
}

/** How long a saved proof with no result yet counts as being read; after that the schedule has run or the read is treated as failed. */
const JUST_SAVED_MS = 2 * 60 * 1000;

export interface RefundReview {
  /** The Proof reader is still working on this proof. */
  reading: boolean;
  /** Details still flagged, with neither a correction that now matches nor a recorded decision to proceed. */
  unresolved: Field[];
}

/**
 * A flagged detail (Mismatch, Missing, Needs Review) must be corrected to a match or carry a recorded reason to proceed.
 * A read that failed shows Needs Review but never blocks, so Staff can finish by hand; the reminder to check the real
 * transfer still applies.
 */
export function reviewRefundProof(
  read: { status: "pending" | "reading" | "read" | "needs-review"; findings: Findings | null } | null,
  corrections: ProofCorrection[],
  /** When the proof was saved: a proof saved moments ago with no result yet is still being read, not unread. */
  savedAt?: Date,
  now: Date = new Date(),
): RefundReview {
  if (!read || read.status === "pending") return { reading: savedAt !== undefined && now.getTime() - savedAt.getTime() < JUST_SAVED_MS, unresolved: [] };
  if (read.status === "reading") return { reading: true, unresolved: [] };
  if (read.status === "needs-review" || !read.findings) return { reading: false, unresolved: [] };
  const unresolved = FIELDS.filter((field) => {
    const f = read.findings![field];
    const latest = corrections.findLast((c) => c.field === field);
    if (latest?.kind === "override") return false;
    const shown: Finding = latest?.kind === "correction" && latest.value ? rejudge(field, latest.value, f.expected) : f.finding;

    return shown !== "Match";
  });

  return { reading: false, unresolved };
}
