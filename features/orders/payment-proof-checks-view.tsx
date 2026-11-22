import { Check, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { formatPesos } from "@/features/customer-profiles/format";
import type { PaymentProofChecks } from "./payment-proof-checks";
import { explain } from "./proof-read-view";
import { rejudge, type ProofReadView } from "./proof-read";
import type { Field } from "./proof-reader";

type Check = { pass: boolean; reason: string };

/** Folds the Proof reader's flag for one field into the plain-rule check: a reader Mismatch, Missing or Needs Review turns a Pass into a Fail. Advisory only. */
function withReader(check: Check, read: ProofReadView | null | undefined, field: Field): Check {
  // A reference the reader saw on another Order is a duplicate even when the typed one was not.
  const seen = field === "reference" ? read?.flags.reusedReferenceOrderIds ?? [] : [];
  if (seen.length) {
    const why = `Proof reader: the reference on the image is already on ${seen.map(id => `Order #${id}`).join(", ")}.`;
    check = { pass: false, reason: check.pass ? why : `${check.reason} ${why}` };
  }
  const f = read?.findings?.[field];
  if (!f) return check;
  const latest = read!.corrections.findLast(c => c.field === field);
  if (latest?.kind === "override") return check;
  const finding = latest?.kind === "correction" && latest.value ? rejudge(field, latest.value, f.expected) : f.finding;
  if (finding === "Match") return check;
  const why = `Proof reader: ${explain(field, { ...f, finding, read: latest?.kind === "correction" ? latest.value : f.read })}`;
  return { pass: false, reason: check.pass ? why : `${check.reason} ${why}` };
}

const dateTime = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila",
});

function Verdict({ pass, reason }: { pass: boolean; reason: string }) {
  const Icon = pass ? Check : TriangleAlert;
  return (
    <div className={pass ? "text-green-700" : "text-amber-800"}>
      <span className="inline-flex items-center gap-1 font-medium"><Icon aria-hidden className="size-3.5" />{pass ? "Pass" : "Fail"}</span>
      <p className="text-xs">{reason}</p>
    </div>
  );
}

/**
 * "Read from the screenshot vs the order": what the Customer confirmed beside what is expected, each with the
 * plain-rule result and its reason. Advisory only; reading never marks an Order paid or rejects a proof.
 */
export function PaymentProofChecksView({ confirmed, expected, checks, reference, read }: PaymentProofChecks & { reference?: string | null; read?: ProofReadView | null }) {
  const rows: { field: string; said: string; should: string; check: { pass: boolean; reason: string } }[] = [
    { field: "Reference no.", said: reference?.trim() || "Not provided", should: "Not used on another Order", check: withReader(checks.reference, read, "reference") },
    { field: "Amount", said: confirmed.amountInCentavos === null ? "Not provided" : formatPesos(confirmed.amountInCentavos), should: formatPesos(expected.amountInCentavos), check: withReader(checks.amount, read, "amount") },
    { field: "Date & time (Philippine time)", said: confirmed.paidAt ? dateTime.format(confirmed.paidAt) : "Not provided", should: `After ${dateTime.format(expected.placedAt)}`, check: withReader(checks.date, read, "date") },
    { field: "Sent to", said: confirmed.recipient ?? "Not provided", should: expected.recipient ?? "Not available", check: withReader(checks.recipient, read, "recipient") },
  ];
  const compareIds = [...new Set([...checks.reference.otherOrderIds, ...(read?.flags.reusedReferenceOrderIds ?? [])])];
  return (
    <section aria-label="Payment proof checks" className="space-y-3 text-sm">
      <h3 className="font-semibold">Customer-typed values · plain-rule checks (not read from the image)</h3>
      <table className="w-full text-left text-[13px]">
        <thead className="text-xs text-muted-foreground">
          <tr><th className="py-1 pr-2 font-medium">Field</th><th className="py-1 pr-2 font-medium">Customer confirmed</th><th className="py-1 pr-2 font-medium">Should be</th><th className="py-1 font-medium">Check</th></tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.field} className="border-t align-top">
              <th scope="row" className="py-2 pr-2 font-medium">{row.field}</th>
              <td className="py-2 pr-2">{row.said}</td>
              <td className="py-2 pr-2">{row.should}</td>
              <td className="py-2"><Verdict {...row.check} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {read && read.flags.reusedImageProofIds.length > 0 && <p role="note" className="text-[13px] text-amber-800">Proof reader: this image looks like one sent on another Order. Compare them.</p>}
      {compareIds.length > 0 && <p className="flex flex-wrap gap-2">Compare:
        {compareIds.map(id => <Link key={id} href={`/orders/${id}`} className="font-medium text-primary underline">Order #{id}</Link>)}
      </p>}
      <p className="text-xs text-muted-foreground">The Customer confirmed these values when uploading. Advisory only: these checks never mark paid or reject a proof.</p>
    </section>
  );
}
