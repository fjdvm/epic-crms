"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { feedbackHref, quickRange, type FeedbackFilters, type QuickRange } from "./filters";

const QUICK_LINKS: { kind: QuickRange; label: string }[] = [
  { kind: "7d", label: "Last 7 days" },
  { kind: "30d", label: "Last 30 days" },
  { kind: "year", label: "This year" },
];

const SHORT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const LONG = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A "YYYY-MM-DD" day as a Date at local noon, so the calendar shows that same day wherever the browser is. */
function toDate(day: string): Date {
  return new Date(`${day}T12:00:00`);
}

/** The calendar day a picked Date falls on, as "YYYY-MM-DD". */
function toDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "All time", "5 Oct – 7 Oct 2026" or "From 5 Oct 2026". */
export function rangeLabel({ from, to }: Pick<FeedbackFilters, "from" | "to">): string {
  const utc = (day: string) => new Date(`${day}T00:00:00Z`);

  if (from && to) return `${SHORT.format(utc(from))} – ${LONG.format(utc(to))}`;
  if (from) return `From ${LONG.format(utc(from))}`;
  if (to) return `Until ${LONG.format(utc(to))}`;

  return "All time";
}

/** The calendar button that replaces Export in the header: a popover with a two-month range calendar. */
export function DateRangeButton({ filters, today }: { filters: FeedbackFilters; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();

  const apply = (range: { from?: string; to?: string }) => {
    setOpen(false);
    setDraft(undefined);
    router.push(feedbackHref({ ...filters, ...range, page: 1 }));
  };

  const selected: DateRange | undefined =
    draft ?? (filters.from || filters.to
      ? { from: filters.from ? toDate(filters.from) : undefined, to: filters.to ? toDate(filters.to) : undefined }
      : undefined);

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setDraft(undefined); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Date range: ${rangeLabel(filters)}`}
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-[#e6e1ee] bg-white px-[14px] py-[9px] text-sm font-medium leading-[normal] text-[#1f1a2e]"
        >
          <CalendarDays className="size-4" />
          {rangeLabel(filters)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-3">
        <div className="flex gap-4">
          <div className="flex flex-col gap-1 border-r border-[#efebf4] pr-4">
            {QUICK_LINKS.map(({ kind, label }) => (
              <Button key={kind} variant="ghost" size="sm" className="justify-start" onClick={() => apply(quickRange(kind, today))}>
                {label}
              </Button>
            ))}
            <Button variant="ghost" size="sm" className="justify-start text-[#6e6680]" onClick={() => apply({ from: undefined, to: undefined })}>
              Clear
            </Button>
          </div>
          <Calendar
            mode="range"
            numberOfMonths={2}
            defaultMonth={selected?.from ?? toDate(today)}
            today={toDate(today)}
            selected={selected}
            onSelect={(_, picked) => {
              // The first click starts a range and the second completes it, whichever order the days come in.
              if (!draft?.from) return setDraft({ from: picked, to: undefined });

              const [from, to] = [toDay(draft.from), toDay(picked)].sort();
              apply({ from, to });
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Narrows the list to one rating; "All ratings" is the default. */
export function StarFilter({ filters }: { filters: FeedbackFilters }) {
  const router = useRouter();

  return (
    <Select
      value={filters.stars === undefined ? "all" : String(filters.stars)}
      onValueChange={(value) =>
        router.push(feedbackHref({ ...filters, stars: value === "all" ? undefined : Number(value), page: 1 }))
      }
    >
      <SelectTrigger aria-label="Rating" className="h-9 w-[140px] border-[#e6e1ee] text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All ratings</SelectItem>
        {[5, 4, 3, 2, 1].map((stars) => (
          <SelectItem key={stars} value={String(stars)}>
            {"★".repeat(stars)} {stars} {stars === 1 ? "star" : "stars"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
