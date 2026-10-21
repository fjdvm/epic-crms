import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { orderAnchor } from "@/features/customer-profiles/orders";
import { formatDate } from "@/features/customer-profiles/format";

import { feedbackAnchor } from "./anchor";
import type { FeedbackList } from "./feedback";
import { ProductFilter, StarFilter } from "./feedback-toolbar";
import { feedbackHref, type FeedbackFilters } from "./filters";

/** Filled and empty stars as the Figma draws them; 4 and 5 are gold, lower ratings amber. */
function Stars({ rating }: { rating: number }) {
  return (
    <p
      role="img"
      aria-label={`${rating} out of 5 stars`}
      className={`shrink-0 text-sm font-medium leading-[normal] ${rating >= 4 ? "text-[#c89211]" : "text-[#d9822b]"}`}
    >
      {"★".repeat(rating)}
      {"☆".repeat(5 - rating)}
    </p>
  );
}

export function FeedbackListView({ list, filters }: { list: FeedbackList; filters: FeedbackFilters }) {
  const filtered = Boolean(filters.from || filters.to || filters.stars !== undefined || filters.product);
  const href = (page: number) => feedbackHref({ ...filters, page });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-xl border border-[#e6e1ee] bg-white p-5">
      <div className="flex shrink-0 items-center justify-between gap-3">
        {filters.product ? (
          <div className="min-w-0 space-y-1">
            <Link
              href={feedbackHref({ ...filters, product: undefined, page: 1 })}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#5b2a86] hover:underline"
            >
              <ArrowLeft className="size-3" /> All Feedback
            </Link>
            <h2 className="truncate text-base font-semibold leading-[normal] text-[#1f1a2e]">{filters.product}</h2>
            <p className="text-xs leading-[normal] text-[#6e6680]" data-testid="product-feedback-count">
              {list.total} Feedback
            </p>
          </div>
        ) : (
          <h2 className="text-base font-semibold leading-[normal] text-[#1f1a2e]">Latest feedback</h2>
        )}
        <div className="flex shrink-0 items-center gap-2">
          <ProductFilter filters={filters} products={list.products} />
          <StarFilter filters={filters} />
        </div>
      </div>
      {list.rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-[#6e6680]">{filtered ? "No Feedback matches these filters." : "No Feedback yet."}</div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-auto">
          {list.rows.map((row) => (
            <li key={row.orderId} id={feedbackAnchor(row.orderId)} className="flex scroll-mt-3 flex-col gap-1 border-b border-[#efebf4] py-3">
              <div className="flex items-center gap-[10px] text-[13px] font-medium leading-[normal] text-[#1f1a2e]">
                <Stars rating={row.rating} />
                <p className="min-w-0 flex-1">
                  <Link href={`/customer-profiles/${row.customerId}`} className="text-[#5b2a86] hover:underline">
                    {row.customerName}
                  </Link>
                  {" · "}
                  <Link
                    href={`/customer-profiles/${row.customerId}#${orderAnchor(row.orderId)}`}
                    className="text-[#5b2a86] hover:underline"
                  >
                    #{row.orderId}
                  </Link>
                  {row.products.length > 0 && " · "}
                  {row.products.map((name, i) => (
                    <span key={name}>
                      {i > 0 && ", "}
                      <Link
                        href={feedbackHref({ ...filters, product: name, page: 1 })}
                        className="text-[#5b2a86] hover:underline"
                      >
                        {name}
                      </Link>
                    </span>
                  ))}
                </p>
                <span className="shrink-0 text-xs font-normal text-[#6e6680]">{formatDate(row.createdAt)}</span>
              </div>
              {row.comment && <p className="text-sm leading-[normal] text-[#1f1a2e]">{row.comment}</p>}
            </li>
          ))}
        </ul>
      )}
      {list.totalPages > 1 && (
        <div className="flex shrink-0 items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {list.page} of {list.totalPages}
          </span>
          <div className="flex gap-2">
            {list.page > 1 && (
              <Button asChild variant="outline" size="sm">
                <Link href={href(list.page - 1)}>
                  <ChevronLeft className="size-4" /> Previous
                </Link>
              </Button>
            )}
            {list.page < list.totalPages && (
              <Button asChild variant="outline" size="sm">
                <Link href={href(list.page + 1)}>
                  Next <ChevronRight className="size-4" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
