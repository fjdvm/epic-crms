import Link from "next/link";
import { requireModule } from "@/lib/portal/staff";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { ticketsDatabase } from "@/lib/tickets-db";
import { handoffs, mayReadResults } from "@/features/order-assistant/data";
export default async function AssistantTickets() {
  const staff = await requireModule(TICKETS_MODULE);
  const rows = await Promise.resolve().then(() => handoffs(ticketsDatabase())).catch(() => null);
  if (!rows) return <p role="alert" className="p-8">Order assistant Tickets are temporarily unavailable. Reload to try again.</p>;
    return <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 overflow-hidden px-8 py-7">
      <Link href="/tickets">Tickets</Link>
      <h1 className="text-2xl font-semibold">From order assistant</h1>
      <p className="text-sm text-muted-foreground">Customer-approved handoffs, oldest first. Open a Ticket to read the chat and what the AI saw.</p>
      <nav className="flex gap-4"><Link href="/tickets/assistant">From order assistant</Link>{mayReadResults(staff.role) && <Link href="/tickets/assistant/results" prefetch>Results</Link>}</nav>
      <div className="min-h-0 overflow-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead><tr>{["Ticket", "Customer", "Subject", "Why handed off", "Order", "Status", "Claimed by"].map(h => <th className="p-4" key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map(r => <tr key={r.ticket_id} className="border-t"><td className="p-4"><Link className="text-primary" href={`/tickets/${r.ticket_id}`}>TKT-{r.ticket_id}</Link></td><td className="p-4">{r.customer_name}</td><td className="p-4">{r.subject}</td><td className="p-4">{r.reason.replaceAll("_", " ")}</td><td className="p-4">{r.order_id ? `BR-${r.order_id}` : "None"}</td><td className="p-4">{r.status}</td><td className="p-4">{r.claimed_by_name ?? "Unclaimed"}</td></tr>)}</tbody></table>{!rows.length && <p className="p-5">No handed-off Tickets yet.</p>}</div>
    </div>;

}
