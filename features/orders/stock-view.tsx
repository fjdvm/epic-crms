"use client";

import Link from "next/link";
import { useState } from "react";

import { PILL, Pill } from "@/features/tickets/pill";
import { cn } from "@/lib/utils";

import { LOW_STOCK_BELOW, shopLabel, type StockPage, type StockRow } from "./stock";

type Tab = "all" | "low" | "sold-out";

const GRID = "flex items-center gap-2 px-4";
const COLUMN = { stock: "w-[120px] shrink-0", reserved: "w-[100px] shrink-0", available: "w-[140px] shrink-0", shows: "w-[170px] shrink-0", low: "w-[80px] shrink-0" };

const isLow = (row: StockRow) => typeof row.shows === "object";
const isSoldOut = (row: StockRow) => row.shows === "Sold out";

function ShowsPill({ row }: { row: StockRow }) {
  const tone = isSoldOut(row) ? PILL.red : isLow(row) ? PILL.amber : row.shows === "Unknown" ? PILL.grey : PILL.green;
  return <Pill className={tone}>{shopLabel(row.shows)}</Pill>;
}

const quantity = (value: number | null) => (value === null ? "–" : value);

export function StockHeader({ children }: { children?: React.ReactNode }) {
  return (
    <div className="shrink-0 space-y-3">
      <nav aria-label="Breadcrumb" className="flex gap-1.5 text-[13px] font-medium text-[#6e6680]">
        <Link href="/orders">Orders</Link>
        <span className="text-[#1f1a2e]">/ Products &amp; stock</span>
      </nav>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Products &amp; stock</h1>
            <Pill className="bg-[#e1f5ee] text-[#0f6e56]">From IMS</Pill>
          </div>
          <p className="text-sm text-[#6e6680]">
            What the online shop can sell. Quantities come from IMS and are read when you open this page. Stock is reserved when an order is placed and released if it&apos;s cancelled.
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}

function Tile({ label, value, note, tone }: { label: string; value: string; note: string; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-xl border border-[#e6e1ee] bg-white px-[18px] py-4">
      <p className="text-[13px] font-medium text-[#6e6680]">{label}</p>
      <p className="text-2xl font-semibold text-[#1f1a2e]">{value}</p>
      <p className={cn("text-xs text-[#6e6680]", tone)}>{note}</p>
    </div>
  );
}

export function StockView({ page }: { page: StockPage }) {
  const [tab, setTab] = useState<Tab>("all");
  const { summary } = page;
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "all", label: "All sizes", count: page.rows.length },
    { id: "low", label: "Low stock", count: summary.low },
    { id: "sold-out", label: "Sold out", count: summary.soldOut },
  ];
  const rows = page.rows.filter((row) => (tab === "low" ? isLow(row) : tab === "sold-out" ? isSoldOut(row) : true));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      {!page.imsReachable && (
        <p role="alert" className="rounded-[10px] bg-[#fdf1d8] p-3 text-sm text-[#8a5a00]">
          The IMS could not be reached, so quantities are not shown. Reload to try again. The shop still refuses to sell what is not there.
        </p>
      )}
      <div className="flex flex-wrap gap-4">
        <Tile label="Sizes on sale" value={String(summary.sizes)} note={`${summary.soldOut} sold out`} />
        <Tile label="Reserved by open orders" value={`${summary.reserved} items`} note="Not yet packed" />
        <Tile label="Low stock" value={`${summary.low} sizes`} note={`Below ${LOW_STOCK_BELOW} left`} tone={summary.low > 0 ? "text-[#b45309]" : undefined} />
      </div>
      <div role="tablist" aria-label="Stock filter" className="flex gap-1">
        {tabs.map(({ id, label, count }) => (
          <button
            key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={cn("flex items-center gap-1.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium", tab === id ? "bg-[#efe8f7] text-[#5b2a86]" : "text-[#52525b]")}
          >
            {label}
            <span className={cn("rounded-full px-1.5 py-px text-[11px] font-semibold", tab === id ? "bg-[#5b2a86] text-white" : "bg-[#e4e4e7] text-[#52525b]")}>{count}</span>
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-[#e6e1ee] bg-white">
        <div className="min-w-[780px]">
          <div className={cn(GRID, "rounded-t-xl bg-[#fafafa] py-2.5 text-xs font-medium text-[#71717a]")}>
            <div className="min-w-0 flex-1">Product · size</div>
            <div className={COLUMN.stock}>In stock (IMS)</div>
            <div className={COLUMN.reserved}>Reserved</div>
            <div className={COLUMN.available}>Available online</div>
            <div className={COLUMN.shows}>Shop shows</div>
            <div className={COLUMN.low}>Low at</div>
          </div>
          {rows.length === 0 && <p className="border-t border-[#f0edf4] p-8 text-center text-sm text-[#6e6680]">No sizes here.</p>}
          {rows.map((row) => (
            <div key={row.sizeId} data-stock-row className={cn(GRID, "border-t border-[#f0edf4] py-3 text-[13px] text-[#18181b]", isSoldOut(row) && "bg-[#fff7f7]")}>
              <div className="min-w-0 flex-1 truncate font-semibold">{row.product} · {row.size}</div>
              <div className={COLUMN.stock}>{quantity(row.inStock)}</div>
              <div className={COLUMN.reserved}>{quantity(row.reserved)}</div>
              <div className={cn(COLUMN.available, "font-semibold", isSoldOut(row) && "text-[#b42318]")}>{quantity(row.available)}</div>
              <div className={COLUMN.shows}><ShowsPill row={row} /></div>
              <div className={COLUMN.low}>{LOW_STOCK_BELOW}</div>
            </div>
          ))}
        </div>
      </div>
      <p className="rounded-[10px] bg-[#f1f1f3] p-3 text-xs text-[#52525b]">
        One fulfilment location: the Warehouse. All online orders are reserved from, packed at and dispatched from there.
      </p>
    </div>
  );
}

/** Same chrome as the loaded page, so it reaches the browser before the data does. */
export function StockSkeleton() {
  return (
    <div role="status" aria-label="Loading Products and stock" className="flex flex-col gap-4">
      <div className="flex gap-4">{[0, 1, 2].map((i) => <div key={i} className="h-[92px] flex-1 animate-pulse rounded-xl bg-[#efebf4]" />)}</div>
      <div className="h-8 w-72 animate-pulse rounded-lg bg-[#efebf4]" />
      <div className="h-72 animate-pulse rounded-xl bg-[#efebf4]" />
    </div>
  );
}
