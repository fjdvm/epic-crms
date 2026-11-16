"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { useClaim } from "./claim";
import {
  absentTickets,
  reassignAll,
  reassignOptions,
  type TeammateChoice,
} from "./reassign-actions";
import type { AbsentTicket } from "./reassign";
import { REASON_MAX, REASSIGN_REFUSALS } from "./reassign-refusals";

const OUTLINE =
  "rounded-lg border border-[#e6e1ee] bg-white px-[14px] py-[9px] text-sm font-medium leading-[normal] whitespace-nowrap text-[#1f1a2e] disabled:opacity-50";
const PRIMARY =
  "rounded-lg bg-[#5b2a86] px-[14px] py-[9px] text-sm font-medium leading-[normal] whitespace-nowrap text-white disabled:opacity-50";
const FIELD = "w-full rounded-lg border border-[#e6e1ee] bg-white px-3 py-2 text-sm leading-[normal] text-[#1f1a2e]";

type Choices = { state: "loading" } | { state: "ready"; teammates: TeammateChoice[] } | { state: "failed"; message: string };

/** Loads who can take Tickets when a dialog opens (a user action, never on a timer); the dialog shows a skeleton at once. */
function useChoices(open: boolean): Choices {
  const [choices, setChoices] = useState<Choices>({ state: "loading" });

  useEffect(() => {
    if (!open) return;
    let current = true;
    setChoices({ state: "loading" });
    reassignOptions()
      .then((r) => {
        if (!current) return;
        setChoices(r.ok ? { state: "ready", teammates: r.teammates } : { state: "failed", message: REASSIGN_REFUSALS[r.reason] });
      })
      .catch(() => current && setChoices({ state: "failed", message: REASSIGN_REFUSALS.unavailable }));

    return () => {
      current = false;
    };
  }, [open]);

  return choices;
}

function Pick({ person, selected, onSelect, name }: { person: TeammateChoice; selected: boolean; onSelect: () => void; name: string }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5",
        selected ? "border-[#5b2a86] bg-[#f6f0fb]" : "border-[#e6e1ee]",
      )}
    >
      <input type="radio" name={name} checked={selected} onChange={onSelect} className="accent-[#5b2a86]" />
      <span className="flex flex-1 flex-col text-sm leading-[normal] text-[#1f1a2e]">
        {person.name}
        <span className="text-xs text-[#6e6680]">{person.role === "manager" ? "Manager" : "Staff"}</span>
      </span>
      <span className="rounded-full bg-[#f3f0f7] px-2 py-0.5 text-xs text-[#4a4360]">{person.open} open</span>
    </label>
  );
}

