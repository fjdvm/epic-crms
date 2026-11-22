import Link from "next/link";

import { PILL, Pill } from "@/features/tickets/pill";

import { ExplainFlag } from "./explain-flag";
import type { ReturnFlag } from "./return-flags";

const LABELS: Record<ReturnFlag["rule"], string> = {
  "frequent-returns": "3+ Returns in 90 days",
  "similar-photo": "Similar photo",
};

/** The rule a flag fired on and the earlier Returns to compare. A flag informs Staff; it never blocks. */
export function ReturnFlagNotes({ flags, compact = false, explain }: {
  flags?: ReturnFlag[];
  compact?: boolean;
  /** On the Return only: Managers may ask for an explanation; kept ones are shown to Managers, Admin and CEO. */
  explain?: { returnId: number; canExplain: boolean; kept: Partial<Record<ReturnFlag["rule"], string>> };
}) {
  if (!flags || flags.length === 0) return null;

  return (
    <ul data-return-flags className={compact ? "mt-1 space-y-0.5" : "space-y-2"}>
      {flags.map((flag) => (
        <li key={flag.rule} className={compact ? "text-xs font-normal text-[#9a3412]" : "text-sm text-[#1f1a2e]"}>
          <Pill className={PILL.amber}>{LABELS[flag.rule]}</Pill>
          {!compact && <span className="ml-2">{flag.text}</span>}{" "}
          <span className="text-[#6e6680]">Earlier:</span>{" "}
          {flag.earlier.map((earlier, i) => (
            <span key={earlier.id}>
              {i > 0 && ", "}
              <Link href={`/returns/${earlier.id}`} className="font-medium text-[#5b2a86] hover:underline">{earlier.number}</Link>
            </span>
          ))}
          {explain && !compact && (
            <ExplainFlag returnId={explain.returnId} rule={flag.rule} kept={explain.kept[flag.rule]} canExplain={explain.canExplain} />
          )}
        </li>
      ))}
    </ul>
  );
}
