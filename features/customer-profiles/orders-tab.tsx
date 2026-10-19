import { Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

import { formatDate, formatPesos } from "./format";
import type { CustomerOrder } from "./orders";
import { paymentStatusOf } from "./rules";

const LABELS: Record<string, string> = {
  pickup: "Pickup",
  delivery: "Delivery",
  gcash: "GCash",
  "cash-on-delivery": "Cash on delivery",
};

function label(value: string): string {
  if (LABELS[value]) return LABELS[value];

  const spaced = value.replace(/-/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-label-md text-muted-foreground">{title}</dt>
      <dd className="text-body-md text-foreground">{children}</dd>
    </div>
  );
}

function OrderCard({ order }: { order: CustomerOrder }) {
  const items = order.lines.reduce((sum, l) => sum + l.quantity, 0);
  const a = order.address;
  const proof = order.paymentProof;

  return (
    <li>
      <Card>
        <CardContent className="space-y-md">
          <div className="grid gap-sm sm:grid-cols-3 lg:grid-cols-6">
            <Field title="Order">#{order.id}</Field>
            <Field title="Date">{formatDate(order.createdAt)}</Field>
            <Field title="Items">{items}</Field>
            <Field title="Total">{formatPesos(order.total)}</Field>
            <Field title="Payment">
              <Badge variant="outline">{paymentStatusOf(order.status)}</Badge>
            </Field>
            <Field title="Order status">
              <Badge variant="outline">{label(order.status)}</Badge>
            </Field>
          </div>

          <dl className="grid gap-sm sm:grid-cols-2">
            <Field title="Fulfillment">{label(order.fulfillmentMethod)}</Field>
            <Field title="Payment method">{label(order.paymentMethod)}</Field>
          </dl>

          <table className="w-full text-body-md">
            <thead>
              <tr className="text-left text-label-md text-muted-foreground">
                <th className="py-1 font-normal">Product</th>
                <th className="py-1 font-normal">Size</th>
                <th className="py-1 text-right font-normal">Qty</th>
                <th className="py-1 text-right font-normal">Price</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((l, i) => (
                <tr key={i}>
                  <td className="py-1">{l.product}</td>
                  <td className="py-1">{l.size}</td>
                  <td className="py-1 text-right">{l.quantity}</td>
                  <td className="py-1 text-right">{formatPesos(l.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="ml-auto max-w-xs space-y-1 text-body-md">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd>{formatPesos(order.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Delivery fee</dt>
              <dd>{formatPesos(order.deliveryFee ?? 0)}</dd>
            </div>
            <div className="flex justify-between font-medium">
              <dt>Total</dt>
              <dd>{formatPesos(order.total)}</dd>
            </div>
          </dl>

          {a && (
            <p className="text-body-md text-foreground">
              <span className="text-label-md text-muted-foreground">Delivery address at checkout: </span>
              {a.label} — {a.street}, {a.barangay}, {a.city}, {a.province} {a.postalCode}, {a.country}
            </p>
          )}

          {proof && (
            <div className="space-y-1">
              <p className="text-label-md text-muted-foreground">Payment proof</p>
              <p className="text-body-md text-foreground">
                Reference: {proof.reference ?? "—"}
                {proof.submittedAt && ` · submitted ${formatDate(proof.submittedAt)}`}
              </p>
              {proof.screenshot &&
                (/^https?:\/\//.test(proof.screenshot) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={proof.screenshot} alt={`Payment proof for order ${order.id}`} className="max-h-64 rounded-md border border-border" />
                ) : (
                  <p className="text-body-sm text-muted-foreground">Screenshot: {proof.screenshot}</p>
                ))}
            </div>
          )}

          {order.feedback && (
            <div className="space-y-1">
              <p className="text-label-md text-muted-foreground">Order feedback</p>
              <p className="flex items-center gap-1 text-body-md text-foreground">
                <Star className="size-4" /> {order.feedback.rating} / 5
              </p>
              {order.feedback.comment && (
                <p className="text-body-md text-foreground">{order.feedback.comment}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

export function OrdersTab({ orders }: { orders: CustomerOrder[] }) {
  return (
    <div className="space-y-md">
      <p className="text-body-sm text-muted-foreground">
        Read-only. Orders are managed in Sales.
      </p>
      {orders.length === 0 ? (
        <div className="p-xl text-center text-muted-foreground border border-border rounded-lg">
          This customer has no orders yet.
        </div>
      ) : (
        <ul className="space-y-md">
          {orders.map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </ul>
      )}
    </div>
  );
}
