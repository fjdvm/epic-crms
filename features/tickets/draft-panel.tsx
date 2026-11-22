"use client";

import { Loader2 } from "lucide-react";
import { useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";

import { requestDraftedReply } from "./actions";
import type { DraftedReply, DraftRequest } from "./draft";

const OUTLINE =
  "rounded-lg border border-[#e6e1ee] bg-white px-3 py-1.5 text-[13px] font-medium leading-[normal] whitespace-nowrap text-[#1f1a2e] disabled:opacity-50";
const PRIMARY =
  "inline-flex items-center gap-1.5 rounded-lg bg-[#5b2a86] px-3 py-1.5 text-[13px] font-medium leading-[normal] whitespace-nowrap text-white disabled:opacity-50";
const LANGUAGES: DraftRequest["language"][] = ["Taglish", "English"];

/**
 * The Drafted reply panel. Nothing is requested until the Claimer presses a button, and nothing is
 * sent: "Use in conversation" only fills the reply box, and never over typed text without a confirm.
 */
export function DraftPanel({
  ticketId,
  disabledReason,
  replyText,
  onUse,
  canSend = false,
  onSend,
}: {
  ticketId: number;
  /** Why drafting is off for this viewer, or null. */
  disabledReason: string | null;
  /** What is in the reply box right now. */
  replyText: string;
  /** Put the draft in the reply box; `id` lets the server record "sent as drafted" or "sent as edited". */
  onUse: (text: string, id: number) => void;
  /** Only the claimer can send; false disables Send. */
  canSend?: boolean;
  /** Send the draft to the Customer as the reply (after the confirm here); `id` records "sent as drafted". */
  onSend?: (text: string, id: number) => void;
}) {
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [language, setLanguage] = useState<DraftRequest["language"]>("Taglish");
  const [draft, setDraft] = useState<DraftedReply | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const busy = useRef(false);

  const ask = async (shorter: boolean) => {
    if (busy.current || disabledReason) return;
    busy.current = true;
    setLoading(true);
    setProblem(null);
    try {
      const result = await requestDraftedReply(ticketId, {
        language,
        ...(shorter && draft ? { shorterThanId: draft.id } : {}),
      });
      // A refusal keeps what was there before (rollback) and says why.
      if (result.ok) setDraft(result.draft);
      else setProblem(result.reason);
    } catch {
      setProblem("Draft unavailable. You can still write your reply by hand.");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setProblem("Could not copy. Select the text and copy it by hand.");
    }
  };

  const use = () => {
    if (!draft || disabledReason) return;
    if (replyText.trim()) setConfirming(true);
    else onUse(draft.text, draft.id);
  };

  return (
    <section aria-label="Draft reply" className="space-y-2.5 rounded-xl border border-[#e9ddf7] bg-[#f7f3fb] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold text-[#1f1a2e]">Draft reply</h2>
        <div role="group" aria-label="Language" className="flex gap-1">
          {LANGUAGES.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={language === l}
              disabled={loading}
              onClick={() => setLanguage(l)}
              className={language === l ? "rounded-lg bg-[#ede4f7] px-3 py-1.5 text-[13px] font-medium text-[#5b2a86]" : OUTLINE}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div role="status" aria-label="Making a draft" className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : draft ? (
        <p className="rounded-lg border border-[#e6e1ee] bg-white p-3 text-[13px] break-words whitespace-pre-wrap text-[#1f1a2e]">{draft.text}</p>
      ) : null}
      {problem && <p role="alert" className="text-[13px] text-[#b42318]">{problem}</p>}
      {disabledReason && <p className="text-xs text-muted-foreground">{disabledReason}</p>}
      <div className="flex flex-wrap gap-2">
        {draft ? (
          <>
            <button type="button" className={OUTLINE} disabled={loading || !!disabledReason} title={disabledReason ?? undefined} onClick={use}>
              Edit in reply
            </button>
            <button type="button" className={OUTLINE} onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className={PRIMARY} disabled={loading || !canSend || !onSend} title={canSend ? undefined : "Only the claimer can send."} onClick={() => setSending(true)}>
              Send
            </button>
            <button type="button" className={OUTLINE} disabled={loading || !!disabledReason} onClick={() => ask(true)}>
              Make shorter
            </button>
            <button type="button" className={OUTLINE} disabled={loading} onClick={() => { setDraft(null); setProblem(null); }}>
              Discard
            </button>
          </>
        ) : (
          <button type="button" className={PRIMARY} disabled={loading || !!disabledReason} title={disabledReason ?? undefined} onClick={() => ask(false)}>
            {loading && <Loader2 aria-hidden className="size-4 animate-spin" />}
            Draft a reply
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Nothing is sent until you press Send.</p>
      <AlertDialog open={sending} onOpenChange={setSending}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send this draft?</AlertDialogTitle>
            <AlertDialogDescription>The Customer will see this draft as your reply.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <button type="button" className={PRIMARY} onClick={() => { setSending(false); if (draft) { onSend?.(draft.text, draft.id); } }}>
              Send reply
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace what you typed?</AlertDialogTitle>
            <AlertDialogDescription>The reply box already has text. Using the draft will replace it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my text</AlertDialogCancel>
            <button type="button" className={PRIMARY} onClick={() => { setConfirming(false); if (draft) onUse(draft.text, draft.id); }}>
              Replace with draft
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
