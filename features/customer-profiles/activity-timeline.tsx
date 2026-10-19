import { formatDate } from "./format";
import { orderAnchor, type CustomerOrder } from "./orders";
import { TabCard } from "./tab-card";
import { activityOf, type ActivityEntry } from "./timeline";

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
    <TabCard title="Activity">
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ol className="space-y-3">
          {entries.map((e) => (
            <li key={`${e.kind}-${e.orderId}`} className="space-y-0.5 text-sm text-foreground">
              <p>
                {lead(e)}
                <a
                  href={`#${orderAnchor(e.orderId)}`}
                  onClick={(ev) => {
                    ev.preventDefault();
                    onOpenOrder(e.orderId);
                  }}
                  className="font-medium text-primary hover:underline"
                >
                  Order #{e.orderId}
                </a>
              </p>
              <p className="text-xs text-muted-foreground">{formatDate(e.at)}</p>
            </li>
          ))}
        </ol>
      )}
    </TabCard>
  );
}
