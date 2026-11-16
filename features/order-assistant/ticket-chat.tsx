import { ticketsDatabase } from "@/lib/tickets-db";
import { crmsDatabase } from "@/lib/crms-db";
import { chatForTicket, handoffs } from "./data";
import { MarkWrong } from "./mark-wrong";
export async function AssistantChat({
  ticketId,
  canFlag,
}: {
  ticketId: number;
  canFlag: boolean;
}) {
  const data = await (async () => {
    const db = ticketsDatabase();
    const [handoff] = await handoffs(db, ticketId);
    if (!handoff) return { handoff: null, messages: [], flags: [] };
    const messages = await chatForTicket(db, ticketId);
    const flags = await crmsDatabase()<
      { message_id: number; reason: string; staff_name: string }[]
    >`select message_id, reason, staff_name from crms.assistant_answer_flags where ticket_id = ${ticketId}`;
    return { handoff, messages, flags };
  })().catch(() => null);
  if (!data)
    return (
      <p role="alert" className="p-5">
        Attached assistant chat is temporarily unavailable. The Ticket can still
        be handled by hand.
      </p>
    );
  const { handoff, messages, flags } = data;
  if (!handoff) return null;
  return (
    <section className="space-y-4 rounded-xl border bg-white p-5">
      <h2 className="text-base font-semibold">
        From order assistant · Attached chat
      </h2>
      <p>Why handed off: {handoff.reason.replaceAll("_", " ")}</p>
      <p className="whitespace-pre-wrap">
        Handoff summary (
        {handoff.sent_source === "assistant"
          ? "AI-written, approved by Customer"
          : "Customer-written"}
        ): {handoff.summary}
      </p>
      {handoff.sent_to_model && (
        <details>
          <summary>What the AI saw · Handoff summary</summary>
          <pre className="whitespace-pre-wrap break-words text-xs">
            {handoff.sent_to_model}
          </pre>
        </details>
      )}
      {messages.map((m) => {
        const flag = flags.find((f) => f.message_id === m.id);
        return (
          <article className="space-y-2 border-t pt-3 text-sm" key={m.id}>
            <h3 className="font-medium">
              {m.sender === "assistant" ? "Order assistant (AI)" : "Customer"}
            </h3>
            <p className="whitespace-pre-wrap">{m.body}</p>
            {m.sent_to_model && (
              <details>
                <summary>What the AI saw</summary>
                <pre className="whitespace-pre-wrap break-words text-xs">
                  {m.sent_to_model}
                </pre>
              </details>
            )}
            {flag ? (
              <p>
                Marked wrong by {flag.staff_name}: {flag.reason}
              </p>
            ) : m.sender === "assistant" && canFlag ? (
              <MarkWrong ticketId={ticketId} messageId={m.id} />
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
