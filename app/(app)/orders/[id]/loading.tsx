import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { CARD, CARD_TITLE } from "@/features/tickets/ticket-detail";

/** Static chrome renders as-is; only the Order's own data is skeleton. */
export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading Order"
      className="flex flex-col gap-5 px-8 py-7 lg:h-[calc(100vh-4rem)] lg:overflow-hidden"
    >
      <div className="shrink-0 space-y-2">
        <Link href="/orders" className="text-sm font-medium text-[#5b2a86]">
          ← Orders
        </Link>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="flex items-center gap-2 text-2xl font-semibold leading-[normal] text-[#1f1a2e]">
              Order <Skeleton className="h-7 w-16" />
            </h1>
            <Skeleton className="h-6 w-24" />
          </div>
          <Skeleton className="h-4 w-72" />
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:overflow-y-auto">
        <div className="space-y-5">
          <section className={CARD}>
            <h2 className={CARD_TITLE}>Order status</h2>
            <Skeleton className="h-10 w-full" />
          </section>
          <section className={CARD}>
            <h2 className={CARD_TITLE}>Items</h2>
            <table className="w-full text-sm text-[#1f1a2e]">
              <thead>
                <tr className="text-left text-xs text-[#6e6680]">
                  <th className="py-1 font-medium">Product</th>
                  <th className="py-1 font-medium">Size</th>
                  <th className="py-1 text-right font-medium">Qty</th>
                  <th className="py-1 text-right font-medium">Price</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 2 }, (_, i) => (
                  <tr key={i} className="border-t border-[#efebf4]">
                    <td className="py-2"><Skeleton className="h-4 w-40" /></td>
                    <td className="py-2"><Skeleton className="h-4 w-10" /></td>
                    <td className="py-2"><Skeleton className="ml-auto h-4 w-6" /></td>
                    <td className="py-2"><Skeleton className="ml-auto h-4 w-16" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="ml-auto w-full max-w-[20rem] space-y-1 text-sm text-[#1f1a2e]">
              {["Subtotal", "Total"].map((label) => (
                <div key={label} className="flex justify-between">
                  <dt className="text-[#6e6680]">{label}</dt>
                  <dd><Skeleton className="h-4 w-16" /></dd>
                </div>
              ))}
            </dl>
          </section>
          <section className={CARD}>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-3/4" />
          </section>
        </div>

        <div className="space-y-5">
          <section className={CARD}>
            <div className="flex items-center justify-between">
              <h2 className={CARD_TITLE}>Payment</h2>
              <Skeleton className="h-6 w-20" />
            </div>
            <dl className="space-y-1 text-sm text-[#1f1a2e]">
              {["Method", "Amount"].map((label) => (
                <div key={label} className="flex justify-between">
                  <dt className="text-[#6e6680]">{label}</dt>
                  <dd><Skeleton className="h-4 w-20" /></dd>
                </div>
              ))}
            </dl>
          </section>
          <section className={CARD}>
            <h2 className={CARD_TITLE}>Customer</h2>
            <Skeleton className="h-4 w-32" />
          </section>
        </div>
      </div>
    </div>
  );
}
