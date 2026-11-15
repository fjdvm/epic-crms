"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { addCustomerNote } from "./note-actions";
import type { CustomerNote } from "./notes";
import { formatDate } from "./format";
import { TabCard } from "./tab-card";

export type VisibleCustomerNote = CustomerNote & { saving?: boolean };

export function NotesTab({ customerId, notes, readFailed = false, author, onNoteChange }: {
  customerId: string;
  /** Undefined while loading; null means the read failed. */
  notes: VisibleCustomerNote[] | null | undefined;
  readFailed?: boolean;
  /** Only Staff and Managers receive an author; all other roles view only. */
  author?: { id: string; name: string };
  onNoteChange: (id: string, note: VisibleCustomerNote | null) => void;
}) {
  const [text, setText] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Preserve the operation across a failed transport so retry cannot save twice.
  const request = useRef<{ id: string; text: string } | null>(null);
  const busy = useRef(false);
  const count = Array.from(text).length;

  function askToSave() {
    if (!text.trim()) return setError("Write a Customer note before saving.");
    if (count > 2000) return setError("A Customer note can have at most 2,000 characters.");
    setError("");
    setConfirm(true);
  }

  async function save() {
    if (!author || busy.current) return;
    busy.current = true;
    setConfirm(false);
    setSaving(true);
    setError("");
    if (!request.current || request.current.text !== text) request.current = { id: crypto.randomUUID(), text };
    const operation = request.current;
    const pending: VisibleCustomerNote = { id: operation.id, customerId, text: text.trim(), authorId: author.id, authorName: author.name, createdAt: new Date().toISOString(), saving: true };
    onNoteChange(pending.id, pending);
    try {
      const result = await addCustomerNote(customerId, operation.text, operation.id);
      if (result.ok) {
        onNoteChange(pending.id, result.note);
        setText("");
        request.current = null;
      } else {
        onNoteChange(pending.id, null);
        setError(result.message);
      }
    } catch {
      onNoteChange(pending.id, null);
      setError("Customer notes are unavailable. Try again with the same request.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <TabCard title="Customer notes" note="Only staff can see these">
      {author && <form onSubmit={event => { event.preventDefault(); askToSave(); }} className="shrink-0 space-y-2">
        <div className="flex items-start gap-2 rounded-lg border border-border p-2.5">
          <Textarea aria-label="Customer note" aria-describedby="customer-note-counter" placeholder={'Add a note… e.g. "Prefers pickup on Saturdays"'} value={text} disabled={saving} onChange={event => setText(event.target.value)} className="min-h-16 flex-1 resize-none border-0 shadow-none" />
          <Button type="submit" variant="secondary" size="sm" disabled={saving}>Save note</Button>
        </div>
        <p id="customer-note-counter" className="text-right text-xs text-muted-foreground">{count.toLocaleString("en-US")} / 2,000</p>
      </form>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {(readFailed || notes === null) && <p role="alert" className="text-sm text-muted-foreground">Customer notes are unavailable. Reload to try again.</p>}
      {notes === undefined ? <div role="status" aria-label="Loading Customer notes" className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
        : notes === null ? null
        : notes.length === 0 ? <p className="text-sm text-muted-foreground">No Customer notes yet</p>
        : <ol aria-label="Customer notes" className="min-h-0 space-y-3 overflow-y-auto">
          {[...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).map(note => <li key={note.id} className="space-y-1 rounded-lg bg-secondary px-3.5 py-3">
            <p className="text-xs font-medium text-muted-foreground">{note.authorName} · {formatDate(new Date(note.createdAt))}{note.saving && <span role="status"> <span aria-hidden>· </span><span>saving…</span></span>}</p>
            <p className="whitespace-pre-wrap break-words text-[13px] text-foreground">{note.text}</p>
          </li>)}
        </ol>}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Save this Customer note?</AlertDialogTitle><AlertDialogDescription>Customer notes are permanent. To correct a mistake later, write a new Customer note.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void save()}>Save note</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TabCard>
  );
}
