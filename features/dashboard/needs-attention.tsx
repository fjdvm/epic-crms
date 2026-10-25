import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { Attention } from "./attention";

const CARD = "flex min-w-0 flex-col gap-3 rounded-xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]";

const pesos = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });

const HOUR = 60 * 60 * 1000;

/** The subtitle of a row: how long its oldest waiting item has waited, in the largest whole unit. */
export function oldestAge(oldest: Date, now: Date): string {
  const hours = Math.floor((now.getTime() - oldest.getTime()) / HOUR);

  if (hours < 1) return "Oldest is under an hour old";
  if (hours < 24) return `Oldest is ${hours} ${hours === 1 ? "hour" : "hours"} old`;

  const days = Math.floor(hours / 24);

  return `Oldest is ${days} ${days === 1 ? "day" : "days"} old`;
}

interface Row {
  key: keyof Attention;
  title: string;
  /** The page that works this queue, filtered to the waiting work. */
  href: string;
  /** Said after the age, for queues with a second figure. */
  extra?: (queue: { centavos: number; overdue: number }) => string;
}

const ROWS: Row[] = [
  { key: "paymentProofs", title: "Payment proofs to check", href: "/payments" },
  { key: "deliveryFees", title: "Delivery fees to quote", href: "/orders?tab=placed" },
  { key: "ordersToPack", title: "Orders to pack", href: "/fulfilment" },
  { key: "codToCollect", title: "COD to collect", href: "/fulfilment", extra: (q) => pesos.format(q.centavos / 100) },
  { key: "openTickets", title: "Open Tickets", href: "/tickets?tab=open", extra: (q) => `${q.overdue} Overdue` },
  { key: "returns", title: "Returns to decide", href: "/returns?tab=requested" },
  { key: "lowFeedback", title: "Low Feedback to review", href: "/feedback" },
];

function Title() {
  return <h2 className="text-[13px] font-medium text-[#71717a]">Needs attention</h2>;
}

function QueueRow({ row, queue, now }: { row: Row; queue: Exclude<Attention[keyof Attention], undefined>; now: Date }) {
  const base = "flex items-center gap-3 rounded-lg px-3 py-2.5";

  if (!queue.ok) {
    return (
      <li>
        <Link href={row.href} className={cn(base, "hover:bg-[#f7f5fa]")}>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-[#18181b]">{row.title}</span>
            <span className="block text-xs text-[#71717a]">Couldn&apos;t load</span>
          </span>
        </Link>
      </li>
    );
  }

  const empty = queue.count === 0;
  const extra = !empty && row.extra ? row.extra(queue as unknown as { centavos: number; overdue: number }) : null;

  return (
    <li data-empty={empty ? "true" : undefined} className={cn(empty && "opacity-50")}>
      <Link href={row.href} className={cn(base, "hover:bg-[#f7f5fa]")}>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-[#18181b]">{row.title}</span>
          <span className="block text-xs text-[#71717a]">
            {queue.oldest && !empty ? oldestAge(queue.oldest, now) : "Nothing waiting"}
            {extra && ` · ${extra}`}
          </span>
        </span>
        <span className="text-lg font-bold text-[#18181b]">{queue.count}</span>
      </Link>
    </li>
  );
}

/** Rows appear only for queues the Staff member holds the Module of; a missing key is a hidden row. */
export function NeedsAttention({ attention, now }: { attention: Attention; now: Date }) {
  const rows = ROWS.filter(({ key }) => attention[key] !== undefined);

  return (
    <section className={CARD}>
      <Title />
      {rows.length === 0 ? (
        <p className="text-sm text-[#71717a]">Nothing for you to work on here</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((row) => (
            <QueueRow key={row.key} row={row} queue={attention[row.key]!} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The title is static chrome; only the rows are skeleton. */
export function NeedsAttentionSkeleton() {
  return (
    <section role="status" aria-label="Loading Needs attention" className={CARD}>
      <Title />
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </section>
  );
}

export function NeedsAttentionFailed() {
  return (
    <section className={CARD}>
      <Title />
      <p className="text-sm text-[#71717a]">Couldn&apos;t load</p>
    </section>
  );
}
