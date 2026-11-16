"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { markWrong } from "./actions";
export function MarkWrong({ ticketId, messageId }: { ticketId: number; messageId: number }) {
  const [open, setOpen] = useState(false), [reason, setReason] = useState("");
  const [saved, setSaved] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState("");
  if (saved) return <p role="status">Marked wrong</p>;
  if (!open) return <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Mark wrong</Button>;
  return <form className="space-y-2" onSubmit={async e => {
    e.preventDefault();
    if (!window.confirm("Mark this assistant answer wrong with this reason?")) return;
    setSaved(true); setPending(true); setError("");
    try {
      const result = await markWrong(ticketId, messageId, reason);
      if (!result.ok) { setSaved(false); setError(result.reason ?? "The answer could not be marked wrong. Please try again."); }
    } catch { setSaved(false); setError("The answer could not be marked wrong. Please try again."); }
    finally { setPending(false); }
  }}>
    <Textarea aria-label="Why is this answer wrong?" maxLength={500} required value={reason} onChange={e => setReason(e.target.value)} />
    <Button size="sm" disabled={pending || !reason.trim()}>Save reason</Button>
    <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
