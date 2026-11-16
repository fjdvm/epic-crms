"use client";

import { useState } from "react";

import type { ReturnFlagRule } from "./return-flags";

const FAILED = "The explanation could not be written just now. The flag is unchanged; you can try again.";

/**
 * "Explain this flag" for a Manager, and the kept explanation for whoever may read it.
 * The explanation is AI-written and changes nothing; it is asked on a click, never on a timer.
 */
export function ExplainFlag({ returnId, rule, kept, canExplain }: { returnId: number; rule: ReturnFlagRule; kept?: string | null; canExplain: boolean }) {
  const [text, setText] = useState<string | null>(kept ?? null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setAsking(true);
    setError(null);
    try {
      const res = await fetch(`/api/returns/${returnId}/flag-explanation`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-creoms-flag-explain": "1" },
        body: JSON.stringify({ rule }),
      });
      const body = (await res.json()) as { ok?: boolean; explanation?: string };
      if (res.ok && body.ok && body.explanation) setText(body.explanation);
      else setError(FAILED);
    } catch {
      setError(FAILED);
    } finally {
      setAsking(false);
    }
  }

  if (text) {
    return (
      <div data-flag-explanation className="mt-1 rounded-md bg-[#f6f2fb] px-3 py-2">
        <p className="text-xs font-medium text-[#6e6680]">Why this was flagged (AI-written, check before acting)</p>
        <p className="text-sm text-[#1f1a2e]">{text}</p>
      </div>
    );
  }
  if (!canExplain) return null;

  return (
    <div className="mt-1">
      <button type="button" onClick={ask} disabled={asking} className="text-sm font-medium text-[#5b2a86] hover:underline disabled:opacity-60">
        {asking ? "Explaining…" : "Explain this flag"}
      </button>
      {asking && <span role="status" className="ml-2 text-xs text-[#6e6680]">Asking for an AI-written explanation…</span>}
      {error && <p role="alert" className="text-xs text-[#b91c1c]">{error}</p>}
    </div>
  );
}
