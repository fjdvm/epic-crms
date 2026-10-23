"use client";

import { useOptimistic } from "react";
import Link from "next/link";

import { formatDate } from "@/features/customer-profiles/format";
import { orderLabel } from "@/features/customer-profiles/rules";

import { readyToPrepare, type FulfilmentBoard, type FulfilmentOrder } from "./fulfilment";
import { COLUMNS, RULES } from "./fulfilment-layout";
import { FulfilmentMove } from "./fulfilment-moves";
import { StatusPill } from "./status-pill";

function FulfilmentCard({
  order,
  onMove,
}: {
  order: FulfilmentOrder;
  onMove: (id: number, status: "preparing" | "dispatched") => void;
}) {
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
        {["delivered", "received"].includes(order.status) && order.deliveredAt
          ? `Delivered ${formatDate(order.deliveredAt)}`
          : `${orderLabel(order.fulfillmentMethod)} · ${orderLabel(order.paymentMethod)}`}
      </p>
      <div className="mt-1 empty:hidden">
        <FulfilmentMove
          order={order}
          triggerClassName="w-full px-3 py-1.5 text-[13px]"
          onMove={(status) => onMove(order.id, status)}
        />
      </div>
    </li>
  );
}

/** The board with one Order moved to a status, as it will be once the server confirms. */
function moved(board: FulfilmentBoard, { id, status }: { id: number; status: "preparing" | "dispatched" }): FulfilmentBoard {
  const all = Object.values(board).flat();
  const order = all.find((o) => o.id === id);
  if (!order) return board;
  const next = all.map((o) => (o.id === id ? { ...order, status } : o));
  return {
    ready: next.filter(readyToPrepare),
    preparing: next.filter((o) => o.status === "preparing"),
    dispatched: next.filter((o) => o.status === "dispatched"),
    delivered: next.filter((o) => ["delivered", "received"].includes(o.status)),
  };
}

/** Orders move left to right; each card offers only its next move. */
export function FulfilmentBoardView({ board: served }: { board: FulfilmentBoard }) {
  const [board, move] = useOptimistic(served, moved);

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
                    <FulfilmentCard key={order.id} order={order} onMove={(id, status) => move({ id, status })} />
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
