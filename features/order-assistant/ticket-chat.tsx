import { ticketsDatabase } from "@/lib/tickets-db";
import { crmsDatabase } from "@/lib/crms-db";
import { chatForTicket, handoffs } from "./data";
import { MarkWrong } from "./mark-wrong";
import { handoffReason } from "./handoff-reasons";
import { SourceTag } from "./source-tag";

const time = (d: Date) =>
  new Date(d).toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  });
const ROW = "flex gap-3 text-[13px]";
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
  const why = handoffReason(handoff.reason);
  const minutes =
    messages.length > 1
      ? Math.max(
          1,
          Math.round(
            (+new Date(messages[messages.length - 1].created_at) -
              +new Date(messages[0].created_at)) /
              60000,
          ),
        )
      : null;
  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="Handoff summary"
        className="space-y-2.5 rounded-xl border border-[#e9ddf7] bg-[#f7f3fb] px-[18px] py-4"
      >
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-sm font-semibold text-[#18181b]">
            What the customer already told the assistant
          </h2>
          <span className="rounded-full bg-[#ede4f7] px-2.5 py-[3px] text-xs font-medium text-[#5b2a86]">
            Handed off {time(handoff.sent_at)}
          </span>
        </div>
        <p className={ROW}>
          <span className="w-[110px] shrink-0 text-xs font-medium text-[#71717a]">
            Why handed off
          </span>
          <span>
            {why.label}
            {why.note ? ` · ${why.note}` : ""}
          </span>
        </p>
        <p className={ROW}>
          <span className="w-[110px] shrink-0 text-xs font-medium text-[#71717a]">
            Summary
          </span>
          <span className="whitespace-pre-wrap">{handoff.summary}</span>
        </p>
        <p className="text-xs text-[#71717a]">
          {handoff.sent_source === "assistant"
            ? "AI-written, approved by the Customer before it was sent."
            : "Written by the Customer."}
        </p>
        {handoff.sent_to_model && (
          <details className="text-xs">
            <summary className="cursor-pointer font-medium text-[#5b2a86]">
              What the AI saw
            </summary>
            <pre className="mt-1 whitespace-pre-wrap break-words">
              {handoff.sent_to_model}
            </pre>
          </details>
        )}
      </section>
      <section
        aria-label="Conversation with the assistant"
        className="space-y-3 rounded-xl border border-[#e6e1ee] bg-white p-5"
      >
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-[15px] font-semibold text-[#18181b]">
            Conversation with the assistant
          </h2>
          <SourceTag />
          <span className="text-xs text-[#71717a]">
            {messages.length} messages{minutes ? ` · ${minutes} min` : ""}
          </span>
        </div>
        {messages.map((m) => {
          const flag = flags.find((f) => f.message_id === m.id);
          const ai = m.sender === "assistant";
          return (
            <article className="space-y-2" key={m.id}>
              <div className="flex gap-2.5 text-[13px]">
                <span className="w-[84px] shrink-0">
                  <span
                    className={
                      ai
                        ? "rounded-full bg-[#f3e8ff] px-2 py-0.5 text-[11px] font-medium text-[#7c3aed]"
                        : "rounded-full bg-[#f1f1f3] px-2 py-0.5 text-[11px] font-medium text-[#52525b]"
                    }
                  >
                    {ai ? "Assistant" : "Customer"}
                  </span>
                </span>
                <p className="min-w-0 flex-1 whitespace-pre-wrap">{m.body}</p>
              </div>
              {ai && m.sent_to_model && (
                <details className="pl-[94px] text-xs">
                  <summary className="cursor-pointer text-[#5b2a86]">
                    What the AI saw
                  </summary>
                  <pre className="whitespace-pre-wrap break-words">
                    {m.sent_to_model}
                  </pre>
                </details>
              )}
              {flag ? (
                <p className="pl-[94px] text-xs text-[#b42318]">
                  Marked wrong by {flag.staff_name}: {flag.reason}
                </p>
              ) : ai && canFlag ? (
                <div className="pl-[94px]">
                  <MarkWrong ticketId={ticketId} messageId={m.id} />
                </div>
              ) : null}
            </article>
          );
        })}
      </section>
    </div>
  );
}
