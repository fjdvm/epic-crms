import { ChevronDown } from "lucide-react";

import { RULES } from "./fulfilment-layout";

/** What each move does, folded away so the board keeps the height. Shared with the loading skeleton. */
export function MoveRules() {
  return (
    <details className="group shrink-0 rounded-xl border border-[#e6e1ee] bg-white leading-[normal]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-5 py-3 [&::-webkit-details-marker]:hidden">
        <h2 className="text-sm font-semibold text-[#1f1a2e]">What each move does</h2>
        <ChevronDown aria-hidden className="size-4 text-[#6e6680] group-open:rotate-180" />
      </summary>
      <dl className="grid grid-cols-3 gap-4 px-5 pb-4">
        {RULES.map(({ move, effect }) => (
          <div key={move} className="space-y-1">
            <dt className="text-[13px] font-medium text-[#1f1a2e]">{move}</dt>
            <dd className="text-xs text-[#6e6680]">{effect}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
