import Link from "next/link";

import { formatDate, formatPesos } from "@/features/customer-profiles/format";
import { orderLabel } from "@/features/customer-profiles/rules";
import { PILL, Pill } from "@/features/tickets/pill";

import type { ReturnRow, ReturnStatus } from "./returns";

export const STATUS_PILLS: Record<ReturnStatus, string> = {
  requested: PILL.amber,
  approved: PILL.purple,
  "goods received": PILL.blue,
  refunded: PILL.grey,
  declined: PILL.red,
  cancelled: PILL.grey,
};

const HEAD = "py-1.5 pr-3 text-left text-xs font-medium text-[#6e6680]";
const CELL = "py-[11px] pr-3 text-sm leading-[normal] text-[#1f1a2e]";

/**
 * A read-only table of Returns: number, status, amount and request date, plus the Order each belongs
 * to when `showOrder` is set. Null means the Returns could not be read, which is not the same as none.
 */
export function ReturnsTable({
  returns,
  showOrder = false,
  canOpenOrder = false,
  empty,
}: {
  returns: ReturnRow[] | null;
  showOrder?: boolean;
  /** Staff who may open an Order's detail page get a link to it; others see its number. */
  canOpenOrder?: boolean;
  empty: string;
}) {
  if (returns === null) {
    return <p className="text-sm text-[#6e6680]">Returns could not be loaded. Reload to try again.</p>;
  }
  if (returns.length === 0) return <p className="text-sm text-[#6e6680]">{empty}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max whitespace-nowrap">
        <thead>
          <tr className="border-b border-[#efebf4]">
            <th className={HEAD}>Return</th>
            {showOrder && <th className={HEAD}>Order</th>}
            <th className={HEAD}>Status</th>
            <th className={HEAD}>Amount</th>
            <th className={HEAD}>Requested</th>
          </tr>
        </thead>
        <tbody>
          {returns.map((r) => (
            <tr key={r.id} className="border-b border-[#efebf4] last:border-0">
              <td className={`${CELL} font-medium text-[#5b2a86]`}>{r.number}</td>
              {showOrder && (
                <td className={CELL}>
                  {canOpenOrder ? (
                    <Link href={`/orders/${r.orderId}`} className="text-[#5b2a86]">
                      #{r.orderId}
                    </Link>
                  ) : (
                    `#${r.orderId}`
                  )}
                </td>
              )}
              <td className={CELL}>
                <Pill className={STATUS_PILLS[r.status]}>{orderLabel(r.status)}</Pill>
              </td>
              <td className={CELL}>{formatPesos(r.amount)}</td>
              <td className={CELL}>{formatDate(r.requestedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
