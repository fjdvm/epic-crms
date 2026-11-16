"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";

import { applySuggestedField, suggestCategoryAndPriority } from "./actions";
import { PRIORITY_LABELS } from "./pill";
import {
  SUGGEST_REFUSALS,
  TICKET_CATEGORIES,
  type Decision,
  type SerializedSuggestion,
  type SuggestField,
} from "./suggest-view";
import { TICKET_PRIORITIES } from "./tickets";

const OUTLINE =
  "rounded-lg border border-[#e6e1ee] bg-white px-3 py-1.5 text-[13px] font-medium leading-[normal] whitespace-nowrap text-[#1f1a2e] disabled:opacity-50";
const SOFT =
  "rounded-lg bg-[#efe6f8] px-3 py-1.5 text-[13px] font-medium leading-[normal] whitespace-nowrap text-[#5b2a86] disabled:opacity-50";
const CARD = "space-y-[14px] rounded-xl border border-[#e6e1ee] bg-white p-5";
const CARD_TITLE = "text-base font-semibold leading-[normal] text-[#1f1a2e]";

interface Fields {
  category: string;
  priority: string;
  categoryDecision: Decision | null;
  priorityDecision: Decision | null;
}

const OPTIONS: Record<SuggestField, { value: string; label: string }[]> = {
  category: TICKET_CATEGORIES.map((c) => ({ value: c, label: c })),
  priority: TICKET_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] })),
};

const labelOf = (field: SuggestField, value: string) => OPTIONS[field].find((o) => o.value === value)?.label ?? value;

/**
 * Category and Priority on the Ticket page, with the AI's suggestion on demand. Nothing is asked until Staff press
 * Suggest, nothing applies until they press Accept or Change and confirm, and if the AI fails the fields still work by hand.
 */
