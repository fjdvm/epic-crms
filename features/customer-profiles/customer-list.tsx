import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { CustomerList, SortKey } from "./customers";
import { STAGES } from "./customers";
import { STAGE_LABELS, type Stage } from "./rules";
import { LiveRow } from "./live-row";
import { StageBadge } from "./stage-badge";
import { formatDate, formatWholePesos } from "./format";

export interface ListParams {
  search: string;
  /** Undefined shows All. */
  stage?: Stage;
  sort: SortKey;
  direction: "asc" | "desc";
  page: number;
}

/** Column widths follow the design: fixed, with Contact taking the rest so the table fills the card. */
const COLUMNS: { key: SortKey | null; header: string; className: string }[] = [
  { key: "name", header: "Customer", className: "shrink-0 w-[220px]" },
  { key: "email", header: "Contact", className: "flex-1 min-w-[340px]" },
  { key: null, header: "Stage", className: "shrink-0 w-[120px]" },
  { key: "orders", header: "Orders", className: "shrink-0 w-[90px]" },
  { key: "totalSpent", header: "Total spent", className: "shrink-0 w-[140px]" },
  { key: "lastOrder", header: "Last order", className: "shrink-0 w-[140px]" },
];

function href(params: ListParams, change: Partial<ListParams>): string {
  const next = { ...params, ...change };
  const query = new URLSearchParams();

  if (next.search) query.set("q", next.search);
  if (next.stage) query.set("stage", next.stage);
  query.set("sort", next.sort);
  query.set("dir", next.direction);
  if (next.page > 1) query.set("page", String(next.page));

  return `/customer-profiles?${query}`;
}

const CELL = "py-[11px] pr-3 text-sm text-foreground";

export function CustomerListView({ list, params }: { list: CustomerList; params: ListParams }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <form action="/customer-profiles" className="relative w-full max-w-[24rem]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={params.search}
            placeholder="Search name, email or contact number"
            className="pl-9"
          />
          {params.stage && <input type="hidden" name="stage" value={params.stage} />}
          <input type="hidden" name="sort" value={params.sort} />
          <input type="hidden" name="dir" value={params.direction} />
        </form>
        <Button asChild>
          <Link href="/customer-profiles/new">
            <Plus className="size-4" /> Add customer
          </Link>
        </Button>
      </div>

      <nav aria-label="Stage" className="flex flex-wrap gap-1">
        {[undefined, ...STAGES].map((stage) => {
          const count = stage
            ? list.stageCounts[stage]
            : STAGES.reduce((sum, s) => sum + list.stageCounts[s], 0);
          const active = params.stage === stage;

          return (
            <Link
              key={stage ?? "all"}
              href={href(params, { stage, page: 1 })}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-lg px-3.5 py-2 text-sm font-medium",
                active ? "bg-accent text-primary" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {stage ? STAGE_LABELS[stage] : "All"} {count}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-[14px] rounded-xl border border-border bg-card p-5">
        {list.rows.length === 0 ? (
          <div className="p-xl text-center text-muted-foreground">
            {params.search || params.stage ? "No Customers match." : "No Customers yet."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[1010px]">
              <div className="flex items-center border-b border-border-subtle py-1.5 text-xs font-medium text-muted-foreground">
                {COLUMNS.map((col) => {
                  if (!col.key) {
                    return (
                      <div key="stage" className={cn(col.className)}>
                        {col.header}
                      </div>
                    );
                  }

                  const active = params.sort === col.key;
                  const direction = active && params.direction === "desc" ? "asc" : "desc";

                  return (
                    <div key={col.key} className={cn(col.className)}>
                      <Link
                        href={href(params, { sort: col.key, direction, page: 1 })}
                        className="inline-flex items-center gap-1"
                      >
                        {col.header}
                        {active &&
                          (params.direction === "asc" ? (
                            <ArrowUp className="size-3" />
                          ) : (
                            <ArrowDown className="size-3" />
                          ))}
                      </Link>
                    </div>
                  );
                })}
              </div>
              {list.rows.map((row) => (
                <LiveRow
                  key={row.id}
                  customerId={row.id}
                  className="relative flex items-center border-b border-border-subtle last:border-0 hover:bg-secondary"
                >
                  <div className={cn(CELL, COLUMNS[0].className, "flex items-center gap-2 font-medium text-primary")}>
                    <Link href={`/customer-profiles/${encodeURIComponent(row.id)}`} className="truncate after:absolute after:inset-0">
                      {row.name}
                    </Link>
                    {row.walkIn && <Badge variant="secondary">Walk-in</Badge>}
                  </div>
                  <div className={cn(CELL, COLUMNS[1].className, "truncate")}>
                    {row.email ? `${row.email} · ${row.contactNumber}` : row.contactNumber}
                  </div>
                  <div className={cn(COLUMNS[2].className)}>
                    <StageBadge stage={row.stage} />
                  </div>
                  <div className={cn(CELL, COLUMNS[3].className)}>{row.orders}</div>
                  <div className={cn(CELL, COLUMNS[4].className)}>{formatWholePesos(row.totalSpent)}</div>
                  <div className={cn(CELL, COLUMNS[5].className)}>
                    {row.lastOrder ? formatDate(row.lastOrder) : "No orders yet"}
                  </div>
                </LiveRow>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {list.matching === 0
              ? "No profiles"
              : `Showing ${(list.page - 1) * list.pageSize + 1}–${Math.min(
                  list.page * list.pageSize,
                  list.matching,
                )} of ${list.matching} profiles`}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild={list.page > 1} disabled={list.page <= 1}>
              {list.page > 1 ? (
                <Link aria-label="Previous page" href={href(params, { page: list.page - 1 })}>
                  <ChevronLeft className="size-4" />
                </Link>
              ) : (
                <ChevronLeft className="size-4" />
              )}
            </Button>
            <span className="text-sm font-medium">
              {list.page} / {list.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              asChild={list.page < list.totalPages}
              disabled={list.page >= list.totalPages}
            >
              {list.page < list.totalPages ? (
                <Link aria-label="Next page" href={href(params, { page: list.page + 1 })}>
                  <ChevronRight className="size-4" />
                </Link>
              ) : (
                <ChevronRight className="size-4" />
              )}
            </Button>
          </div>
        </div>

        <p className="rounded-lg bg-secondary px-3 py-2.5 text-xs text-muted-foreground">
          Lifecycle stage is calculated from orders: New = no order, First order = 1, Repeat = 2+, At
          risk = no order in 60 days, Lost = no order in 120 days.
        </p>
      </div>
    </div>
  );
}
