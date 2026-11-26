/**
 * The Figma frame's columns; they share the table width in proportion, so the rows fill the card edge to
 * edge. Money sits on the right of its column and the last column ends flush with the card's padding.
 */
export const COLUMNS: { key: string; header: string; className: string; align?: "right" }[] = [
  { key: "order", header: "Order", className: "flex-[1_1_90px]" },
  { key: "date", header: "Date", className: "flex-[1_1_110px]" },
  { key: "customer", header: "Customer", className: "min-w-0 flex-[2_1_150px]" },
  { key: "items", header: "Items", className: "min-w-0 flex-[3_1_220px]" },
  { key: "total", header: "Total", className: "flex-[1_1_110px] justify-end pr-8", align: "right" },
  { key: "payment", header: "Payment", className: "flex-[1_1_100px]" },
  { key: "status", header: "Status", className: "flex-[1_1_130px] justify-end", align: "right" },
];

export const HEAD = "flex items-start overflow-clip";
/** Header and rows: the columns spread across the card, edge to edge. */
export const ROW = "flex w-full items-center justify-between";
export const CELL = "flex items-start overflow-clip text-sm leading-[normal] text-[#1f1a2e]";
