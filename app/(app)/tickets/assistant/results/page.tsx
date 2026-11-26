import Link from "next/link";
import { redirect } from "next/navigation";
import { requireModule } from "@/lib/portal/staff";
import { TICKETS_MODULE, NO_ACCESS_PATH } from "@/lib/portal/config";
import { ticketsDatabase } from "@/lib/tickets-db";
import { crmsDatabase } from "@/lib/crms-db";
import { loadResults, mayReadResults } from "@/features/order-assistant/data";
import { TopQuestionsTable } from "@/features/order-assistant/top-questions-table";
export default async function ResultsPage() {
  const staff = await requireModule(TICKETS_MODULE);
  if (!mayReadResults(staff.role)) redirect(NO_ACCESS_PATH);
  const r = await Promise.resolve()
    .then(() => loadResults(ticketsDatabase(), crmsDatabase()))
    .catch(() => null);
  if (!r)
    return (
      <p className="p-8" role="alert">
        Order assistant Results are temporarily unavailable. Reload to try
        again.
      </p>
    );
  const pct = r.questions ? Math.round((r.answered / r.questions) * 100) : 0;
  const change = r.lastWeek
    ? `${r.questions >= r.lastWeek ? "+" : ""}${Math.round(((r.questions - r.lastWeek) / r.lastWeek) * 100)}% vs last week`
    : `${r.lastWeek} last week`;
  const stats: [string, string | number, string, string][] = [
    ["Questions this week", r.questions, change, "text-[#71717a]"],
    [
      "Answered without a ticket",
      `${pct}%`,
      `${r.answered} questions`,
      "text-[#16a34a]",
    ],
    [
      "Handed off",
      r.handedOff,
      "Customer-approved, sent this week",
      "text-[#71717a]",
    ],
    [
      "Marked wrong by staff",
      r.flags.length,
      r.flags.length ? "Review below" : "None this week",
      "text-[#b45309]",
    ],
  ];
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 overflow-hidden bg-[#fafafa] px-8 py-5">
      <nav className="text-[13px] font-medium">
        <Link href="/tickets" className="text-[#71717a]">
          Tickets
        </Link>{" "}
        <Link href="/tickets/assistant" className="text-[#18181b]">
          / Order assistant
        </Link>
      </nav>
      <div>
        <h1 className="text-2xl font-semibold">Order assistant</h1>
        <p className="text-sm text-[#71717a]">
          Results since Monday (Manila), computed only from stored chats. Read
          only.
        </p>
      </div>
      <div className="min-h-0 space-y-4 overflow-auto">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map(([label, value, hint, tone]) => (
            <section
              key={label}
              className="rounded-xl border border-[#e6e1ee] bg-white px-[18px] py-4"
            >
              <h2 className="text-[13px] font-medium text-[#71717a]">
                {label}
              </h2>
              <p className="text-2xl font-semibold">{value}</p>
              <p className={`text-xs ${tone}`}>{hint}</p>
            </section>
          ))}
        </div>
        <TopQuestionsTable
          rows={r.kinds.map(([kind, count]) => ({
            kind,
            asked: count,
            rate: Math.round(((r.answeredByKind[kind] ?? 0) / count) * 100),
          }))}
        />
        <section className="space-y-3 rounded-xl border border-[#e6e1ee] bg-white p-5">
          <div className="flex items-center gap-2">
            <h2 className="flex-1 text-[15px] font-semibold">
              Answers to review
            </h2>
            <span className="rounded-full bg-[#fdf1d8] px-2.5 py-0.5 text-xs font-medium text-[#8a5a00]">
              {r.flags.length}
            </span>
          </div>
          {!r.flags.length && (
            <p className="text-sm">No answers marked wrong this week.</p>
          )}
          {r.flags.map((f) => (
            <article
              className="space-y-1.5 rounded-[10px] border border-[#f5dfa8] bg-[#fffbeb] px-3.5 py-3 text-[13px] text-[#78350f]"
              key={f.message_id}
            >
              <p className="whitespace-pre-wrap font-semibold">
                &ldquo;{f.answer}&rdquo;
              </p>
              <p>{f.reason}</p>
              <p className="text-xs">
                Flagged by {f.staff_name} ·{" "}
                {f.created_at.toLocaleString("en-PH", {
                  timeZone: "Asia/Manila",
                })}{" "}
                ·{" "}
                <Link className="underline" href={`/tickets/${f.ticket_id}`}>
                  TKT-{f.ticket_id}
                </Link>
              </p>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
