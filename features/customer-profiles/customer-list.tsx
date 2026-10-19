import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollableTable } from "@/components/shared/scrollable-table";

import type { CustomerList, SortKey } from "./customers";
import { formatDate, formatPesos } from "./format";

export interface ListParams {
  search: string;
  sort: SortKey;
  direction: "asc" | "desc";
  page: number;
}

const COLUMNS: { key: SortKey; header: string; className?: string }[] = [
  { key: "name", header: "Name" },
  { key: "email", header: "Email" },
  { key: "contactNumber", header: "Contact number" },
  { key: "orders", header: "Orders", className: "text-right" },
  { key: "totalSpent", header: "Total spent", className: "text-right" },
  { key: "lastOrder", header: "Last order" },
  { key: "customerSince", header: "Customer since" },
];

function href(params: ListParams, change: Partial<ListParams>): string {
  const next = { ...params, ...change };
  const query = new URLSearchParams();

  if (next.search) query.set("q", next.search);
  query.set("sort", next.sort);
  query.set("dir", next.direction);
  if (next.page > 1) query.set("page", String(next.page));

  return `/customer-profiles?${query}`;
}

export function CustomerListView({ list, params }: { list: CustomerList; params: ListParams }) {
  return (
    <div className="space-y-md">
      <form action="/customer-profiles" className="relative max-w-[24rem]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          name="q"
          defaultValue={params.search}
          placeholder="Search name, email or contact number"
          className="pl-9"
        />
        <input type="hidden" name="sort" value={params.sort} />
        <input type="hidden" name="dir" value={params.direction} />
      </form>

      {list.rows.length === 0 ? (
        <div className="p-xl text-center text-muted-foreground border border-border rounded-lg">
          {params.search ? "No Customers match your search." : "No Customers yet."}
        </div>
      ) : (
        <ScrollableTable>
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                {COLUMNS.map((col) => {
                  const active = params.sort === col.key;
                  const direction = active && params.direction === "desc" ? "asc" : "desc";

                  return (
                    <TableHead key={col.key} className={col.className}>
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
                    </TableHead>
                  );
                })}
                <TableHead>Cart</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>{row.email}</TableCell>
                  <TableCell>{row.contactNumber}</TableCell>
                  <TableCell className="text-right">{row.orders}</TableCell>
                  <TableCell className="text-right">{formatPesos(row.totalSpent)}</TableCell>
                  <TableCell>
                    {row.lastOrder ? formatDate(row.lastOrder) : "No orders yet"}
                  </TableCell>
                  <TableCell>{formatDate(row.customerSince)}</TableCell>
                  <TableCell>
                    {row.cartHasItems ? <Badge>Has items</Badge> : (
                      <span className="text-muted-foreground">Empty</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollableTable>
      )}

      <div className="flex items-center justify-between pt-2">
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
    </div>
  );
}
