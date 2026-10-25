import { Skeleton } from "@/components/ui/skeleton";

import { salesHeadline, soFarNote, type Month } from "./sales-headline";

const CARD =
  "flex min-w-0 flex-col items-start gap-3 rounded-xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]";
const PLOT = "h-40 w-full";

const shortMonth = (label: string) =>
  new Date(`${label}-01T00:00:00Z`).toLocaleString("en-PH", {
    month: "short",
    timeZone: "UTC",
  });

export function SalesChart({
  widget,
  format,
}: {
  widget: { ok: true; months: Month[] } | { ok: false };
  format: (centavos: number) => string;
}) {
  if (!widget.ok) {
    return (
      <section className={CARD}>
        <h2 className="text-[13px] font-medium text-[#71717a]">Sales by month</h2>
        <p className="text-sm text-[#71717a]">Couldn&apos;t load</p>
      </section>
    );
  }

  const { months } = widget;
  const tallest = Math.max(...months.map((m) => m.sales), 1);
  const note = soFarNote(months, format);

  return (
    <section className={CARD}>
      <h2 className="text-base font-semibold text-[#18181b]">{salesHeadline(months)}</h2>
      <ol className={`${PLOT} grid grid-cols-6 items-end gap-3`}>
        {months.map((m) => (
          <li key={m.label} className="flex h-full min-w-0 flex-col items-center justify-end gap-1">
            <span className="text-xs font-medium text-[#18181b]">{format(m.sales)}</span>
            <div
              className={m.soFar ? "w-full rounded-t bg-[#c9b3e0]" : "w-full rounded-t bg-[#5b2a86]"}
              style={{ height: `${Math.max((m.sales / tallest) * 70, 1)}%` }}
            />
            <span className="text-xs text-[#71717a]">{shortMonth(m.label)}</span>
            {m.soFar && <span className="text-[11px] text-[#71717a]">so far</span>}
          </li>
        ))}
      </ol>
      {note && <p className="text-xs font-medium text-[#71717a]">{note}</p>}
    </section>
  );
}

/** The title is static chrome; only the plot is skeleton. */
export function SalesChartSkeleton() {
  return (
    <section role="status" aria-label="Loading Sales by month" className={CARD}>
      <h2 className="text-[13px] font-medium text-[#71717a]">Sales by month</h2>
      <Skeleton className={PLOT} />
    </section>
  );
}
