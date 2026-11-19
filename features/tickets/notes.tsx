"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { addNote } from "./actions";
import { refusalMessage } from "./refusals";
import type { TicketMessage } from "./ticket";
import { NOTE_MAX } from "./tickets";

/** A note the Staff member has just written: shown at once, "sending…" until the server confirms it. */
interface PendingNote {
  key: string;
  body: string;
  at: Date;
  /** The saved Message's id once the server confirms; the page's own copy then takes over. */
  savedId: number | null;
}

interface Notes {
  viewerName: string;
  pending: PendingNote[];
  /** Resolves true when the note was saved, false when it was refused (the note has then been taken back). */
  add: (body: string) => Promise<boolean>;
}

const NotesContext = createContext<Notes | null>(null);

/** Holds the notes written on this page so the timeline and the note box agree, whichever page shows them. */
export function NotesProvider({
  ticketId,
  viewerName,
  onSaved,
  children,
}: {
  ticketId: number;
  viewerName: string;
  /** Called once the server has saved a note, for a view that lists notes itself. */
  onSaved?: () => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingNote[]>([]);
  const [, startTransition] = useTransition();
  const counter = useRef(0);

  const add = (body: string) =>
    new Promise<boolean>((resolve) => {
      const key = `note-${++counter.current}`;

      setPending((current) => [...current, { key, body, at: new Date(), savedId: null }]);

      startTransition(async () => {
        const rollBack = (reason: string) => {
          setPending((current) => current.filter((n) => n.key !== key));
          toast.error(reason);
          resolve(false);
        };

        try {
          const result = await addNote(ticketId, body);

          if (!result.ok) return rollBack(refusalMessage(result));

          setPending((current) => current.map((n) => (n.key === key ? { ...n, savedId: result.messageId } : n)));
          router.refresh();
          onSaved?.();
          resolve(true);
        } catch {
          rollBack("CREOMS could not save that. Try again in a moment.");
        }
      });
    });

  return <NotesContext.Provider value={{ viewerName, pending, add }}>{children}</NotesContext.Provider>;
}

/** The page's own Messages plus notes still on their way, never showing a note twice. */
export function useMessagesWithNotes(messages: TicketMessage[]): TicketMessage[] {
  const notes = useContext(NotesContext);
  if (!notes) return messages;

  const saved = new Set(messages.map((m) => m.id));

  return [
    ...messages,
    ...notes.pending
      .filter((n) => n.savedId === null || !saved.has(n.savedId))
      .map(
        (n): TicketMessage => ({
          id: n.savedId ?? -Number(n.key.slice(5)),
          sender: "staff",
          senderName: notes.viewerName,
          body: n.body,
          hasAttachment: false,
          internal: true,
          sending: n.savedId === null,
          createdAt: n.at,
        }),
      ),
  ];
}

const OUTLINE =
  "rounded-lg border border-[#e6e1ee] bg-white px-[14px] py-[9px] text-sm font-medium leading-[normal] whitespace-nowrap text-[#1f1a2e] disabled:opacity-50";
const PRIMARY =
  "rounded-lg bg-[#5b2a86] px-[14px] py-[9px] text-sm font-medium leading-[normal] whitespace-nowrap text-white disabled:opacity-50";

/** Write an Internal note: Staff-only text, separate from the reply box so a note is never sent to the Customer by mistake. */
export function NoteBox({ inline = false, onSaved }: { /** Already chosen (its own tab): no button first, and no Cancel. */ inline?: boolean; /** Called once the note is on its way, so a dialog around the box can close. */ onSaved?: () => void }) {
  const notes = useContext(NotesContext);
  const [text, setText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [open, setOpen] = useState(inline);

  if (!notes) return null;

  const body = text.trim();

  const submit = () => {
    setConfirming(false);
    if (!body) return;

    // The box clears as soon as the note is on its way; a refused note puts the words back.
    const written = text;

    setText("");
    setOpen(inline);
    onSaved?.();
    void notes.add(body).then((saved) => {
      if (!saved) {
        setText((current) => current || written);
        setOpen(true);
      }
    });
  };

  if (!open)
    return (
      <button type="button" className={cn(OUTLINE, "self-start")} onClick={() => setOpen(true)}>
        Add internal note
      </button>
    );

  return (
    <div className="space-y-2 rounded-[10px] border border-dashed border-[#e0c97a] bg-[#fff8e1] p-3">
      <label htmlFor="internal-note" className="text-xs font-medium leading-[normal] text-[#7a5b00]">
        Internal note · only Staff see this, never the Customer
      </label>
      <textarea
        id="internal-note"
        rows={2}
        maxLength={NOTE_MAX}
        placeholder="Write a note for your teammates…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="block w-full resize-none rounded-lg border border-[#e6e1ee] bg-white px-3 py-2 text-sm leading-[normal] text-[#1f1a2e] outline-none placeholder:text-[#9a93a8]"
      />
      <div className="flex justify-end gap-2">
        {!inline && (
          <button
            type="button"
            className={OUTLINE}
            onClick={() => {
              setText("");
              setOpen(false);
            }}
          >
            Cancel
          </button>
        )}
        <button type="button" className={PRIMARY} disabled={!body} onClick={() => setConfirming(true)}>
          Add note
        </button>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add this internal note?</AlertDialogTitle>
            <AlertDialogDescription>
              Only Staff will see it. It is permanent and is never sent to the Customer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {/* A plain button, not AlertDialogAction: submit() closes the dialog itself. */}
            <button type="button" className={PRIMARY} onClick={submit}>
              Add note
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Shown while a note is on its way. */
export function Sending() {
  return (
    <span className="inline-flex items-center gap-1">
      <Loader2 aria-hidden className="size-3 animate-spin" /> sending…
    </span>
  );
}
