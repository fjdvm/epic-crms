import { Check, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { formatPesos } from "@/features/customer-profiles/format";
import type { PaymentProofChecks } from "./payment-proof-checks";

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
export function PaymentProofChecksView({ confirmed, expected, checks, reference }: PaymentProofChecks & { reference?: string | null }) {
  const rows: { field: string; said: string; should: string; check: { pass: boolean; reason: string } }[] = [
    { field: "Reference no.", said: reference?.trim() || "Not provided", should: "Not used on another Order", check: checks.reference },
    { field: "Amount", said: confirmed.amountInCentavos === null ? "Not provided" : formatPesos(confirmed.amountInCentavos), should: formatPesos(expected.amountInCentavos), check: checks.amount },
    { field: "Date & time (Philippine time)", said: confirmed.paidAt ? dateTime.format(confirmed.paidAt) : "Not provided", should: `After ${dateTime.format(expected.placedAt)}`, check: checks.date },
    { field: "Sent to", said: confirmed.recipient ?? "Not provided", should: expected.recipient ?? "Not available", check: checks.recipient },
  ];
  return (
    <section aria-label="Payment proof checks" className="space-y-3 text-sm">
      <h3 className="font-semibold">Customer-confirmed values · plain-rule checks</h3>
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
      {checks.reference.otherOrderIds.length > 0 && <p className="flex flex-wrap gap-2">Compare:
        {checks.reference.otherOrderIds.map(id => <Link key={id} href={`/orders/${id}`} className="font-medium text-primary underline">Order #{id}</Link>)}
      </p>}
      <p className="text-xs text-muted-foreground">The Customer confirmed these values when uploading. Advisory only: these checks never mark paid or reject a proof.</p>
    </section>
  );
}
