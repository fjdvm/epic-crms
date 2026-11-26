"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { SelectItem } from "@/components/ui/select";
import {
  ANY,
  FilterSelect,
  UrlSearchInput,
} from "@/components/shared/table-controls/table-toolbar";
import { cn } from "@/lib/utils";

import { PRIORITY_LABELS } from "./pill";
import {
  hasTicketFilters,
  parseTicketParams,
  ticketsHref,
  type TicketParams,
} from "./ticket-params";
import {
  TICKET_PRIORITIES,
  UNCLAIMED,
  type TicketFilterOptions,
  type TicketPriority,
} from "./tickets";

function useTicketParams(): TicketParams {
  const search = useSearchParams();

  return parseTicketParams(Object.fromEntries(search.entries()));
}

/**
 * The search box. It stays mounted while the list under it reloads, so typing is never interrupted; the
 * address follows what is typed, and the list shows its skeleton until the matches arrive. The open chat
 * may not match the new search, so it closes and the first match opens instead.
 */
export function ChatSearchInput({ label, placeholder }: { label: string; placeholder: string }) {
  return <UrlSearchInput label={label} placeholder={placeholder} clear={["ticket"]} />;
}

/** Search, the filters and Clear filters over the Tickets list. Each change goes to the first page. */
export function TicketToolbar({ options }: { options: TicketFilterOptions }) {
  const router = useRouter();
  const params = useTicketParams();

  const go = (change: Partial<TicketParams>) =>
    router.replace(ticketsHref({ ...params, ...change, page: 1 }));
  // The address may name a Category or Claimer no Ticket has; keep it selectable so the Select can show it.
  const categories =
    params.category && !options.categories.includes(params.category)
      ? [params.category, ...options.categories]
      : options.categories;
  const claimerName = options.claimers.find(
    (c) => c.id === params.claimedBy,
  )?.name;

  return (
    <div
      role="search"
      aria-label="Search and filter Tickets"
      className="flex shrink-0 flex-wrap items-center gap-2"
    >
      <ChatSearchInput
        label="Search Tickets"
        placeholder="Ticket no., customer, email or order"
      />

      <FilterSelect
        label="Priority"
        value={params.priority ?? ANY}
        onChange={(v) =>
          go({ priority: v === ANY ? undefined : (v as TicketPriority) })
        }
      >
        <SelectItem value={ANY}>Priority: Any</SelectItem>
        {TICKET_PRIORITIES.map((p) => (
          <SelectItem key={p} value={p}>
            Priority: {PRIORITY_LABELS[p]}
          </SelectItem>
        ))}
      </FilterSelect>

      <FilterSelect
        label="Category"
        value={params.category ?? ANY}
        onChange={(v) => go({ category: v === ANY ? undefined : v })}
      >
        <SelectItem value={ANY}>Category: Any</SelectItem>
        {categories.map((c) => (
          <SelectItem key={c} value={c}>
            Category: {c}
          </SelectItem>
        ))}
      </FilterSelect>

      <FilterSelect
        label="Claimed by"
        value={params.claimedBy ?? ANY}
        onChange={(v) => go({ claimedBy: v === ANY ? undefined : v })}
      >
        <SelectItem value={ANY}>Claimed by: Anyone</SelectItem>
        <SelectItem value={UNCLAIMED}>Claimed by: Unclaimed</SelectItem>
        {params.claimedBy &&
          params.claimedBy !== UNCLAIMED &&
          claimerName === undefined && (
            <SelectItem value={params.claimedBy}>
              Claimed by: {params.claimedBy}
            </SelectItem>
          )}
        {options.claimers.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            Claimed by: {c.name}
          </SelectItem>
        ))}
      </FilterSelect>

      <button
        type="button"
        aria-pressed={Boolean(params.overdue)}
        onClick={() => go({ overdue: params.overdue ? undefined : true })}
        className={cn(
          "h-9 cursor-pointer rounded-lg border px-3 text-sm font-medium leading-[normal]",
          params.overdue
            ? "border-[#5b2a86] bg-[#efe6f8] text-[#5b2a86]"
            : "border-[#e6e1ee] bg-white text-[#1f1a2e]",
        )}
      >
        Overdue
      </button>

      <button
        type="button"
        aria-pressed={Boolean(params.escalated)}
        onClick={() => go({ escalated: params.escalated ? undefined : true })}
        className={cn(
          "h-9 cursor-pointer rounded-lg border px-3 text-sm font-medium leading-[normal]",
          params.escalated
            ? "border-[#5b2a86] bg-[#efe6f8] text-[#5b2a86]"
            : "border-[#e6e1ee] bg-white text-[#1f1a2e]",
        )}
      >
        Escalated
      </button>

      {hasTicketFilters(params) && (
        <button
          type="button"
          onClick={() =>
            router.replace(ticketsHref({ tab: params.tab, page: 1 }))
          }
          className="ml-auto cursor-pointer text-sm font-medium leading-[normal] text-[#5b2a86]"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
