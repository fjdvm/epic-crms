import Link from "next/link";
import { redirect } from "next/navigation";
import { requireModule } from "@/lib/portal/staff";
import { TICKETS_MODULE, NO_ACCESS_PATH } from "@/lib/portal/config";
import { ticketsDatabase } from "@/lib/tickets-db";
import { crmsDatabase } from "@/lib/crms-db";
import { loadResults, mayReadResults } from "@/features/order-assistant/data";
export default async function ResultsPage() {
  const staff = await requireModule(TICKETS_MODULE);
  if (!mayReadResults(staff.role)) redirect(NO_ACCESS_PATH);
  const r = await Promise.resolve().then(() => loadResults(ticketsDatabase(), crmsDatabase())).catch(() => null);
  if (!r) return <p className="p-8" role="alert">Order assistant Results are temporarily unavailable. Reload to try again.</p>;
    return <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 overflow-hidden px-8 py-7">
      <Link href="/tickets/assistant">Tickets / Order assistant</Link>
      <h1 className="text-2xl font-semibold">Order assistant · Results</h1>
      <p className="text-sm text-muted-foreground">This week, Monday to now (Manila). Computed only from stored chats; no estimated time saved or helpfulness rating.</p>
      <div className="min-h-0 space-y-4 overflow-auto">
        <div className="grid gap-4 sm:grid-cols-4">{[
          ["Questions this week", r.questions, `${r.lastWeek} last week (full week)`],
          ["Answered without a Ticket", r.answered, "Saved answers in chats with no linked Ticket"],
          ["Handed off", r.handedOff, "Customer-approved handoffs sent this week"],
          ["Flagged answers", r.flags.length, "Marked wrong this week"],
        ].map(([label, value, hint]) => <section key={label} className="rounded-xl border bg-white p-5"><h2 className="text-sm">{label}</h2><p className="my-2 text-2xl font-semibold">{value}</p><p className="text-xs text-muted-foreground">{hint}</p></section>)}</div>
        <section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">Top questions by recognised kind</h2><p className="text-xs text-muted-foreground">Fixed storefront rules classify saved questions; unrecognised questions are shown separately.</p>{r.kinds.length ? r.kinds.map(([kind, count]) => <p className="flex justify-between border-b py-3 text-sm" key={kind}><span>{kind.replaceAll("_", " ")}</span><span>{count}</span></p>) : <p>No stored questions this week.</p>}</section>
        <section className="space-y-3 rounded-xl border bg-white p-5"><h2 className="font-semibold">Flagged answers</h2>{!r.flags.length && <p>No answers marked wrong this week.</p>}{r.flags.map(f => <article className="space-y-2 border-t pt-3 text-sm" key={f.message_id}><Link className="text-primary" href={`/tickets/${f.ticket_id}`}>TKT-{f.ticket_id}</Link><p className="whitespace-pre-wrap">{f.answer}</p><p>{f.reason}</p><p className="text-muted-foreground">{f.staff_name} · {f.created_at.toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</p></article>)}</section>
      </div>
    </div>;

}
