import Link from "next/link";
import { formatPesos } from "@/features/customer-profiles/format";
import type { PaymentProofChecks } from "./payment-proof-checks";

const dateTime = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila",
});

/** Advisory comparisons only. Staff still verify the shop's transaction history. */
export function PaymentProofChecksView({ confirmed, expected, checks }: PaymentProofChecks) {
  return (
    <section aria-label="Payment proof checks" className="space-y-3 text-sm">
      <h3 className="font-semibold">Customer-confirmed values · plain-rule checks</h3>
      <dl className="grid grid-cols-2 gap-2">
        <dt>Amount paid</dt><dd>{confirmed.amountInCentavos === null ? "Not provided" : formatPesos(confirmed.amountInCentavos)} · expected {formatPesos(expected.amountInCentavos)}</dd>
        <dt>Payment date (Philippine time)</dt><dd>{confirmed.paidAt ? dateTime.format(confirmed.paidAt) : "Not provided"} · after {dateTime.format(expected.placedAt)}</dd>
        <dt>Recipient</dt><dd>{confirmed.recipient ?? "Not provided"} · shop account {expected.recipient ?? "Not available"}</dd>
      </dl>
      <ul className="space-y-1">
        {Object.entries(checks).map(([name, check]) => (
          <li key={name} className={check.pass ? "text-green-700" : "text-amber-800"}>
            <span className="font-medium">{check.pass ? "Pass" : "Fail"} · </span>{check.reason}
          </li>
        ))}
      </ul>
      {checks.reference.otherOrderIds.length > 0 && <p className="flex flex-wrap gap-2">Compare:
        {checks.reference.otherOrderIds.map(id => <Link key={id} href={`/orders/${id}`} className="font-medium text-primary underline">Order #{id}</Link>)}
      </p>}
      <p className="text-xs text-muted-foreground">Advisory only. Check the shop’s payment history before deciding. These checks never mark paid or reject a proof.</p>
    </section>
  );
}