function PickList({ choices }: { choices: Choices }) {
  if (choices.state === "loading")
    return (
      <div className="space-y-2" aria-label="Loading Staff">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  if (choices.state === "failed")
    return <p role="alert" className="text-sm text-[#9a3412]">{choices.message}</p>;

  return null;
}

function Reason({ value, onChange, tried, who }: { value: string; onChange: (v: string) => void; tried: boolean; who: string }) {
  return (
    <label className="block space-y-1 text-[13px] font-medium text-[#1f1a2e]">
      Reason
      <textarea
        className={FIELD}
        rows={2}
        maxLength={REASON_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={tried && !value.trim()}
        placeholder="Liza is off today"
      />
      {tried && !value.trim() ? (
        <span role="alert" className="block text-xs font-normal text-[#9a3412]">Write a reason.</span>
      ) : (
        <span className="block text-xs font-normal text-[#6e6680]">Shown to {who}, and saved in the Ticket&apos;s activity.</span>
      )}
    </label>
  );
}

/** Manager only: move this Ticket to a named Staff member. The page shows the new Claimer at once. */
export function ReassignTicketDialog({ ticketId }: { ticketId: number }) {
  const { claimer, reassign, pending } = useClaim();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const choices = useChoices(open);

  if (!claimer) return null;

  const people = choices.state === "ready" ? choices.teammates.filter((p) => p.id !== claimer.id) : [];
  const chosen = people.find((p) => p.id === to);

  const submit = () => {
    setTried(true);
    if (!chosen || !reason.trim()) return;
    setOpen(false);
    reassign({ id: chosen.id, name: chosen.name }, reason.trim());
    setReason("");
    setTo(null);
    setTried(false);
  };

  return (
    <>
      <button type="button" className={OUTLINE} disabled={pending} onClick={() => setOpen(true)}>
        Reassign
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-[520px] gap-4 overflow-y-auto">
          <DialogTitle className="text-lg font-semibold text-[#1f1a2e]">Reassign TKT-{ticketId}</DialogTitle>
          <DialogDescription className="text-[13px] text-[#6e6680]">
            Manager only. Now held by {claimer.name}. Both people are told why.
          </DialogDescription>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[13px] font-medium text-[#1f1a2e]">Reassign to</legend>
            <PickList choices={choices} />
            {people.map((p) => (
              <Pick key={p.id} name="reassign-to" person={p} selected={to === p.id} onSelect={() => setTo(p.id)} />
            ))}
            {tried && !chosen && choices.state === "ready" && (
              <span role="alert" className="block text-xs text-[#9a3412]">Choose who takes it.</span>
            )}
          </fieldset>
          <Reason value={reason} onChange={setReason} tried={tried} who={chosen ? `${claimer.name} and ${chosen.name}` : "both people"} />
          <div className="flex justify-end gap-2">
            <button type="button" className={OUTLINE} onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className={PRIMARY} onClick={submit}>
              {chosen ? `Reassign to ${chosen.name}` : "Reassign"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Manager only: move every open Ticket of an absent teammate to one Staff member, after seeing them. */
export function ReassignAllDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [held, setHeld] = useState<{ for: string; tickets: AbsentTicket[] | "loading" | "failed" } | null>(null);
  const choices = useChoices(open);

  const teammates = choices.state === "ready" ? choices.teammates : [];
  const absent = teammates.filter((p) => p.open > 0);
  const absentPerson = teammates.find((p) => p.id === from);
  const target = teammates.find((p) => p.id === to && p.id !== from);
  const tickets = held && held.for === from && Array.isArray(held.tickets) ? held.tickets : null;

  const pickAbsent = (id: string) => {
    setFrom(id);
    setHeld({ for: id, tickets: "loading" });
    absentTickets(id)
      .then((r) => setHeld((h) => (h?.for === id ? { for: id, tickets: r.ok ? r.tickets : "failed" } : h)))
      .catch(() => setHeld((h) => (h?.for === id ? { for: id, tickets: "failed" } : h)));
  };

  const submit = () => {
    setTried(true);
    if (!tickets?.length || !absentPerson || !target || !reason.trim()) return;

    const ids = tickets.map((t) => t.id);
    setOpen(false);
    // Moving many Tickets changes the list, so it waits for the server; the toast shows at once and says why if refused.
    toast.promise(
      reassignAll(ids, absentPerson.id, target.id, reason.trim(), crypto.randomUUID()).then((r) => {
        if (!r.ok) throw new Error(REASSIGN_REFUSALS[r.reason]);
        router.refresh();

        return r;
      }),
      {
        loading: `Moving ${ids.length} ${ids.length === 1 ? "Ticket" : "Tickets"} to ${target.name}…`,
        success: (r) =>
          r.ok && r.skipped.length
            ? `Moved ${r.moved.length}. ${r.skipped.length} changed hands first and stayed put.`
            : `Moved ${ids.length} ${ids.length === 1 ? "Ticket" : "Tickets"} to ${target.name}.`,
        error: (e) => (e instanceof Error ? e.message : REASSIGN_REFUSALS.unavailable),
      },
    );
    setReason("");
    setTried(false);
  };

  return (
    <>
      <button type="button" className={OUTLINE} onClick={() => setOpen(true)}>
        Reassign all
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-[560px] gap-4 overflow-y-auto">
          <DialogTitle className="text-lg font-semibold text-[#1f1a2e]">
            {absentPerson ? `${absentPerson.name} is away · move ${tickets?.length ?? "their"} Tickets?` : "Move an absent teammate's Tickets"}
          </DialogTitle>
          <DialogDescription className="text-[13px] text-[#6e6680]">
            Manager only. All their open Tickets go to one person, and both are told why. This cannot be moved back in one step.
          </DialogDescription>

          <fieldset className="space-y-2">
            <legend className="mb-1 text-[13px] font-medium text-[#1f1a2e]">Who is away?</legend>
            <PickList choices={choices} />
            {choices.state === "ready" && absent.length === 0 && (
              <p className="text-sm text-[#6e6680]">Nobody holds an open Ticket right now.</p>
            )}
            {absent.map((p) => (
              <Pick key={p.id} name="absent" person={p} selected={from === p.id} onSelect={() => pickAbsent(p.id)} />
            ))}
          </fieldset>

          {from && (
            <section aria-label="Tickets to move" className="space-y-1.5">
              <h3 className="text-[13px] font-medium text-[#1f1a2e]">Tickets that will move</h3>
              {held?.tickets === "loading" && <Skeleton className="h-20 w-full" />}
              {held?.tickets === "failed" && <p role="alert" className="text-sm text-[#9a3412]">{REASSIGN_REFUSALS.unavailable}</p>}
              {tickets && (
                <ul className="max-h-40 divide-y divide-[#e6e1ee] overflow-y-auto rounded-lg border border-[#e6e1ee]">
                  {tickets.length === 0 && <li className="px-3 py-2 text-sm text-[#6e6680]">No open Tickets.</li>}
                  {tickets.map((t) => (
                    <li key={t.id} className="px-3 py-2 text-sm leading-[normal] text-[#1f1a2e]">
                      <span className="font-medium text-[#5b2a86]">TKT-{t.id}</span> · {t.customerName}
                      <span className="block text-xs text-[#6e6680]">{t.subject}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {from && (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-[13px] font-medium text-[#1f1a2e]">Move them to</legend>
              {teammates.filter((p) => p.id !== from).map((p) => (
                <Pick key={p.id} name="target" person={p} selected={to === p.id} onSelect={() => setTo(p.id)} />
              ))}
              {target && tickets && (
                <p className="text-xs text-[#6e6680]">
                  {target.name}: {target.open} open → {target.open + tickets.length} open
                </p>
              )}
              {tried && !target && <span role="alert" className="block text-xs text-[#9a3412]">Choose who takes them.</span>}
            </fieldset>
          )}

          <Reason value={reason} onChange={setReason} tried={tried} who={absentPerson && target ? `${absentPerson.name} and ${target.name}` : "both people"} />

          <div className="flex justify-end gap-2">
            <button type="button" className={OUTLINE} onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className={PRIMARY} disabled={!tickets?.length} onClick={submit}>
              {tickets?.length ? `Move ${tickets.length} ${tickets.length === 1 ? "Ticket" : "Tickets"}` : "Move Tickets"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
