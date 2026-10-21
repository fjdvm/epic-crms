"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

import { analyze, type AnalyzeOutcome } from "./actions";

const clock = new Intl.DateTimeFormat("en-GB", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Manila",
});

/** "3 Feedbacks couldn't be analyzed", or null when the last run had no failures. */
export function failureWarning(failed: number): string | null {
  if (failed <= 0) return null;

  return `${failed} ${failed === 1 ? "Feedback" : "Feedbacks"} couldn't be analyzed`;
}

const plural = (n: number) => `${n} ${n === 1 ? "Feedback" : "Feedbacks"}`;

function report(outcome: AnalyzeOutcome) {
  switch (outcome.status) {
    case "done":
      if (outcome.failed > 0) {
        toast.warning(`Analyzed ${plural(outcome.analyzed)}. ${failureWarning(outcome.failed)}; they will be retried on the next run.`);
      } else {
        toast.success(`Analyzed ${plural(outcome.analyzed)}.`);
      }
      return;
    case "nothing-to-do":
      return toast.info("Every Feedback already has a Sentiment.");
    case "no-keys":
      return toast.error("AI keys not set.");
    case "busy":
      return toast.error("An analysis is already running.");
    case "cooling-down":
      return toast.error(`Analyze is available again at ${clock.format(outcome.until)}.`);
    case "unavailable":
      return toast.error("The analysis could not run. Try again in a moment.");
  }
}

export interface AnalyzeButtonProps {
  /** At least one AI key is set. */
  keysSet: boolean;
  /** A run (scheduled or manual) is in progress. */
  running: boolean;
  /** ISO time when Analyze can be pressed again, while within 5 minutes of the last run's end. */
  availableAt: string | null;
  /** How many Feedbacks the last run could not analyze. */
  lastFailed: number;
}

/**
 * The Analyze button in the Feedback page header, where Export was. It confirms first, then runs the
 * analysis over Feedback with no Sentiment and refreshes the page.
 */
export function AnalyzeButton({ keysSet, running, availableAt, lastFailed }: AnalyzeButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // The 5 minutes run out while the page is open; remember which availableAt has passed.
  const [expired, setExpired] = useState<string | null>(null);

  useEffect(() => {
    if (!availableAt) return;

    const timer = setTimeout(() => setExpired(availableAt), Math.max(0, new Date(availableAt).getTime() - Date.now()));

    return () => clearTimeout(timer);
  }, [availableAt]);

  const coolingDown = availableAt !== null && expired !== availableAt;
  const disabled = !keysSet || running || coolingDown || pending;

  const note = !keysSet
    ? "AI keys not set"
    : running || pending
      ? "Analysis in progress"
      : coolingDown && availableAt
        ? `Available again at ${clock.format(new Date(availableAt))}`
        : null;

  const warning = failureWarning(lastFailed);

  const confirm = () => {
    startTransition(async () => {
      const outcome = await analyze().catch((): AnalyzeOutcome => ({ status: "unavailable" }));
      setOpen(false);
      report(outcome);
      router.refresh();
    });
  };

  return (
    <div className="flex shrink-0 items-center gap-2">
      {warning && (
        <p className="flex items-center gap-1 text-xs leading-[normal] text-[#b45309]" role="status">
          <TriangleAlert className="size-3.5" />
          {warning}
        </p>
      )}
      {note && (
        <p className="text-xs leading-[normal] text-[#6e6680]" data-testid="analyze-note">
          {note}
        </p>
      )}
      <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg bg-[#5b2a86] px-[14px] py-[9px] text-sm font-medium leading-[normal] whitespace-nowrap text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Sparkles className="size-4" />
          {running || pending ? "Analyzing…" : "Analyze"}
        </button>
        <AlertDialogContent
          onEscapeKeyDown={(event) => pending && event.preventDefault()}
          className="w-[calc(100%-2rem)] max-w-[24rem] sm:max-w-[24rem] md:max-w-[24rem] lg:max-w-[24rem] gap-4 p-6 sm:p-6 rounded-xl"
        >
          <AlertDialogHeader className="gap-2 text-left">
            <AlertDialogTitle className="text-lg font-semibold">Analyze Feedback?</AlertDialogTitle>
            <AlertDialogDescription>
              The AI labels the Sentiment of every Feedback that doesn&apos;t have one yet. Feedback already
              labelled is not analyzed again. This uses AI quota.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row justify-end gap-2 sm:space-x-0">
            <AlertDialogCancel disabled={pending} className="mt-0 sm:mt-0">
              Cancel
            </AlertDialogCancel>
            {/* A plain button, not AlertDialogAction: that would close the dialog and hide the loading state. */}
            <Button type="button" onClick={confirm} disabled={pending} className="bg-[#5b2a86] text-white hover:bg-[#5b2a86]/90">
              {pending ? "Analyzing…" : "Analyze"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
