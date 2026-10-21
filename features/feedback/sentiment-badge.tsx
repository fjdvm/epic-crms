import { Badge } from "@/components/ui/badge";

import type { Sentiment } from "./analysis";

const SENTIMENT_BADGES: Record<Sentiment, { label: string; variant: "success" | "secondary" | "destructive" }> = {
  positive: { label: "Positive", variant: "success" },
  neutral: { label: "Neutral", variant: "secondary" },
  negative: { label: "Negative", variant: "destructive" },
};

/** A Feedback's Sentiment, or "Analysing…" until it has been labelled. */
export function SentimentBadge({ sentiment }: { sentiment: Sentiment | null }) {
  if (!sentiment) {
    return (
      <Badge variant="info" className="shrink-0">
        Analysing…
      </Badge>
    );
  }

  const { label, variant } = SENTIMENT_BADGES[sentiment];

  return (
    <Badge variant={variant} className="shrink-0">
      {label}
    </Badge>
  );
}

const analyzedAt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Manila",
});

/** "Last analyzed 21 Oct 2026, 2:00 pm" in Philippines time; null before any run has finished. */
export function lastAnalyzedLabel(finishedAt: Date | null): string | null {
  return finishedAt ? `Last analyzed ${analyzedAt.format(finishedAt)}` : null;
}
