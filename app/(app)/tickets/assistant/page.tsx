import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Pill } from "@/features/tickets/pill";
import { TAB_LABELS } from "@/features/tickets/ticket-list";
import { TICKET_TABS } from "@/features/tickets/tickets";
import { requireModule } from "@/lib/portal/staff";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { ticketsDatabase } from "@/lib/tickets-db";
import {
  handoffs,
  mayReadResults,
  todaysCounts,
} from "@/features/order-assistant/data";
import {
  handoffReason,
  waitingFor,
} from "@/features/order-assistant/handoff-reasons";
import { SourceTag } from "@/features/order-assistant/source-tag";
import { cn } from "@/lib/utils";

const COLS = [
  ["Ticket", "w-[100px] shrink-0"],
  ["Customer", "w-[150px] shrink-0"],
  ["Subject", "min-w-0 flex-1"],
  ["Why handed off", "w-[230px] shrink-0"],
  ["Order", "w-[100px] shrink-0"],
  ["Waiting", "w-[90px] shrink-0"],
  ["Assignee", "w-[120px] shrink-0"],
] as const;

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-xl border border-[#e6e1ee] bg-white px-[18px] py-4">
      <p className="text-[13px] font-medium text-[#71717a]">{label}</p>
      <p className="text-2xl font-semibold text-[#18181b]">{value}</p>
      <p className="text-xs text-[#71717a]">{note}</p>
    </div>
  );
}

export default async function AssistantTickets() {
  const staff = await requireModule(TICKETS_MODULE);
  const now = new Date();
  const data = await Promise.resolve()
    .then(async () => {
      const db = ticketsDatabase();
      return { rows: await handoffs(db), today: await todaysCounts(db, now) };
    })
    .catch(() => null);
  if (!data)
    return (
      <p role="alert" className="p-8">
        Order assistant Tickets are temporarily unavailable. Reload to try
        again.
      </p>
    );
  const { rows, today } = data;
  const share = today.questions
    ? `${Math.round((rows.length / today.questions) * 100)}% of questions`
    : "No questions today";
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 overflow-hidden px-8 py-7">
      <div className="shrink-0 space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">
          Tickets
        </h1>
        <p className="text-sm text-[#6e6680]">
          Every customer conversation starts as a ticket. The order assistant
          answers simple questions and opens a ticket when a person is needed.
        </p>
      </div>
      <div className="flex shrink-0 gap-4">
        <Stat
          label="Answered by assistant today"
          value={String(today.answered)}
          note="No ticket needed"
        />
        <Stat
          label="Handed off to staff"
          value={String(rows.length)}
          note={share}
        />
      </div>
      <nav className="flex shrink-0 gap-1" aria-label="Ticket tabs">
        {TICKET_TABS.map((tab) => (
          <Link
            key={tab}
            href={`/tickets?tab=${tab}`}
            prefetch
            className="rounded-lg px-[14px] py-2 text-sm font-medium text-[#6e6680]"
          >
            {TAB_LABELS[tab]}
          </Link>
        ))}
        <Link
          href="/tickets/assistant"
          prefetch
          aria-current="page"
          className="flex items-center gap-1.5 rounded-lg bg-[#efe8f7] px-[14px] py-2 text-sm font-semibold text-[#5b2a86]"
        >
          From order assistant
          <span className="rounded-full bg-[#5b2a86] px-1.5 text-[11px] text-white">
            {rows.length}
          </span>
        </Link>
        {mayReadResults(staff.role) && (
          <Link
            href="/tickets/assistant/results"
            prefetch
            className="rounded-lg px-[14px] py-2 text-sm font-medium text-[#6e6680]"
          >
            Results
          </Link>
        )}
      </nav>
      <div className="min-h-0 overflow-auto rounded-xl border border-[#e6e1ee] bg-white">
        <div className="min-w-[1000px]">
          <div className="flex items-center gap-2 bg-[#fafafa] px-4 py-2.5 text-xs font-medium text-[#71717a]">
            {COLS.map(([h, c]) => (
              <div key={h} className={c}>
                {h}
              </div>
            ))}
          </div>
          {rows.map((r) => {
            const why = handoffReason(r.reason);
            const href = `/tickets/${r.ticket_id}`;
            const hours = (+now - +r.sent_at) / 3600000;
            return (
              <Link
                href={href}
                prefetch
                key={r.ticket_id}
                className="flex items-center gap-2 border-t border-[#f0edf4] px-4 py-3 text-[13px] text-[#18181b]"
              >
                <div className={cn(COLS[0][1], "font-semibold text-[#5b2a86]")}>
                  TKT-{r.ticket_id}
                </div>
                <div className={cn(COLS[1][1], "truncate font-semibold")}>
                  {r.customer_name}
                </div>
                <div className={cn(COLS[2][1], "flex flex-col items-start gap-0.5")}>
                  <span className="truncate font-medium">{r.subject}</span>
                  <SourceTag />
                </div>
                <div className={cn(COLS[3][1], "flex flex-col items-start gap-0.5")}>
                  <Pill className={why.tone}>{why.label}</Pill>
                  {why.note && (
                    <span className="text-xs text-[#71717a]">{why.note}</span>
                  )}
                </div>
                <div className={cn(COLS[4][1], "font-semibold text-[#5b2a86]")}>
                  {r.order_id ? `BR-${r.order_id}` : "—"}
                </div>
                <div className={cn(COLS[5][1], hours >= 0.5 && "text-[#b45309]")}>
                  {waitingFor(r.sent_at, now)}
                </div>
                <div className={COLS[6][1]}>
                  {r.claimed_by_name ?? (
                    <Pill className="bg-[#fdf1d8] text-[#8a5a00]">Unassigned</Pill>
                  )}
                </div>
              </Link>
            );
          })}
          {!rows.length && (
            <p className="p-5 text-sm text-[#6e6680]">
              No handed-off Tickets yet.
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-2.5 rounded-[10px] bg-[#ede4f7] p-3 text-[#5b2a86]">
        <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <p className="text-[13px] font-semibold">
            How the assistant decides to hand off
          </p>
          <p className="text-xs">
            Assistant answers are based only on live order, payment and pickup
            data. It never promises refunds, discounts or replacements — those
            always come to a person.
          </p>
        </div>
      </div>
    </div>
  );
}
