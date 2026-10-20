import { cn } from "@/lib/utils";

import type { TicketPriority } from "./tickets";

/** Pill colours from the Figma badges: Open and High share one, Low follows Normal and Urgent follows High. */
export const PILL = {
  red: "bg-[#fbe6e0] text-[#9a3412]",
  grey: "bg-[#eeecf2] text-[#5a5368]",
  amber: "bg-[#fdf1d8] text-[#8a5a00]",
  green: "bg-[#e3f4e8] text-[#1e6b3a]",
  blue: "bg-[#e3eefb] text-[#1d4f91]",
  purple: "bg-[#efe6f8] text-[#5b2a86]",
} as const;

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const PRIORITY_PILLS: Record<TicketPriority, string> = {
  low: PILL.grey,
  normal: PILL.grey,
  high: PILL.red,
  urgent: PILL.red,
};

export function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-[10px] py-[3px] text-xs font-medium leading-[normal] whitespace-nowrap",
        className,
      )}
    >
      {children}
    </span>
  );
}
