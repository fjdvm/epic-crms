import Link from "next/link";
import type { ComponentProps, KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

/**
 * A whole table row that opens what it represents (the pattern the Orders and Customers lists started).
 * Put `CLICKABLE_ROW` on the row, make the row's main link a `RowLink`, and give every other button or
 * link inside the row `ABOVE_ROW_LINK` so it keeps its own action. A real link, so middle-click, a new
 * tab, the keyboard and screen readers all work; it prefetches like any Link, so the page opens at once.
 */
export const CLICKABLE_ROW = "relative cursor-pointer hover:bg-[#faf8fc] focus-within:bg-[#faf8fc]";

/** For a button, link or input inside a clickable row: sits above the row's link so it keeps its own click. */
export const ABOVE_ROW_LINK = "relative z-10";

/** The row's main link. Its `::after` covers the whole row (the nearest `relative` ancestor). */
export function RowLink({ className, ...props }: ComponentProps<typeof Link>) {
  return <Link {...props} className={cn("after:absolute after:inset-0 after:content-['']", className)} />;
}

/**
 * For a row that opens a drawer, dialog or tab instead of a page: makes the row a keyboard-reachable
 * button. Clicks that land on a button, link or input inside the row are left to that control.
 */
export function rowButton(open: () => void, label: string) {
  const inner = (target: EventTarget | null, row: Element) => {
    const hit = target instanceof Element ? target.closest("button, a, input, select, textarea, label, [role=button]") : null;
    return hit !== null && hit !== row;
  };
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": label,
    onClick: (event: { target: EventTarget | null; currentTarget: Element }) => {
      if (!inner(event.target, event.currentTarget)) open();
    },
    onKeyDown: (event: KeyboardEvent<Element>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    },
  };
}
