"use client";

import { Check } from "lucide-react";
import { createContext, useContext, useOptimistic } from "react";

import { orderLabel } from "@/features/customer-profiles/rules";
import { FULFILMENT_MODULE, ORDERS_MODULE, PAYMENTS_MODULE } from "@/lib/portal/config";
import { cn } from "@/lib/utils";

import { FulfilmentMove } from "./fulfilment-moves";
import type { OrderDetail } from "./orders";
import { OrdersActions } from "./orders-actions";
import { PaymentsActions } from "./payments-actions";
import { StatusPill } from "./status-pill";

const LiveStatusContext = createContext<{ status: string; move: (status: string) => void } | null>(null);

function useLiveStatus() {
  const live = useContext(LiveStatusContext);
  if (!live) throw new Error("Live Order parts must sit inside OrderLiveProvider");

  return live;
}

/** Holds the Order's status so a move shows in the pill, progress and actions at once, before the server confirms. */
export function OrderLiveProvider({ status, children }: { status: string; children: React.ReactNode }) {
  const [live, move] = useOptimistic(status, (_current, next: string) => next);

  return <LiveStatusContext.Provider value={{ status: live, move }}>{children}</LiveStatusContext.Provider>;
}

export function LiveStatus() {
  return <StatusPill status={useLiveStatus().status} />;
}

/** The steps an Order moves through. Only GCash Delivery Orders go through the payment steps, plus any Order already in one. */
function progressFor(order: OrderDetail): string[] {
  const pays =
    (order.paymentMethod === "gcash" && order.fulfillmentMethod !== "pickup") ||
    order.status === "awaiting payment" ||
    order.status === "paid";

  return [
    "placed",
    "confirmed",
    ...(pays ? ["awaiting payment", "paid"] : []),
    "preparing",
    "dispatched",
    "delivered",
    ...(order.status === "received" ? ["received"] : []),
  ];
}

function Progress({ order }: { order: OrderDetail }) {
  if (order.status === "cancelled") {
    return <p className="text-sm text-[#6e6680]">This Order was cancelled.</p>;
  }

  const steps = progressFor(order);
  const current = steps.indexOf(order.status);

  return (
    <ol aria-label="Order progress" className="flex min-w-max items-start">
      {steps.map((step, i) => (
        <li
          key={step}
          data-done={i <= current}
          aria-current={i === current ? "step" : undefined}
          className={cn("flex items-start", i < steps.length - 1 && "flex-1")}
        >
          <div className="flex w-[84px] shrink-0 flex-col items-center gap-2 text-center">
            <span
              aria-hidden
              className={cn(
                "flex size-8 items-center justify-center rounded-full border-2",
                i < current && "border-[#5b2a86] bg-[#5b2a86] text-white",
                i === current && "border-[#5b2a86] bg-white",
                i > current && "border-[#d9d3e3] bg-white",
              )}
            >
              {i < current && <Check className="size-4" />}
              {i === current && (
                <span className="size-2.5 rounded-full bg-[#5b2a86]" />
              )}
            </span>
            <span
              className={cn(
                "text-xs leading-[normal]",
                i <= current ? "font-medium text-[#1f1a2e]" : "text-[#9a93a8]",
              )}
            >
              {orderLabel(step)}
            </span>
          </div>
          {i < steps.length - 1 && (
            <span
              aria-hidden
              className={cn(
                "mt-4 h-0.5 flex-1",
                i < current ? "bg-[#5b2a86]" : "bg-[#e6e1ee]",
              )}
            />
          )}
        </li>
      ))}
    </ol>
  );
}

export function LiveProgress({ order }: { order: OrderDetail }) {
  return <Progress order={{ ...order, status: useLiveStatus().status }} />;
}

/** The actions the viewer's Modules allow, shown against the live status. */
export function LiveActions({ order, modules }: { order: OrderDetail; modules: readonly string[] }) {
  const { status, move } = useLiveStatus();
  const live = { ...order, status };

  if (!modules.includes(ORDERS_MODULE) && !modules.includes(PAYMENTS_MODULE) && !modules.includes(FULFILMENT_MODULE)) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {modules.includes(ORDERS_MODULE) && <OrdersActions order={live} />}
      {modules.includes(PAYMENTS_MODULE) && (
        <PaymentsActions order={live} withCancel={!modules.includes(ORDERS_MODULE)} />
      )}
      {modules.includes(FULFILMENT_MODULE) && <FulfilmentMove order={live} onMove={move} />}
    </div>
  );
}
