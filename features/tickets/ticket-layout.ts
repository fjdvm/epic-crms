/**
 * The list's column layout. It lives outside ticket-rows.tsx (a client module) so the server-rendered list and its
 * skeleton read real values: a server component only gets a reference from a client module's exports, and
 * calling COLUMNS.map on it fails with "COLUMNS.map is not a function".
 */
export const COLUMNS: { header: string; className: string }[] = [
  { header: "Details", className: "min-w-0 flex-[4_1_340px]" },
  { header: "Service level", className: "flex-[1_1_110px]" },
  { header: "Assigned", className: "min-w-0 flex-[1.5_1_150px]" },
  { header: "Priority", className: "flex-[1_1_100px]" },
  { header: "Activity status", className: "min-w-0 flex-[1.5_1_150px]" },
  { header: "Status", className: "flex-[1_1_110px]" },
];

export const HEAD = "flex items-start overflow-clip";
export const CELL = "flex items-center overflow-clip text-sm leading-[normal] text-[#1f1a2e]";
