import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { analysisStatus, type AnalysisStatus } from "@/features/feedback/analysis";
import { AnalyzeButton } from "@/features/feedback/analyze-button";
import { loadFeedback } from "@/features/feedback/feedback";
import { FeedbackListView } from "@/features/feedback/feedback-list";
import { FeedbackSummaryCards, type TopProductCard } from "@/features/feedback/feedback-summary";
import { DateRangeButton } from "@/features/feedback/feedback-toolbar";
import { lastAnalyzedLabel } from "@/features/feedback/sentiment-badge";
import { manilaToday, parseFilters } from "@/features/feedback/filters";
import { configuredClients } from "@/features/feedback/sentiment-clients";
import { readTopProduct } from "@/features/feedback/top-product";
import { FEEDBACK_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

// Analyze runs as a server action on this page, asking a model about each unlabelled Feedback in turn.
export const maxDuration = 300;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function FeedbackPage({ searchParams }: { searchParams: SearchParams }) {
  await requireModule(FEEDBACK_MODULE);

  const filters = parseFilters(await searchParams);

  const result = await loadFeedback(ticketsDatabase, filters);

  if (!result.ok) {
    return (
      <div className="p-md sm:p-lg space-y-md">
        <h1 className="text-2xl font-semibold leading-[normal] text-foreground">Feedback</h1>
        <Alert variant="destructive">
          <AlertTitle>Feedback is temporarily unavailable</AlertTitle>
          <AlertDescription>
            CREOMS could not read the store&apos;s Feedback. Reload to try again; if it keeps
            happening, tell whoever maintains CREOMS.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const lastAnalyzed = lastAnalyzedLabel(result.list.lastAnalyzed);
  const { groq, gemini } = configuredClients();
  // The action checks the locks again, so a failed read only loses the hint, never the lock.
  const status: AnalysisStatus = await (async () => analysisStatus(ticketsDatabase()))().catch((error) => {
    console.error("The Feedback analysis runs could not be read", error);

    return { running: false, availableAt: null, lastFailed: 0 };
  });
  // Top product ignores the date range; a failed read shows on its card only.
  const topProduct: TopProductCard = await readTopProduct(ticketsDatabase()).then(
    (result): TopProductCard => ({ ok: true, result }),
    (error): TopProductCard => {
      console.error("The Top product could not be read", error);

      return { ok: false };
    },
  );

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <div className="flex shrink-0 items-center gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Feedback</h1>
          <p className="text-sm leading-[normal] text-[#6e6680]">
            Every Feedback is tied to a delivered Order.
          </p>
        </div>
        {lastAnalyzed && (
          <p className="shrink-0 text-xs leading-[normal] text-[#6e6680]" data-testid="last-analyzed">
            {lastAnalyzed}
          </p>
        )}
        <AnalyzeButton
          keysSet={groq !== null || gemini !== null}
          running={status.running}
          availableAt={status.availableAt?.toISOString() ?? null}
          lastFailed={status.lastFailed}
        />
        <DateRangeButton filters={filters} today={manilaToday()} />
      </div>
      <FeedbackSummaryCards summary={result.list.summary} response={result.list.response} topProduct={topProduct} />
      <FeedbackListView list={result.list} filters={filters} />
    </div>
  );
}
