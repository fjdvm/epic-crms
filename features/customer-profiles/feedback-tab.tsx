import { Star } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

import { formatDate } from "./format";
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
      <div className="p-xl text-center text-muted-foreground border border-border rounded-lg">
        This customer has given no feedback yet.
      </div>
    );
  }

  return (
    <ul className="space-y-md">
      {entries.map(({ order: o, feedback }) => (
        <li key={o.id}>
          <Card>
            <CardContent className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <a
                  href={`#${orderAnchor(o.id)}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenOrder(o.id);
                  }}
                  className="font-medium underline underline-offset-2"
                >
                  Order #{o.id}
                </a>
                <span className="text-body-sm text-muted-foreground">{formatDate(o.createdAt)}</span>
              </div>
              <p className="flex items-center gap-1 text-body-md text-foreground">
                <Star className="size-4" /> {feedback.rating} / 5
              </p>
              {feedback.comment && <p className="text-body-md text-foreground">{feedback.comment}</p>}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
