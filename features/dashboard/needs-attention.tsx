import { Banknote, ChevronRight, FileCheck, Package, RotateCcw, Star, Tag, Ticket, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { Attention } from "./attention";

const CARD = "flex min-w-0 flex-col gap-3 rounded-2xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]";

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
  icon: LucideIcon;
  /** The tone of the count. */
  tone: string;
  /** The page that works this queue, filtered to the waiting work. */
  href: string;
  /** Said after the age, for queues with a second figure. */
  extra?: (queue: { centavos: number; overdue: number }) => string;
}

const ROWS: Row[] = [
  { key: "paymentProofs", icon: FileCheck, tone: "text-[#b45309]", title: "Payment proofs to check", href: "/payments" },
  { key: "deliveryFees", icon: Tag, tone: "text-[#5b2a86]", title: "Delivery fees to quote", href: "/orders?tab=placed" },
  { key: "ordersToPack", icon: Package, tone: "text-[#5b2a86]", title: "Orders to pack", href: "/fulfilment" },
  { key: "codToCollect", icon: Banknote, tone: "text-[#1d4ed8]", title: "COD to collect", href: "/fulfilment", extra: (q) => pesos.format(q.centavos / 100) },
  { key: "openTickets", icon: Ticket, tone: "text-[#b91c1c]", title: "Open Tickets", href: "/tickets?tab=open", extra: (q) => `${q.overdue} Overdue` },
  { key: "returns", icon: RotateCcw, tone: "text-[#b45309]", title: "Returns to decide", href: "/returns?tab=requested" },
  { key: "lowFeedback", icon: Star, tone: "text-[#b91c1c]", title: "Low Feedback to review", href: "/feedback" },
];

function Title() {
  return <h2 className="text-[13px] font-medium text-[#71717a]">Needs attention</h2>;
}

function RowIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#f1edf6] text-[#5b2a86]">
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

function QueueRow({ row, queue, now }: { row: Row; queue: Exclude<Attention[keyof Attention], undefined>; now: Date }) {
  const base = "flex items-center gap-3 rounded-lg px-3 py-2.5";

  if (!queue.ok) {
    return (
      <li>
        <Link href={row.href} className={cn(base, "hover:bg-[#f7f5fa]")}>
          <RowIcon icon={row.icon} />
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
        <RowIcon icon={row.icon} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-[#18181b]">{row.title}</span>
          <span className="block text-xs text-[#71717a]">
            {queue.oldest && !empty ? oldestAge(queue.oldest, now) : "Nothing waiting"}
            {extra && ` · ${extra}`}
          </span>
        </span>
        <span className={cn("text-base font-bold", row.tone)}>{queue.count}</span>
        <ChevronRight className="size-4 shrink-0 text-[#a1a1aa]" aria-hidden />
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
