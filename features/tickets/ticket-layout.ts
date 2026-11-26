/**
 * The list's column layout. It lives outside ticket-rows.tsx (a client module) so the server-rendered list and its
 * skeleton read real values: a server component only gets a reference from a client module's exports, and
 * calling COLUMNS.map on it fails with "COLUMNS.map is not a function".
 */
export const COLUMNS: { key: string; header: string; className: string; align?: "right" }[] = [
  { key: "details", header: "Details", className: "min-w-0 flex-[4_1_340px]" },
  { key: "service", header: "Service level", className: "flex-[1_1_110px]" },
  { key: "assigned", header: "Assigned", className: "min-w-0 flex-[1.5_1_150px]" },
  { key: "priority", header: "Priority", className: "flex-[1_1_100px]" },
  { key: "activity", header: "Activity status", className: "min-w-0 flex-[1.5_1_150px]" },
  { key: "status", header: "Status", className: "flex-[1_1_110px] justify-end", align: "right" },
];

export const HEAD = "flex items-start overflow-clip";
/** Header and rows: the columns spread across the card, edge to edge. */
export const ROW = "flex w-full items-center justify-between";
export const CELL = "flex items-center overflow-clip text-sm leading-[normal] text-[#1f1a2e]";
