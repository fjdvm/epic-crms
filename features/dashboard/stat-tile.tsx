import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { Widget } from "./figures";

const CARD = "flex min-w-0 flex-col items-start gap-1.5 rounded-xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]";

function Title({ children }: { children: string }) {
  return <h2 className="text-[13px] font-medium text-[#71717a]">{children}</h2>;
}

/** How a figure moved against the previous period of equal length. */
function comparison(current: number, previous: number): { text: string; tone: string } {
  if (previous === 0) return { text: "No Orders last period", tone: "text-[#71717a]" };

  const change = Math.round(((current - previous) / previous) * 100);

  if (change > 0) return { text: `↑ ${change}% vs previous period`, tone: "text-[#15803d]" };
  if (change < 0) return { text: `↓ ${Math.abs(change)}% vs previous period`, tone: "text-[#b91c1c]" };

  return { text: "No change vs previous period", tone: "text-[#71717a]" };
}

export function StatTile({ title, widget, format }: { title: string; widget: Widget; format: (n: number) => string }) {
  if (!widget.ok) {
    return (
      <section className={CARD}>
        <Title>{title}</Title>
        <p className="text-sm text-[#71717a]">Couldn&apos;t load</p>
      </section>
    );
  }

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
