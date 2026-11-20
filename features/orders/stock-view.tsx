"use client";

import { Link2, Search } from "lucide-react";
import { useState } from "react";

import Link from "next/link";

import { ZoomableImage } from "@/components/zoomable-image";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PILL, Pill } from "@/features/tickets/pill";
import { cn } from "@/lib/utils";

import { LOW_STOCK_BELOW, shopLabel, type HoldingOrder, type StockPage, type StockRow } from "./stock";

type Tab = "all" | "low" | "sold-out";

const GRID = "flex items-center gap-2 px-4";
const COLUMN = { stock: "w-[120px] shrink-0 text-right", reserved: "w-[190px] shrink-0 text-right", shows: "w-[170px] shrink-0" };

const isLow = (row: StockRow) => row.marker === null && typeof row.shows === "object";
const isSoldOut = (row: StockRow) => row.marker === null && row.shows === "Sold out";

function ShowsPill({ row }: { row: StockRow }) {
  if (row.marker) return <Pill className={PILL.grey}>{row.marker.kind === "discontinued" ? "Discontinued" : "Not on shop"}</Pill>;
  const tone = isSoldOut(row) ? PILL.red : isLow(row) ? PILL.amber : row.shows === "Unknown" ? PILL.grey : PILL.green;
  return <Pill className={tone}>{shopLabel(row.shows)}</Pill>;
}

const quantity = (value: number | null) => (value === null ? "–" : value);
const rowLabel = (row: StockRow) => (row.size ? `${row.product} · ${row.size}` : row.product);
const sizes = (count: number) => `${count} ${count === 1 ? "size" : "sizes"}`;

const orderCount = (count: number) => `${count} ${count === 1 ? "Order" : "Orders"}`;

/** "12 reserved · 5 Orders"; the Order count opens the list of Orders holding those units. */
function ReservedCell({ row, onOpen }: { row: StockRow; onOpen: (row: StockRow) => void }) {
  if (row.reserved === null) return <>–</>;
  const count = row.orders?.length ?? 0;
  if (row.orders === null || count === 0) return <>{row.reserved} reserved</>;
  return (
    <>
      {row.reserved} reserved ·{" "}
      <button type="button" onClick={() => onOpen(row)} aria-label={`${orderCount(count)} holding ${rowLabel(row)}`} className="font-medium text-[#5b2a86] underline-offset-2 hover:underline">
        {orderCount(count)}
      </button>
    </>
  );
}

