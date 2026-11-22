import type { VisibleCustomerNote } from "./notes-tab";
import { formatDate } from "./format";
import { orderAnchor, type CustomerOrder } from "./orders";
import type { VisibleCustomerTask } from "./tasks-tab";
import { TabCard } from "./tab-card";
import { activityOf, type ActivityEntry } from "./timeline";

/** Dot colours from the design's activity timeline. */
const DOT: Record<ActivityEntry["kind"], string> = {
  placed: "bg-[#1e6b3a]",
  "payment-proof": "bg-[#1d4f91]",
  feedback: "bg-[#8a5a00]",
};

function lead(entry: ActivityEntry): string {
  switch (entry.kind) {
    case "placed":
      return "Placed ";
    case "payment-proof":
      return "Payment proof for ";
    case "feedback":
      return `Left ${entry.rating} / 5 feedback on `;
  }
}

export function ActivityTimeline({
  orders,
  notes = [],
  tasks = [],
  onOpenOrder,
}: {
  orders: CustomerOrder[];
  notes?: VisibleCustomerNote[];
  tasks?: VisibleCustomerTask[];
  onOpenOrder: (orderId: number) => void;
}) {
  const entries = [
    ...activityOf(orders),
    ...notes.map(note => ({ kind: "customer-note" as const, at: new Date(note.createdAt), note })),
    ...tasks.flatMap(task => [
      { kind: "task-created" as const, at: new Date(task.createdAt), task },
      ...(task.doneAt ? [{ kind: "task-done" as const, at: new Date(task.doneAt), task }] : []),
    ]),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <TabCard title="Activity timeline">
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ol className="space-y-[14px]">
          {entries.map((e) => e.kind === "task-created" || e.kind === "task-done" ? (
            <li key={`${e.kind}-${e.task.id}`} className="flex items-start gap-3">
              <span aria-hidden className="mt-1 size-2.5 shrink-0 rounded-full bg-primary" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium text-foreground">{e.kind === "task-created" ? `${e.task.createdByName} created a Task` : `${e.task.doneByName} marked a Task done`}</p>
                <p className="break-words text-sm text-foreground">{e.task.description}</p>
                <p className="text-xs text-muted-foreground">{formatDate(e.at)}</p>
              </div>
            </li>
          ) : e.kind === "customer-note" ? (
            <li key={`customer-note-${e.note.id}`} className="flex items-start gap-3">
              <span aria-hidden className="mt-1 size-2.5 shrink-0 rounded-full bg-primary" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium text-foreground">{e.note.authorName} added a Customer note{e.note.saving && " · saving…"}</p>
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">{e.note.text}</p>
                <p className="text-xs text-muted-foreground">{formatDate(e.at)}</p>
              </div>
            </li>
          ) : (
            <li key={`${e.kind}-${e.orderId}`} className="flex items-start gap-3">
              <span aria-hidden className={`mt-1 size-2.5 shrink-0 rounded-full ${DOT[e.kind]}`} />
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium text-foreground">
                  {lead(e)}
                  <a
                    href={`#${orderAnchor(e.orderId)}`}
                    onClick={(ev) => {
                      ev.preventDefault();
                      onOpenOrder(e.orderId);
                    }}
                    className="text-primary hover:underline"
                  >
                    Order #{e.orderId}
                  </a>
                </p>
                <p className="text-xs text-muted-foreground">{formatDate(e.at)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </TabCard>
  );
}
