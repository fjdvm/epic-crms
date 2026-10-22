import Link from "next/link";

import { formatDate } from "@/features/customer-profiles/format";
import { orderLabel } from "@/features/customer-profiles/rules";

import type { FulfilmentBoard, FulfilmentOrder } from "./fulfilment";
import { FulfilmentMove } from "./fulfilment-moves";
import { StatusPill } from "./status-pill";

/** The Figma board's columns, named after the storefront's statuses rather than the design's. */
const COLUMNS: { key: keyof FulfilmentBoard; title: string }[] = [
  { key: "ready", title: "Ready to prepare" },
  { key: "preparing", title: "Preparing" },
  { key: "dispatched", title: "Dispatched" },
  { key: "delivered", title: "Delivered (7 days)" },
];

/** The Figma "What each move triggers" card, saying only what the storefront really does. */
const RULES: { move: string; effect: string }[] = [
  { move: "Ready to prepare → Preparing", effect: "Orders can still cancel it until it is dispatched" },
  { move: "Preparing → Dispatched", effect: "No courier or tracking number; it can no longer be cancelled" },
  { move: "Dispatched → Delivered", effect: "The Customer is emailed; Feedback request 2 days later" },
];

function FulfilmentCard({ order }: { order: FulfilmentOrder }) {
  return (
    <li
      data-fulfilment-card
      className="flex flex-col gap-1.5 rounded-xl border border-[#e6e1ee] bg-white p-3.5 leading-[normal]"
    >
      <div className="flex items-center gap-2">
        <Link href={`/orders/${order.id}`} className="min-w-0 flex-1 text-sm font-semibold text-[#5b2a86]">
          #{order.id}
        </Link>
        <StatusPill status={order.status} />
      </div>
      <p className="truncate text-[13px] font-medium text-[#1f1a2e]">{order.customerName}</p>
      <p className="truncate text-xs text-[#6e6680]">
        {order.lines.map((l) => `${l.product} ×${l.quantity}`).join(", ")}
      </p>
      <p className="truncate text-xs text-[#6e6680]">
        {order.status === "delivered" && order.deliveredAt
          ? `Delivered ${formatDate(order.deliveredAt)}`
          : `${orderLabel(order.fulfillmentMethod)} · ${orderLabel(order.paymentMethod)}`}
      </p>
      <div className="mt-1 empty:hidden">
        <FulfilmentMove order={order} triggerClassName="w-full px-3 py-1.5 text-[13px]" />
      </div>
    </li>
  );
}

/** Orders move left to right; each card offers only its next move. */
export function FulfilmentBoardView({ board }: { board: FulfilmentBoard }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map(({ key, title }) => {
          const orders = board[key];
          const heading = `fulfilment-${key}`;

          return (
            <section
              key={key}
              aria-labelledby={heading}
              className="flex flex-col gap-2.5 rounded-xl bg-[#efebf4] px-3 py-3.5 leading-[normal]"
            >
              <div className="flex items-center">
                <h2 id={heading} className="flex-1 text-sm font-semibold text-[#1f1a2e]">
                  {title}
                </h2>
                <span className="text-[13px] font-medium text-[#6e6680]">{orders.length}</span>
              </div>
              {orders.length === 0 ? (
                <p className="px-1 py-4 text-center text-xs text-[#6e6680]">No Orders here.</p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {orders.map((order) => (
                    <FulfilmentCard key={order.id} order={order} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <section className="flex flex-col gap-3.5 rounded-xl border border-[#e6e1ee] bg-white p-5 leading-[normal]">
        <h2 className="text-base font-semibold text-[#1f1a2e]">What each move does</h2>
        <dl className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3">
          {RULES.map(({ move, effect }) => (
            <div key={move} className="space-y-1">
              <dt className="text-[13px] font-medium text-[#1f1a2e]">{move}</dt>
              <dd className="text-xs text-[#6e6680]">{effect}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