function HoldingOrders({ row, onClose }: { row: StockRow | null; onClose: () => void }) {
  const orders: HoldingOrder[] = row?.orders ?? [];
  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Orders holding {row ? rowLabel(row) : ""}</DialogTitle>
          <DialogDescription>{row?.reserved ?? 0} reserved across {orderCount(orders.length)}.</DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-[60vh] flex-col overflow-y-auto">
          {orders.map((order) => (
            <li key={order.orderId} data-holding-order className="flex items-center gap-3 border-t border-[#f0edf4] py-2.5 text-[13px] first:border-t-0">
              <Link href={`/orders/${order.orderId}`} className="w-16 shrink-0 font-medium text-[#5b2a86] hover:underline">#{order.orderId}</Link>
              <span className="min-w-0 flex-1 truncate text-[#18181b]">{order.customer}</span>
              <span className="shrink-0 text-[#6e6680]">× {order.quantity}</span>
              <Pill className={order.status === "Placed" ? PILL.grey : order.status === "Awaiting payment" ? PILL.amber : PILL.green}>{order.status}</Pill>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** The product's image tile; a click zooms it. No image gives a plain tile that does nothing. */
function ProductImage({ row }: { row: StockRow }) {
  return (
    <div data-image-tile className="size-10 shrink-0 overflow-hidden rounded-lg border border-[#e6e1ee] bg-[#f5f2f9]">
      {row.image && <ZoomableImage src={row.image} alt={row.product} className="size-10 object-cover" />}
    </div>
  );
}

const IMS_URL = process.env.NEXT_PUBLIC_IMS_URL ?? "https://br-sims.vercel.app/";

/** Shared by the page and its loading state, so the Open IMS button never pops in after load. */
export function StockHeader() {
  return (
    <div className="flex shrink-0 items-start gap-2">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Stock</h1>
          <Pill className="bg-[#e1f5ee] text-[#0f6e56]"><Link2 className="mr-1 inline size-3" aria-hidden />From IMS</Pill>
        </div>
        <p className="text-sm text-[#6e6680]">What the online shop can sell. Read-only; quantities come from IMS.</p>
      </div>
      <a href={IMS_URL} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-2 rounded-lg border border-[#e4e4e7] bg-white px-3.5 py-[9px] text-sm font-medium text-[#18181b]">
        <Link2 className="size-4" aria-hidden />
        Open IMS
      </a>
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
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<StockRow | null>(null);
  const { summary } = page;
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "all", label: "All sizes", count: page.rows.length },
    { id: "low", label: "Low stock", count: summary.low },
    { id: "sold-out", label: "Sold out", count: summary.soldOut },
  ];
  const needle = query.trim().toLowerCase();
  const rows = page.rows
    .filter((row) => (tab === "low" ? isLow(row) : tab === "sold-out" ? isSoldOut(row) : true))
    .filter((row) => !needle || rowLabel(row).toLowerCase().includes(needle));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      {!page.imsReachable && (
        <p role="alert" className="rounded-[10px] bg-[#fdf1d8] p-3 text-sm text-[#8a5a00]">
          The IMS could not be reached, so quantities are not shown. Reload to try again. The shop still refuses to sell what is not there.
        </p>
      )}
      <div className="flex flex-wrap gap-4">
        {page.imsReachable ? (
          <>
            <Tile label="Sizes on sale" value={String(summary.sizes - summary.soldOut)} note={`${summary.soldOut} sold out`} />
            <Tile label="Reserved by open orders" value={`${summary.reserved} items`} note="Released if the order is cancelled" />
            <Tile label="Low stock" value={sizes(summary.low)} note={`Below ${LOW_STOCK_BELOW} left`} tone={summary.low > 0 ? "text-[#b45309]" : undefined} />
            <Tile label="Sold out" value={sizes(summary.soldOut)} note="Checkout blocks at 0" tone={summary.soldOut > 0 ? "text-[#b42318]" : undefined} />
          </>
        ) : (
          <>
            <Tile label="Sizes on sale" value="–" note="Unknown until the IMS answers" />
            <Tile label="Reserved by open orders" value="–" note="Released if the order is cancelled" />
            <Tile label="Low stock" value="–" note={`Below ${LOW_STOCK_BELOW} left`} />
            <Tile label="Sold out" value="–" note="Checkout blocks at 0" />
          </>
        )}
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
        <div className="min-w-[770px]">
          <div className="p-3">
            <label className="flex w-[260px] items-center gap-2 rounded-lg border border-[#e4e4e7] bg-white px-3 py-1.5">
              <Search className="size-3.5 text-[#71717a]" aria-hidden />
              <input
                type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product" aria-label="Search product"
                className="w-full bg-transparent text-[13px] text-[#18181b] outline-none placeholder:text-[#a1a1aa]"
              />
            </label>
          </div>
          <div className={cn(GRID, "rounded-t-xl bg-[#fafafa] py-2.5 text-xs font-medium text-[#71717a]")}>
            <div className="min-w-0 flex-1">Products</div>
            <div className={COLUMN.stock}>Stocks</div>
            <div className={COLUMN.reserved}>Reserved</div>
            <div className={COLUMN.shows}>Shop shows</div>
          </div>
          {rows.length === 0 && <p className="border-t border-[#f0edf4] p-8 text-center text-sm text-[#6e6680]">No sizes here.</p>}
          {rows.map((row) => (
            <div key={row.sizeId} data-stock-row className={cn(GRID, "border-t border-[#f0edf4] py-3 text-[13px] text-[#18181b]", isSoldOut(row) && "bg-[#fff7f7]")}>
              <ProductImage row={row} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{rowLabel(row)}</p>
                {row.marker?.kind === "not-on-shop" && <p data-missing className="truncate text-xs font-normal text-[#6e6680]">Missing: {row.marker.missing.join(", ")}</p>}
              </div>
              <div className={COLUMN.stock}>{quantity(row.inStock)}</div>
              <div className={COLUMN.reserved}><ReservedCell row={row} onOpen={setOpened} /></div>
              <div className={COLUMN.shows}><ShowsPill row={row} /></div>
            </div>
          ))}
        </div>
      </div>
      <HoldingOrders row={opened} onClose={() => setOpened(null)} />
    </div>
  );
}

/** Same chrome as the loaded page, so it reaches the browser before the data does. */
export function StockSkeleton() {
  return (
    <div role="status" aria-label="Loading Stock" className="flex flex-col gap-4">
      <div className="flex gap-4">{[0, 1, 2, 3].map((i) => <div key={i} data-skeleton-tile className="h-[92px] flex-1 animate-pulse rounded-xl bg-[#efebf4]" />)}</div>
      <div className="h-8 w-72 animate-pulse rounded-lg bg-[#efebf4]" />
      <div className="rounded-xl border border-[#e6e1ee] bg-white">
        <div className="p-3"><div className="h-8 w-[260px] animate-pulse rounded-lg bg-[#efebf4]" /></div>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => <div key={i} data-skeleton-row className="border-t border-[#f0edf4] px-4 py-3"><div className="h-4 animate-pulse rounded bg-[#efebf4]" /></div>)}
      </div>
    </div>
  );
}
