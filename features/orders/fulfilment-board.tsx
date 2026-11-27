"use client";

import { useEffect, useOptimistic, useRef, useState, type HTMLAttributes, type Ref } from "react";
import Link from "next/link";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";

import { TablePagination, useClientPagination } from "@/components/shared/table-pagination";
import { ABOVE_ROW_LINK, CLICKABLE_ROW, RowLink } from "@/components/shared/row-link";
import { formatDate } from "@/features/customer-profiles/format";
import { orderLabel } from "@/features/customer-profiles/rules";

import { ordersOnTab, TABS, type FulfilmentBoard, type FulfilmentOrder, type FulfilmentTab } from "./fulfilment";
import { BOARD_COLUMNS, boardStatusLabel, COLUMN_FRAME, COLUMNS_FRAME, RULES } from "./fulfilment-layout";
import { FulfilmentMove, type MoveStatus } from "./fulfilment-moves";

/** The columns a card may be dragged to from each column: only its Order's one next move. */
const DROPS: Record<string, string> = {
  "to-pack": "preparing",
  preparing: "out-for-delivery",
  "out-for-delivery": "completed",
  failed: "completed",
};

export function allowsDrop(from: string, to: string): boolean {
  return DROPS[from] === to;
}

/** What every card needs to make its move; `asking` is the Order whose confirm dialog is open. */
type Moves = {
  asking: number | null;
  ask: (id: number | null) => void;
  onMove: (id: number, status: MoveStatus) => void;
};

