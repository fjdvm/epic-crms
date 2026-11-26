// Rendered only inside AreaSection, which is the client boundary.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import type { PeriodDays, ProductFigures } from "./insights";
import { formatMetric, METRIC_LABELS, METRICS, MIN_RATINGS, productChange, productName, rankProducts, type Metric } from "./products";

/** How products are counted: the metric they are ranked by, and whether each size ranks on its own. Shared with Top areas. */
export interface ProductView { metric: Metric; bySize: boolean }

export const DEFAULT_PRODUCT_VIEW: ProductView = { metric: "units", bySize: false };

/** The Metrics a person may rank by; Rating needs the Feedback Module. */
export const metricsFor = (canSeeRatings: boolean) => METRICS.filter((m) => m !== "rating" || canSeeRatings);

/** Products per page in Top products. */
export const PAGE_SIZE = 5;

function Toggle<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-xs text-[#71717a]">{label}</span>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
          className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#52525b] hover:bg-[#f5f0fa] aria-checked:bg-[#efe7f7] aria-checked:text-[#5b2a86]">
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ProductViewControls({ view, onChange, canSeeRatings }: { view: ProductView; onChange: (view: ProductView) => void; canSeeRatings: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <Toggle label="Rank by" value={view.metric} onChange={(metric) => onChange({ ...view, metric })}
        options={metricsFor(canSeeRatings).map((m) => ({ value: m, label: METRIC_LABELS[m] }))} />
      <Toggle label="Products" value={view.bySize ? "size" : "product"} onChange={(v) => onChange({ ...view, bySize: v === "size" })}
        options={[{ value: "product", label: "Product" }, { value: "size", label: "Product + size" }]} />
    </div>
  );
}

function Change({ row, metric }: { row: ProductFigures; metric: Metric }) {
  const change = productChange(row, metric);
  if (!change) return null;
  return <span className={change.up ? "text-xs font-medium text-[#15803d]" : "text-xs font-medium text-[#b91c1c]"}>{change.label}</span>;
}

/** A ranked list of products, used by Top products and by an area's favourites. */
export function ProductList({ rows, metric, limit, start = 0 }: { rows: ProductFigures[]; metric: Metric; limit?: number; start?: number }) {
  return (
    <ol className="flex flex-col" start={start + 1}>
      {rows.slice(start, limit === undefined ? undefined : start + limit).map((row, index) => (
        <li key={productName(row)} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm">
          <span className="w-5 text-xs text-[#a1a1aa]">{start + index + 1}</span>
          <span className="min-w-0 flex-1 truncate text-[#18181b]">{productName(row)}</span>
          <span className="tabular-nums font-medium text-[#18181b]">{formatMetric(row, metric)}</span>
          <span className="w-12 text-right"><Change row={row} metric={metric} /></span>
        </li>
      ))}
    </ol>
  );
}

/**
 * "Top products": every product sold in the period, ranked by units, sales value, Orders or Customer rating. From the
 * stored morning run; nothing is worked out on the server again and no model is asked.
 */
export function ProductRanking({ products, view, onView, canSeeRatings, days, enoughData }: {
  products: ProductFigures[] | null; view: ProductView; onView: (view: ProductView) => void; canSeeRatings: boolean;
  days: PeriodDays; enoughData: boolean;
}) {
  const [page, setPage] = useState(0);
  const ranked = products && enoughData ? rankProducts(products, { scope: "all", bySize: view.bySize, metric: view.metric }) : [];
  const pages = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const start = current * PAGE_SIZE;
  // A new ranking starts again from the first page.
  const changeView = (next: ProductView) => { setPage(0); onView(next); };

  return (
    <section aria-label="Top products" className="flex min-w-0 flex-col gap-3 rounded-2xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 text-[15px] font-semibold text-[#18181b]">Top products</h2>
        <span className="rounded-full bg-[#f4f4f5] px-2.5 py-1 text-xs text-[#52525b]">Last {days} days</span>
      </div>
      <ProductViewControls view={view} onChange={changeView} canSeeRatings={canSeeRatings} />
      {!products ? (
        <p className="text-sm text-[#71717a]">Product rankings show after the next morning run at 6:00 am.</p>
      ) : ranked.length === 0 ? (
        <p className="text-sm text-[#71717a]">No products to rank yet. Rankings appear once there are enough orders.</p>
      ) : (
        <>
          <p className="text-xs text-[#71717a]">
            {view.metric === "rating"
              ? `Average star rating from Customer Feedback on Orders with the product. Shown from ${MIN_RATINGS} rated Orders.`
              : `All products sold, compared with ${days === 7 ? "the week" : "the 30 days"} before.`}
          </p>
          <ProductList rows={ranked} metric={view.metric} limit={PAGE_SIZE} start={start} />
          {pages > 1 && (
            <nav aria-label="Top products pages" className="flex items-center justify-between gap-2 border-t border-[#f0edf4] pt-3 text-xs text-[#71717a]">
              <span className="tabular-nums">{start + 1}–{Math.min(start + PAGE_SIZE, ranked.length)} of {ranked.length}</span>
              <div className="flex items-center gap-1">
                <button type="button" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)}
                  className="rounded-lg p-1.5 text-[#52525b] hover:bg-[#f5f0fa] disabled:opacity-40 disabled:hover:bg-transparent">
                  <ChevronLeft className="size-4" aria-hidden />
                </button>
                <span className="tabular-nums">Page {current + 1} of {pages}</span>
                <button type="button" aria-label="Next page" disabled={current === pages - 1} onClick={() => setPage(current + 1)}
                  className="rounded-lg p-1.5 text-[#52525b] hover:bg-[#f5f0fa] disabled:opacity-40 disabled:hover:bg-transparent">
                  <ChevronRight className="size-4" aria-hidden />
                </button>
              </div>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
