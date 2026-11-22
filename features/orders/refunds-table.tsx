import Link from "next/link";

import { formatDate, formatPesos } from "@/features/customer-profiles/format";
import { refundMethodLabel } from "@/features/returns/refund-record";

import type { RefundRow } from "./refunds";

const HEAD = "py-1.5 pr-3 text-left text-xs font-medium text-[#6e6680]";
const CELL = "py-[11px] pr-3 text-sm leading-[normal] text-[#1f1a2e]";

/**
 * The Payments page's record of refunds: what went back to whom, how, and who settled it. Read-only; a refund is settled
 * on its Return by a Manager. Null means the refunds could not be read.
 */
export function RefundsTable({ refunds, canOpenReturns }: { refunds: RefundRow[] | null; canOpenReturns: boolean }) {
  if (refunds === null) return <p className="p-3 text-center text-sm text-[#6e6680]">Refunds could not be loaded. Reload to try again.</p>;
  if (refunds.length === 0) return <p className="p-3 text-center text-sm text-[#6e6680]">No refunds in the last 30 days.</p>;

  return (
    <table className="w-full min-w-[860px] whitespace-nowrap" aria-label="Refunds">
      <thead className="sticky top-0 bg-white">
        <tr className="border-b border-[#efebf4]">
          <th className={HEAD}>Return</th>
          <th className={HEAD}>Order</th>
          <th className={HEAD}>Customer</th>
          <th className={HEAD}>Refunded</th>
          <th className={HEAD}>Sent by</th>
          <th className={HEAD}>Reference</th>
          <th className={HEAD}>Settled by</th>
          <th className={HEAD}>Date</th>
        </tr>
      </thead>
      <tbody>
        {refunds.map((r) => (
          <tr key={r.returnId} className="border-b border-[#efebf4] last:border-0">
            <td className={`${CELL} font-medium`}>
              {canOpenReturns ? <Link href={`/returns/${r.returnId}`} prefetch className="text-[#5b2a86]">{r.number}</Link> : r.number}
            </td>
            <td className={CELL}><Link href={`/orders/${r.orderId}`} prefetch className="text-[#5b2a86]">#{r.orderId}</Link></td>
            <td className={CELL}>{r.customer}</td>
            <td className={`${CELL} font-medium`}>{formatPesos(r.amountInCentavos)}</td>
            <td className={CELL}>{r.method ? refundMethodLabel(r.method) : "–"}</td>
            <td className={CELL}>{r.reference ?? "–"}</td>
            <td className={CELL}>{r.settledBy ?? "–"}</td>
            <td className={CELL}>{formatDate(r.refundedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