function FulfilmentCard({ order, moves, ref, ...drag }: { order: FulfilmentOrder; moves: Moves; ref?: Ref<HTMLLIElement> } & HTMLAttributes<HTMLLIElement>) {
  return (
    <li
      {...drag}
      ref={ref}
      data-fulfilment-card
      className={`${CLICKABLE_ROW} flex flex-col gap-1.5 rounded-xl border border-[#e6e1ee] bg-white p-3.5 leading-[normal]`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <RowLink href={`/orders/${order.id}`} draggable={false} className="flex-1 text-sm font-semibold text-[#5b2a86]">
          #{order.id}
        </RowLink>
        <span className="rounded-full bg-[#efe6f8] px-2.5 py-[3px] text-xs font-medium text-[#5b2a86]">
          {boardStatusLabel(order.status)}
        </span>
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
      {order.failedOpen && (
        <Link href={`/orders/${order.id}/failed-delivery`} className={`${ABOVE_ROW_LINK} text-xs font-medium text-[#b42318]`}>
          Failed delivery · resolve
        </Link>
      )}
      {order.packedBy && <p className="truncate text-xs text-[#6e6680]">Packed by {order.packedBy.name}</p>}
      <div className={`${ABOVE_ROW_LINK} mt-1 empty:hidden`}>
        <FulfilmentMove
          order={order}
          triggerClassName="w-full px-2 py-1.5 text-[13px]"
          open={moves.asking === order.id}
          onOpenChange={(open) => moves.ask(open ? order.id : null)}
          onMove={(status) => moves.onMove(order.id, status)}
        />
      </div>
    </li>
  );
}

const EMPTY = <p className="px-1 py-4 text-center text-xs text-[#6e6680]">No Orders here.</p>;
const COMPLETED_NOTE = "Completed shows the last 7 days.";

/** One phase of the All active board: scrolls and pages on its own. */
function Column({ id, label, orders, dragFrom, moves }: { id: string; label: string; orders: FulfilmentOrder[]; dragFrom: string | null; moves: Moves }) {
  const pages = useClientPagination(orders);
  const section = useRef<HTMLElement>(null);
  // A new page starts at the top. The list is not remounted: the drag library holds on to its element.
  useEffect(() => {
    const list = section.current?.querySelector("ul");
    if (list) list.scrollTop = 0;
  }, [pages.page]);

  return (
    <section ref={section} aria-label={label} className={COLUMN_FRAME}>
      <h2 className="flex items-center gap-1.5 px-1 pb-2 text-[13px] font-semibold text-[#1f1a2e]">
        {label}
        <span className="rounded-full bg-white px-1.5 py-px text-[11px] text-[#52525b]">{orders.length}</span>
      </h2>
      {id === "completed" && <p className="px-1 pb-2 text-xs text-[#6e6680]">{COMPLETED_NOTE}</p>}
      <Droppable droppableId={id} isDropDisabled={dragFrom !== null && dragFrom !== id && !allowsDrop(dragFrom, id)}>
        {(drop, { isDraggingOver }) => (
          <ul
            {...drop.droppableProps}
            ref={drop.innerRef}
            className={`min-h-0 flex-1 overflow-y-auto rounded-lg ${isDraggingOver && dragFrom !== id ? "ring-2 ring-inset ring-[#5b2a86]" : ""}`}
          >
            {pages.pageItems.map((order, index) => (
              <Draggable key={order.id} draggableId={String(order.id)} index={index} isDragDisabled={id === "completed"}>
                {(card) => (
                  <FulfilmentCard {...card.draggableProps} {...card.dragHandleProps} ref={card.innerRef} style={{ ...card.draggableProps.style, marginBottom: 10 }} order={order} moves={moves} />
                )}
              </Draggable>
            ))}
            {drop.placeholder}
            {orders.length === 0 && <li>{EMPTY}</li>}
          </ul>
        )}
      </Droppable>
      {pages.totalPages > 1 && <TablePagination pagination={pages} compact />}
    </section>
  );
}

/** All active: a column for each phase. A drop only asks; the move's own dialog still has to be confirmed. */
function Columns({ board, moves }: { board: FulfilmentBoard; moves: Moves }) {
  const [dragFrom, setDragFrom] = useState<string | null>(null);

  function dropped({ draggableId, source, destination }: DropResult) {
    setDragFrom(null);
    if (destination && allowsDrop(source.droppableId, destination.droppableId)) moves.ask(Number(draggableId));
  }

  return (
    <DragDropContext onDragStart={({ source }) => setDragFrom(source.droppableId)} onDragEnd={dropped}>
      <div className={COLUMNS_FRAME}>
        {BOARD_COLUMNS.map(({ key, label }) => (
          <Column key={key} id={key} label={label} orders={ordersOnTab(board, key)} dragFrom={dragFrom} moves={moves} />
        ))}
      </div>
    </DragDropContext>
  );
}

/** Every other tab: one paged grid that scrolls inside the page. */
function Grid({ tab, orders, moves }: { tab: FulfilmentTab; orders: FulfilmentOrder[]; moves: Moves }) {
  const pages = useClientPagination(orders);

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl bg-[#efebf4] px-3 py-3.5 leading-[normal]">
      {tab === "completed" || tab === "all" ? <p className="px-1 pb-2.5 text-xs text-[#6e6680]">{COMPLETED_NOTE}</p> : null}
      {orders.length === 0 ? (
        EMPTY
      ) : (
        <>
          <div key={pages.page} className="min-h-0 flex-1 overflow-y-auto">
            <ul className="grid grid-cols-4 gap-2.5">
              {pages.pageItems.map((order) => (
                <FulfilmentCard key={order.id} order={order} moves={moves} />
              ))}
            </ul>
          </div>
          <TablePagination pagination={pages} itemLabel="Orders" />
        </>
      )}
    </div>
  );
}

/** The board with one Order moved to a status, as it will be once the server confirms. */
function moved(board: FulfilmentBoard, { id, status }: { id: number; status: MoveStatus }): FulfilmentBoard {
  return { orders: board.orders.map((o) => (o.id === id ? { ...o, status, ...(status === "delivered" ? { deliveredAt: new Date() } : {}) } : o)) };
}

/** Tabs filter the same Orders; none of them is a status. */
export function FulfilmentBoardView({ board: served }: { board: FulfilmentBoard }) {
  const [board, move] = useOptimistic(served, moved);
  const [tab, setTab] = useState<FulfilmentTab>("all-active");
  const [asking, setAsking] = useState<number | null>(null);
  const moves: Moves = { asking, ask: setAsking, onMove: (id, status) => move({ id, status }) };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
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

      <div role="tabpanel" aria-label={TABS.find((t) => t.key === tab)?.label} className="flex min-h-0 flex-1 flex-col">
        {tab === "all-active" ? <Columns board={board} moves={moves} /> : <Grid key={tab} tab={tab} orders={ordersOnTab(board, tab)} moves={moves} />}
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
