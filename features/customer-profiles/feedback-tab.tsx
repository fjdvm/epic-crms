import { Star } from "lucide-react";

import { formatDate } from "./format";
import { TabCard } from "./tab-card";
import { orderAnchor, type CustomerOrder } from "./orders";

export function FeedbackTab({
  orders,
  onOpenOrder,
}: {
  orders: CustomerOrder[];
  onOpenOrder: (orderId: number) => void;
}) {
  const entries = orders.flatMap((o) => (o.feedback ? [{ order: o, feedback: o.feedback }] : []));

  if (entries.length === 0) {
    return (
      <TabCard title="Feedback">
        <div className="p-xl text-center text-muted-foreground">This customer has given no feedback yet.</div>
      </TabCard>
    );
  }

  return (
    <TabCard title="Feedback">
      <ul className="divide-y divide-border-subtle">
        {entries.map(({ order: o, feedback }) => (
          <li key={o.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-2">
              <a
                href={`#${orderAnchor(o.id)}`}
                onClick={(e) => {
                  e.preventDefault();
                  onOpenOrder(o.id);
                }}
                className="text-sm font-medium text-primary hover:underline"
              >
                Order #{o.id}
              </a>
              <span className="text-xs text-muted-foreground">{formatDate(o.createdAt)}</span>
            </div>
            <p className="flex items-center gap-1 text-sm text-foreground">
              <Star className="size-4" /> {feedback.rating} / 5
            </p>
            {feedback.comment && <p className="text-sm text-foreground">{feedback.comment}</p>}
          </li>
        ))}
      </ul>
    </TabCard>
  );
}
