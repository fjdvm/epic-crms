"use client";

import { AlertTriangle, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** What any storefront change answers with; Order and Return changes both fit. */
export type ChangeResult = { ok: true } | { ok: false; reason: string };

/**
 * One Order or Return action behind a confirmation dialog. Not optimistic unless `onOptimistic` is given: the spinner
 * shows at once, and the Order is shown as changed only once the server confirms. A refusal closes the dialog and says why in
 * a toast, as Ticket refusals do: the refresh that follows may remove the button, and the dialog with
 * it, when someone else has already moved the Order. The Orders, Payments and Fulfilment actions all
 * go through this.
 */
export function OrderActionDialog({
  trigger,
  triggerClassName,
  title,
  description,
  children,
  confirm,
  busy,
  keepLabel = "Cancel",
  tone = "primary",
  disabled = false,
  run,
  successMessage,
  onOptimistic,
}: {
  /** The button's label on the page. */
  trigger: string;
  /** Extra classes for that button, such as a smaller one on a board card. */
  triggerClassName?: string;
  title: string;
  description: string;
  /** Anything Staff fill in or should read before confirming. */
  children?: React.ReactNode;
  /** The confirming button's label, and its label while the server answers. */
  confirm: string;
  busy: string;
  /** The label of the button that closes the dialog without acting. */
  keepLabel?: string;
  tone?: "primary" | "destructive";
  /** True while what Staff entered cannot be sent. */
  disabled?: boolean;
  run: () => Promise<ChangeResult>;
  /** What to tell Staff once the server confirms. */
  successMessage: string;
  /**
   * Shows the result at once, inside a transition, so React rolls it back if the server refuses. Only for
   * moves with no outside effect (ADR-0002); the dialog then closes immediately instead of spinning.
   */
  onOptimistic?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const [, startTransition] = useTransition();

  function act() {
    if (onOptimistic) setOpen(false);
    else setPending(true);

    startTransition(async () => {
      onOptimistic?.();

      let outcome: ChangeResult;
      try {
        outcome = await run();
      } catch {
        // The action never answered (network, crash): nothing changed that Staff can see.
        outcome = { ok: false, reason: "CREOMS could not save that. Try again in a moment." };
      }

      setPending(false);
      setOpen(false);
      if (outcome.ok) toast.success(successMessage);
      else toast.error(outcome.reason);
      // Either way the page catches up with the server, so a refusal also shows what is really there.
      router.refresh();
    });
  }

  const destructive = tone === "destructive";

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !pending && setOpen(next)}
    >
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant={destructive ? "outline" : "default"}
          className={cn(
            "h-auto rounded-lg px-4 py-[9px] leading-[normal] shadow-none",
            destructive && "text-[#dc2626] hover:text-[#dc2626]",
            triggerClassName,
          )}
        >
          {trigger}
        </Button>
      </AlertDialogTrigger>
      {/* The Figma "Cancel order" dialog's card, which the log out dialog also uses. */}
      <AlertDialogContent className="flex w-[calc(100%-2rem)] max-w-115 sm:max-w-115 md:max-w-115 lg:max-w-115 flex-col gap-0 overflow-hidden rounded-2xl border-0 p-0! leading-[normal] shadow-[0_20px_48px_rgb(0_0_0/0.2)] sm:rounded-2xl">
        <AlertDialogHeader className="flex shrink-0 flex-row items-start gap-3 space-y-0 border-b border-[#f0f0f2] pt-5 pr-4.5 pb-4 pl-6 text-left">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full [&_svg]:size-5",
              destructive ? "bg-[#fee2e2] text-[#dc2626]" : "bg-[#f3e8ff] text-primary",
            )}
          >
            <AlertTriangle aria-hidden />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <AlertDialogTitle className="text-lg font-semibold leading-[normal] text-foreground">{title}</AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] leading-[normal] text-[#71717a]">
              {description}
            </AlertDialogDescription>
          </div>
          <AlertDialogCancel
            disabled={pending}
            aria-label="Close"
            className="mt-0 size-auto rounded-md border-0 bg-transparent p-1 text-[#71717a] shadow-none outline-none hover:bg-transparent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:mt-0"
          >
            <X aria-hidden className="size-4.5" />
          </AlertDialogCancel>
        </AlertDialogHeader>
        {children && <div className="space-y-4 px-6 py-5 text-sm">{children}</div>}
        <AlertDialogFooter className="flex shrink-0 flex-row items-center justify-end gap-2 space-x-0 border-t border-[#f0f0f2] bg-[#fafafa] px-6 py-3.5 sm:space-x-0">
          <AlertDialogCancel
            disabled={pending}
            className="mt-0 h-auto rounded-lg border border-input bg-background px-4 py-[9px] leading-[normal] text-foreground shadow-none hover:bg-accent sm:mt-0"
          >
            {keepLabel}
          </AlertDialogCancel>
          {/* A plain button, not AlertDialogAction: that would close the dialog before the server answers. */}
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={pending || disabled}
            aria-busy={pending}
            onClick={act}
            className="h-auto rounded-lg px-4 py-[9px] leading-[normal] shadow-none"
          >
            {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
            {pending ? busy : confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