export function SuggestCard({
  ticketId,
  category,
  priority,
  suggestion: serverSuggestion,
  canWork,
  completed,
}: {
  ticketId: number;
  category: string;
  priority: string;
  suggestion: SerializedSuggestion | null;
  canWork: boolean;
  completed: boolean;
}) {
  const router = useRouter();
  const [fresh, setFresh] = useState<SerializedSuggestion | null>(null);
  const [asking, startAsking] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ field: SuggestField; value: string } | null>(null);
  const [editing, setEditing] = useState<SuggestField | null>(null);
  const [draft, setDraft] = useState("");

  const suggestion = fresh && (!serverSuggestion || fresh.id >= serverSuggestion.id) ? fresh : serverSuggestion;

  const server: Fields = {
    category,
    priority,
    categoryDecision: suggestion?.categoryDecision ?? null,
    priorityDecision: suggestion?.priorityDecision ?? null,
  };
  const { state, pending, run } = useOptimisticAction(server);
  const editable = canWork && !completed;

  const ask = () => {
    setProblem(null);
    startAsking(async () => {
      try {
        const outcome = await suggestCategoryAndPriority(ticketId, crypto.randomUUID());
        if (outcome.ok) setFresh(outcome.suggestion);
        else setProblem(SUGGEST_REFUSALS[outcome.reason]);
      } catch {
        setProblem(SUGGEST_REFUSALS.unavailable);
      }
      router.refresh();
    });
  };

  const apply = (field: SuggestField, value: string) => {
    const kind = suggestion && value === suggestion[field] ? "accepted" : "changed";
    const decision: Decision | null = suggestion ? { kind, applied: value, by: "you" } : null;

    setConfirm(null);
    setEditing(null);
    setProblem(null);
    run(
      { ...state, [field]: value, ...(decision ? { [`${field}Decision`]: decision } : {}) } as Fields,
      () => applySuggestedField(ticketId, field, value, suggestion?.id ?? null, crypto.randomUUID()),
      { refusal: (o) => SUGGEST_REFUSALS[(o as { reason: keyof typeof SUGGEST_REFUSALS }).reason] },
    );
  };

  const row = (field: SuggestField) => {
    const title = field === "category" ? "Category" : "Priority";
    const decision = state[`${field}Decision`];
    const suggested = suggestion ? { value: suggestion[field], reason: field === "category" ? suggestion.categoryReason : suggestion.priorityReason } : null;

    return (
      <div className="space-y-1.5" key={field}>
        <p className="text-[13px] leading-[normal] text-[#1f1a2e]">
          <span className="text-[#6e6680]">{title}: </span>
          <span className="font-medium">{labelOf(field, state[field])}</span>
        </p>
        {suggested && !decision && (
          <p className="text-[13px] leading-[normal] text-[#1f1a2e]">
            <Sparkles aria-hidden className="mr-1 inline size-3.5 text-[#5b2a86]" />
            Suggested: <span className="font-medium">{labelOf(field, suggested.value)}</span>
            {suggested.reason && <span className="block text-xs text-[#6e6680]">{suggested.reason}</span>}
          </p>
        )}
        {decision && (
          <p className="text-xs leading-[normal] text-[#6e6680]">
            AI suggestion {decision.kind} by {decision.by === "you" ? "you" : decision.by}
            {decision.kind === "changed" ? `: set to ${labelOf(field, decision.applied)}` : ""}
          </p>
        )}
        {editable && editing === field ? (
          <div className="flex items-center gap-2">
            <select
              aria-label={`New ${title}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-[#e6e1ee] bg-white px-2 py-1.5 text-[13px] text-[#1f1a2e]"
            >
              {OPTIONS[field].map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button type="button" className={SOFT} onClick={() => setConfirm({ field, value: draft })}>
              Apply
            </button>
            <button type="button" className={OUTLINE} onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        ) : (
          editable && (
            <div className="flex gap-2">
              {suggested && !decision && (
                <button type="button" className={SOFT} disabled={pending} onClick={() => setConfirm({ field, value: suggested.value })}>
                  Accept
                </button>
              )}
              <button
                type="button"
                className={OUTLINE}
                disabled={pending}
                onClick={() => {
                  setDraft(state[field]);
                  setEditing(field);
                }}
              >
                Change
              </button>
            </div>
          )
        )}
      </div>
    );
  };

  return (
    <section aria-label="AI assist" className={CARD}>
      <div className="flex items-center gap-2">
        <h2 className={`${CARD_TITLE} flex-1`}>Category and Priority</h2>
        {editable && (
          <button type="button" className={SOFT} disabled={asking} onClick={ask}>
            {asking ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 aria-hidden className="size-3.5 animate-spin" /> Asking…
              </span>
            ) : suggestion ? (
              "Suggest again"
            ) : (
              "Suggest with AI"
            )}
          </button>
        )}
      </div>
      {row("category")}
      {row("priority")}
      {problem && (
        <p role="alert" className="text-[13px] leading-[normal] text-[#9a3412]">
          {problem}
        </p>
      )}
      {suggestion && (
        <div className="space-y-1 border-t border-[#e6e1ee] pt-3">
          <p className="text-[13px] font-medium leading-[normal] text-[#1f1a2e]">What the AI saw</p>
          <p className="text-xs leading-[normal] text-[#6e6680]">
            Only this Ticket&apos;s text (subject and Messages, no Internal notes), with emails and numbers hidden. Not sent: name, address, phone, email, Order.
          </p>
          <details className="text-xs text-[#6e6680]">
            <summary className="cursor-pointer">Show the text that was sent</summary>
            <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-[#f6f3fa] p-2 break-words whitespace-pre-wrap">{suggestion.sentText}</pre>
          </details>
        </div>
      )}
      <p className="text-xs leading-[normal] text-[#6e6680]">Nothing changes until you accept or change it. Accepted suggestions are saved in the activity log with your name.</p>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm ? `Set ${confirm.field === "category" ? "Category" : "Priority"} to ${labelOf(confirm.field, confirm.value)}?` : ""}</AlertDialogTitle>
            <AlertDialogDescription>This changes the Ticket. The Customer is not told.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <button type="button" className="rounded-lg bg-[#5b2a86] px-[14px] py-[9px] text-sm font-medium text-white" onClick={() => confirm && apply(confirm.field, confirm.value)}>
              Confirm
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
