"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import type { SortDirection } from "@/lib/table/sort-filter";

/**
 * A column heading that sorts the rows in the browser. The arrow shows the current direction; a faint
 * double arrow, on hover, marks a column that can be sorted but isn't.
 */
export function SortHeader({
  label,
  active,
  direction,
  onSort,
  align = "left",
  className,
}: {
  label: string;
  active: boolean;
  direction?: SortDirection;
  onSort: () => void;
  align?: "left" | "right";
  className?: string;
}) {
  const Icon = !active ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;
  const icon = (
    <Icon
      aria-hidden
      className={cn("size-3 shrink-0", !active && "opacity-0 transition-opacity group-hover:opacity-60")}
    />
  );
  const inner = (
    <>
      {align === "right" && icon}
      {label}
      {align === "left" && icon}
    </>
  );
  const sortLabel = active
    ? `${label}, sorted ${direction === "asc" ? "ascending" : "descending"}`
    : `Sort by ${label}`;
  const linkClass = cn(
    "group inline-flex cursor-pointer items-center gap-1 hover:text-foreground",
    active && "text-foreground",
    className,
  );

  return (
    <button type="button" onClick={onSort} aria-label={sortLabel} className={linkClass}>
      {inner}
    </button>
  );
}

/** The `aria-sort` value for a column heading cell. */
export function ariaSort(active: boolean, direction?: SortDirection): "ascending" | "descending" | "none" {
  if (!active) return "none";
  return direction === "asc" ? "ascending" : "descending";
}
