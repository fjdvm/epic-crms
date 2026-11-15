"use client";

import { AlertTriangle } from "lucide-react";

import { COD_CHOICES, COD_CHOICE_LABELS, type CodChoice } from "./cod-flags";

export type CodFlagLine = { rule: string; label: string; reason: string };

/**
 * The flags that fired, each with the rule behind it, and what Staff want to do about them. Rules only: no scores,
 * no percentages, nothing blocked. The Customer is never told.
 */
export function CodConfirmPanel({ flags, choice, onChoose }: { flags: readonly CodFlagLine[]; choice: CodChoice | null; onChoose: (choice: CodChoice) => void }) {
  return (
    <div data-testid="cod-confirm" className="space-y-3">
      <div className="space-y-2 rounded-lg bg-[#fdf1d8] p-3 text-[#8a5a00]">
        <p className="text-[13px] font-medium">Flags to check</p>
        <ul className="space-y-1.5">
          {flags.map((f) => (
            <li key={f.rule} className="flex items-start gap-2">
              <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span><span className="block text-[13px] font-medium">{f.label}</span><span className="block text-xs">{f.reason}</span></span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-[#6e6680]">Flags are reasons to double-check, not a verdict. The Customer is never told about them.</p>
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-[13px] font-medium text-foreground">What do you want to do?</legend>
        {COD_CHOICES.map((c) => (
          <label key={c} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-[#e6e1ee] px-3 py-2.5 text-sm has-[:checked]:border-[#5b2a86] has-[:checked]:bg-[#f7f1fc]">
            <input type="radio" name="cod-choice" value={c} checked={choice === c} onChange={() => onChoose(c)} className="accent-[#5b2a86]" />
            {COD_CHOICE_LABELS[c]}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
