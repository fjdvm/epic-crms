import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { BuyersFigure, RatingFigure, Widget } from "./figures";

const CARD =
  "flex min-w-0 flex-col items-start gap-1.5 rounded-xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]";

function Title({ children }: { children: string }) {
  return <h2 className="text-[13px] font-medium text-[#71717a]">{children}</h2>;
}

/** How a figure moved against the previous period of equal length. */
function comparison(current: number, previous: number): { text: string; tone: string } {
  if (previous === 0) return { text: "No Orders last period", tone: "text-[#71717a]" };

  const change = Math.round(((current - previous) / previous) * 100);

  if (change > 0) return { text: `↑ ${change}% vs previous period`, tone: "text-[#15803d]" };
  if (change < 0)
    return {
      text: `↓ ${Math.abs(change)}% vs previous period`,
      tone: "text-[#b91c1c]",
    };

  return { text: "No change vs previous period", tone: "text-[#71717a]" };
}

function FailedTile({ title }: { title: string }) {
  return (
    <section className={CARD}>
      <Title>{title}</Title>
      <p className="text-sm text-[#71717a]">Couldn&apos;t load</p>
    </section>
  );
}

function Moved({ delta, unit, absent }: { delta: number | null; unit: string; absent: string }) {
  if (delta === null) return <p className="text-xs font-medium text-[#71717a]">{absent}</p>;
  if (delta === 0) return <p className="text-xs font-medium text-[#71717a]">No change vs previous period</p>;

  const up = delta > 0;

  return (
    <p className={cn("text-xs font-medium", up ? "text-[#15803d]" : "text-[#b91c1c]")}>
      {up ? "↑" : "↓"} {Math.abs(delta)}
      {unit} vs previous period
    </p>
  );
}

export function BuyersTile({ widget }: { widget: Widget<BuyersFigure> }) {
  if (!widget.ok) return <FailedTile title="Returning Buyers" />;

  const { current, previous } = widget;

  if (current.share === null) {
    return (
      <section className={CARD}>
        <Title>Returning Buyers</Title>
        <p className="text-[26px] font-bold text-[#18181b]">—</p>
        <p className="text-xs font-medium text-[#71717a]">No Buyers yet</p>
      </section>
    );
  }

  const points = previous.share === null ? null : Math.round(current.share * 100) - Math.round(previous.share * 100);

  return (
    <section className={CARD}>
      <Title>Returning Buyers</Title>
      <p className="text-[26px] font-bold text-[#18181b]">{Math.round(current.share * 100)}%</p>
      <p className="text-xs text-[#71717a]">of {current.buyers} Buyers</p>
      <Moved delta={points} unit=" pts" absent="No Buyers last period" />
    </section>
  );
}

export function RatingTile({ widget }: { widget: Widget<RatingFigure> }) {
  if (!widget.ok) return <FailedTile title="Average rating" />;

  const { current, previous } = widget;

  if (current.average === null) {
    return (
      <section className={CARD}>
        <Title>Average rating</Title>
        <p className="text-[26px] font-bold text-[#18181b]">—</p>
        <p className="text-xs font-medium text-[#71717a]">No Feedback yet</p>
      </section>
    );
  }

  const delta =
    previous.average === null
      ? null
      : Math.round(Math.round(current.average * 10) - Math.round(previous.average * 10)) / 10;

  return (
    <section className={CARD}>
      <Title>Average rating</Title>
      <p className="text-[26px] font-bold text-[#18181b]">{current.average.toFixed(1)} ★</p>
      <p className="text-xs text-[#71717a]">From {current.count} Feedback</p>
      <Moved delta={delta} unit="" absent="No Feedback last period" />
    </section>
  );
}

export function StatTile({ title, widget, format }: { title: string; widget: Widget; format: (n: number) => string }) {
  if (!widget.ok) return <FailedTile title={title} />;

  const { text, tone } = comparison(widget.current, widget.previous);

  return (
    <section className={CARD}>
      <Title>{title}</Title>
      <p className="text-[26px] font-bold text-[#18181b]">{format(widget.current)}</p>
      <p className={cn("text-xs font-medium", tone)}>{text}</p>
    </section>
  );
}

/** The title is static chrome; only the figure and comparison are skeleton. */
export function StatTileSkeleton({ title }: { title: string }) {
  return (
    <section role="status" aria-label={`Loading ${title}`} className={CARD}>
      <Title>{title}</Title>
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-4 w-32" />
    </section>
  );
}
