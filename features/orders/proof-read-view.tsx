import { Check, CircleHelp, TriangleAlert, X } from "lucide-react";
import Link from "next/link";

import { formatPesos } from "@/features/customer-profiles/format";
import type { ShopRole } from "@/lib/portal/roles";
import type { Field, Finding } from "./proof-reader";
import { rejudge, type ProofCorrection, type ProofReadView } from "./proof-read";
import { ProofReadControls } from "./proof-read-controls";

const LABEL: Record<Field, string> = {
  amount: "Amount", date: "Date", reference: "Reference no.", recipient: "Sent to", accountNumber: "Account number",
};
const ORDER: Field[] = ["amount", "date", "reference", "recipient", "accountNumber"];

const STYLE: Record<Finding, { badge: string; Icon: typeof Check }> = {
  Match: { badge: "bg-[#dcfce7] text-[#15803d]", Icon: Check },
  Mismatch: { badge: "bg-[#fee2e2] text-[#b91c1c]", Icon: X },
  Missing: { badge: "bg-[#fdf1d8] text-[#8a5a00]", Icon: TriangleAlert },
  "Needs Review": { badge: "bg-[#fdf1d8] text-[#8a5a00]", Icon: CircleHelp },
};

/** The reader keeps the amount as printed digits; the Order's side is already money text. */
function shown(field: Field, value: string): string {
  if (field !== "amount") return value;
  const n = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && value.trim() ? formatPesos(Math.round(n * 100)) : value;
}

/** A plain-words reason for one finding, for example "Proof shows ₱1,000.00, but the order requires ₱1,250.00". */
export function explain(field: Field, f: { finding: Finding; read: string | null; expected: string | null }): string {
  const read = f.read ? shown(field, f.read) : null;
  const what = LABEL[field].toLowerCase();
  const want = field === "amount" ? "requires" : field === "date" ? "needs a date" : "expects";
  switch (f.finding) {
    case "Match": return `Proof shows ${read}, which matches the order.`;
    case "Mismatch": return `Proof shows ${read}, but the order ${want} ${f.expected ?? "a different value"}.`;
    case "Missing": return `The proof does not show the ${what}.${f.expected ? ` The order ${want} ${f.expected}.` : ""}`;
    default: return read ? `The ${what} on the proof (${read}) is not clear enough to check. Look at the image yourself.` : `The ${what} could not be read. Look at the image yourself.`;
  }
}

/**
 * The Proof reader's findings beside the original image and the Order's payment details. Display only:
 * there is no control here, so no role (Admin and the CEO included) can start a read by looking.
 * Findings are evidence, never proof of payment: Staff still verify the real transfer.
 */
export function ProofReadFindings({ read, role, proofId }: { read: ProofReadView | null | undefined; role: ShopRole | null; proofId?: number }) {
  if (!role) return null;
  const heading = <h3 className="font-semibold">Proof reader findings</h3>;
  const shell = "space-y-2 rounded-lg border border-[#e4e4e7] px-4 py-3 text-sm";

  if (!read || read.status === "pending") {
    return <section aria-label="Proof reader findings" className={shell}>{heading}<p className="text-[13px] text-[#71717a]">Not read yet. Check the image yourself; findings appear here once the reader has run.</p></section>;
  }
  const failed = read.status === "needs-review";
  return (
    <section aria-label="Proof reader findings" className={shell}>
      {heading}
      {failed && (
        <p role="note" className="rounded-md bg-[#fdf1d8] px-2.5 py-2 text-[13px] text-[#8a5a00]">
          <b>Needs Review.</b> The proof could not be read automatically. Check the image against the Order yourself.
        </p>
      )}
      {read.findings && (
        <ul className="divide-y divide-[#f0f0f2]">
          {ORDER.map(field => {
            const f = read.findings![field];
            if (!f) return null;
            const latest = read.corrections.findLast((c: ProofCorrection) => c.field === field);
            const fixed = latest?.kind === "correction" && latest.value ? latest : null;
            const shownFinding = fixed ? rejudge(field, fixed.value!, f.expected) : f.finding;
            const { badge, Icon } = STYLE[shownFinding];
            return (
              <li key={field} data-finding={shownFinding} className="flex flex-col gap-1 py-2">
                <span className="flex items-center gap-2 text-[13px] font-medium">
                  {LABEL[field]}
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${badge}`}><Icon aria-hidden className="size-3" />{shownFinding}</span>
                </span>
                <span className="text-xs text-[#71717a]">{explain(field, { ...f, finding: shownFinding, read: fixed ? fixed.value : f.read })}</span>
                {latest && (
                  <span data-testid={`change-${field}`} className="text-xs text-[#5b2a86]">
                    {latest.kind === "correction"
                      ? <>Corrected by {latest.by} (original read: {latest.originalValue ?? "nothing"}). Reason: {latest.reason}</>
                      : <>{latest.by} proceeded despite {latest.originalFinding}. Reason: {latest.reason}</>}
                  </span>
                )}
                {proofId !== undefined && (role === "staff" || role === "manager") && (
                  <ProofReadControls proofId={proofId} field={field} label={LABEL[field]} flagged={shownFinding !== "Match" && latest?.kind !== "override"} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {read.flags.reusedReferenceOrderIds.length > 0 && (
        <p className="text-[13px] text-[#8a5a00]">Reference also seen on {read.flags.reusedReferenceOrderIds.map((id, i) => <span key={id}>{i > 0 && ", "}<Link href={`/orders/${id}`} className="font-medium underline">Order #{id}</Link></span>)}.</p>
      )}
      {read.flags.reusedImageProofIds.length > 0 && <p className="text-[13px] text-[#8a5a00]">This image looks like one sent on another Order. Compare them.</p>}
      <p className="text-xs text-[#71717a]">The reader only extracts details. Matching details are not proof of payment or that the image is genuine. Verify the real transfer before marking paid.</p>
    </section>
  );
}
