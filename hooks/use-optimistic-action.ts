import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

/** What every Server Action hands back: done, or refused with a reason. */
type Outcome = { ok: boolean };

/**
 * One way to do an optimistic update: show `next` at once, run the Server Action, keep `next` once
 * the server confirms (and refresh so the page catches up), or roll back and say why when it refuses.
 *
 * `server` is the state the page was rendered with. The shown state follows it again as soon as it
 * changes, so a refresh, or a colleague's change, always wins over a stale guess.
 */
export function useOptimisticAction<S>(server: S) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [guess, setGuess] = useState<{ base: S; value: S } | null>(null);

  const key = JSON.stringify(server);
  const state = guess && JSON.stringify(guess.base) === key ? guess.value : server;

  const run = <R extends Outcome>(
    next: S,
    action: () => Promise<R>,
    handlers: {
      /** The message to show when the server refuses. */
      refusal: (outcome: Exclude<R, { ok: true }>) => string;
      onDone?: (outcome: R) => void;
    },
  ) => {
    setGuess({ base: server, value: next });

    startTransition(async () => {
      const outcome = await action();

      if (outcome.ok) router.refresh();
      else {
        setGuess(null);
        toast.error(handlers.refusal(outcome as Exclude<R, { ok: true }>));
      }

      handlers.onDone?.(outcome);
    });
  };

  return { state, pending, run };
}
