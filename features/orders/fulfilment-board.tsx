"use client";

import { useOptimistic, useState } from "react";
import Link from "next/link";

import { formatDate } from "@/features/customer-profiles/format";
import { orderLabel } from "@/features/customer-profiles/rules";

import { ordersOnTab, TABS, type FulfilmentBoard, type FulfilmentOrder, type FulfilmentTab } from "./fulfilment";
import { boardStatusLabel, RULES } from "./fulfilment-layout";
import { FulfilmentMove } from "./fulfilment-moves";

function FulfilmentCard({ order, onMove }: { order: FulfilmentOrder; onMove: (id: number, status: "ready for pickup" | "collected") => void }) {
  return (
    <li
      data-fulfilment-card
      className="flex flex-col gap-1.5 rounded-xl border border-[#e6e1ee] bg-white p-3.5 leading-[normal]"
    >
      <div className="flex items-center gap-2">
        <Link href={`/orders/${order.id}`} className="min-w-0 flex-1 text-sm font-semibold text-[#5b2a86]">
          #{order.id}
        </Link>
        <span className="rounded-full bg-[#efe6f8] px-2.5 py-[3px] text-xs font-medium text-[#5b2a86]">
          {boardStatusLabel(order.status)}
        </span>
      </div>
      <p className="truncate text-[13px] font-medium text-[#1f1a2e]">{order.customerName}</p>
      <p className="truncate text-xs text-[#6e6680]">
        {order.lines.map((l) => `${l.product} ×${l.quantity}`).join(", ")}
      </p>
      <p className="truncate text-xs text-[#6e6680]">
        {["delivered", "collected", "received"].includes(order.status) && order.deliveredAt
          ? `${order.status === "collected" || order.fulfillmentMethod === "pickup" ? "Picked up" : "Delivered"} ${formatDate(order.deliveredAt)}`
          : `${orderLabel(order.fulfillmentMethod)} · ${orderLabel(order.paymentMethod)}`}
      </p>
      {order.failedOpen && (
        <Link href={`/orders/${order.id}/failed-delivery`} className="text-xs font-medium text-[#b42318]">
          Failed delivery · resolve
        </Link>
      )}
      {order.packedBy && <p className="truncate text-xs text-[#6e6680]">Packed by {order.packedBy.name}</p>}
      <div className="mt-1 empty:hidden">
        <FulfilmentMove order={order} triggerClassName="w-full px-3 py-1.5 text-[13px]" onMove={(status) => onMove(order.id, status)} />
      </div>
    </li>
  );
}

/** The board with one Order moved to a status, as it will be once the server confirms. */
function moved(board: FulfilmentBoard, { id, status }: { id: number; status: "ready for pickup" | "collected" }): FulfilmentBoard {
  return { orders: board.orders.map((o) => (o.id === id ? { ...o, status, ...(status === "collected" ? { deliveredAt: new Date() } : {}) } : o)) };
}

/** Tabs filter the same Orders; none of them is a status. */
export function FulfilmentBoardView({ board: served }: { board: FulfilmentBoard }) {
  const [board, move] = useOptimistic(served, moved);
  const [tab, setTab] = useState<FulfilmentTab>("all-active");
  const orders = ordersOnTab(board, tab);

  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label="Fulfilment" className="flex flex-wrap gap-1">
        {TABS.map(({ key, label }) => {
          const active = key === tab;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-[7px] text-[13px] leading-[normal] ${active ? "bg-[#efe8f7] font-semibold text-[#5b2a86]" : "font-medium text-[#52525b]"}`}
            >
              {label}
              <span className={`rounded-full px-1.5 py-px text-[11px] font-semibold ${active ? "bg-[#5b2a86] text-white" : "bg-[#e4e4e7] text-[#52525b]"}`}>
                {ordersOnTab(board, key).length}
              </span>
            </button>
          );
        })}
      </div>

      <section role="tabpanel" aria-label={TABS.find((t) => t.key === tab)?.label} className="rounded-xl bg-[#efebf4] px-3 py-3.5 leading-[normal]">
        {tab === "completed" || tab === "all" ? (
          <p className="px-1 pb-2.5 text-xs text-[#6e6680]">Completed shows the last 7 days.</p>
        ) : null}
        {orders.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-[#6e6680]">No Orders here.</p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            {orders.map((order) => (
              <FulfilmentCard key={order.id} order={order} onMove={(id, status) => move({ id, status })} />
            ))}
          </ul>
        )}
      </section>

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
