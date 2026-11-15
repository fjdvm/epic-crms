import { Skeleton } from "@/components/ui/skeleton";

import type { FulfilmentFigures } from "./fulfilment-report";

const CARD =
  "flex min-w-0 flex-col items-start gap-1 rounded-xl border border-[#e6e1ee] bg-white px-[18px] py-4 leading-[normal]";

/** Hours to one decimal, "—" when nothing happened in the period. */
export function formatHours(seconds: number | null): string {
  return seconds === null ? "—" : `${(seconds / 3600).toFixed(1)} h`;
}

export function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

function Tile({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <section className={CARD}>
      <h2 className="text-[13px] font-medium text-[#71717a]">{title}</h2>
      <p className="text-2xl font-semibold text-[#18181b]">{value}</p>
      <p className="text-xs text-[#71717a]">{note}</p>
    </section>
  );
}

export function FulfilmentReportView({ figures }: { figures: FulfilmentFigures }) {
  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile title="Placed → dispatched" value={formatHours(figures.placedToDispatched)} note="Average, Orders dispatched in the period" />
        <Tile title="Dispatched → delivered" value={formatHours(figures.dispatchedToDelivered)} note="Average, Orders delivered in the period" />
        <Tile title="Cancellation rate" value={formatRate(figures.cancellationRate)} note={`Of ${figures.placed} Orders placed`} />
        <Tile title="Return rate" value={formatRate(figures.returnRate)} note={`Of ${figures.delivered} Orders delivered`} />
      </div>
      <p className="rounded-[10px] bg-[#f1f1f3] p-3 text-xs text-[#52525b]">
        Replacement Orders are not counted. A cancelled Return is not counted. Exchanges count as returns; store credit
        and refunds are shown separately in Returns.
      </p>
    </>
  );
}

export function FulfilmentReportSkeleton() {
  return (
    <div role="status" aria-label="Loading Fulfilment reports" className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {["Placed → dispatched", "Dispatched → delivered", "Cancellation rate", "Return rate"].map((title) => (
        <section key={title} className={CARD}>
          <h2 className="text-[13px] font-medium text-[#71717a]">{title}</h2>
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-40" />
        </section>
      ))}
    </div>
  );
}
