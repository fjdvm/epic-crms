"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { FilterOption } from "@/lib/table/sort-filter";

/** How long typing pauses before the search applies. */
export const TYPING_PAUSE_MS = 150;

/** The Select value for "no filter". */
export const ANY = "any";

/** The search box look shared by every table. */
export function SearchBox({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex h-9 w-full max-w-[320px] items-center gap-2 rounded-lg border border-[#e6e1ee] bg-white px-3 text-sm text-[#1f1a2e] focus-within:border-[#5b2a86]">
      <Search className="size-4 shrink-0 text-[#6e6680]" aria-hidden />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[#6e6680]"
      />
    </label>
  );
}

/**
 * A search box that writes `?q=` once typing pauses. It stays mounted while the list under it reloads, so
 * typing is never interrupted. `clear` names other params the new search makes stale (always `page`).
 */
export function UrlSearchInput({
  label,
  placeholder,
  clear = [],
}: {
  label: string;
  placeholder: string;
  clear?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const current = search.get("q") ?? "";
  const [value, setValue] = useState(current);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pushed = useRef(current);

  // The address changed from outside (Clear filters, Back), not by this box: show what it says.
  useEffect(() => {
    if (current !== pushed.current) {
      pushed.current = current;
      setValue(current);
    }
  }, [current]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const change = (next: string) => {
    setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      pushed.current = next.trim();
      const query = new URLSearchParams(search.toString());
      if (next.trim()) query.set("q", next.trim());
      else query.delete("q");
      for (const key of ["page", ...clear]) query.delete(key);
      const text = query.toString();
      router.replace(text ? `${pathname}?${text}` : pathname);
    }, TYPING_PAUSE_MS);
  };

  return <SearchBox label={label} placeholder={placeholder} value={value} onChange={change} />;
}

/** A dropdown filter. Highlighted while it narrows the list. */
export function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          "h-9 w-auto min-w-[130px] gap-2 border-[#e6e1ee] bg-white text-sm",
          value !== ANY && "border-[#5b2a86] bg-[#efe6f8] text-[#5b2a86]",
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

/** A dropdown filter built from options; "Any" clears it. */
export function OptionFilter({
  label,
  options,
  value,
  onChange,
  anyLabel = "Any",
}: {
  label: string;
  options: FilterOption[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  anyLabel?: string;
}) {
  // The address may name a value no row has; keep it selectable so the Select can show it.
  const all = value && !options.some((o) => o.value === value) ? [{ value, label: value }, ...options] : options;

  return (
    <FilterSelect label={label} value={value ?? ANY} onChange={(v) => onChange(v === ANY ? undefined : v)}>
      <SelectItem value={ANY}>
        {label}: {anyLabel}
      </SelectItem>
      {all.map((o) => (
        <SelectItem key={o.value} value={o.value}>
          {label}: {o.label}
        </SelectItem>
      ))}
    </FilterSelect>
  );
}

export function ClearFilters({ onClear }: { onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="ml-auto cursor-pointer text-sm font-medium leading-[normal] text-[#5b2a86]"
    >
      Clear filters
    </button>
  );
}

/** The row of search, filters and Clear filters above a table. */
export function ToolbarRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="search" aria-label={label} className="flex shrink-0 flex-wrap items-center gap-2">
      {children}
    </div>
  );
}
