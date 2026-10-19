import { formatDate } from "./format";
import { orderAnchor, type CustomerOrder } from "./orders";
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
  onOpenOrder,
}: {
  orders: CustomerOrder[];
  onOpenOrder: (orderId: number) => void;
}) {
  const entries = activityOf(orders);

  return (
    <TabCard title="Activity timeline">
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ol className="space-y-[14px]">
          {entries.map((e) => (
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
