import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { loadFeedback } from "@/features/feedback/feedback";
import { FeedbackListView } from "@/features/feedback/feedback-list";
import { FeedbackSummaryCards } from "@/features/feedback/feedback-summary";
import { DateRangeButton } from "@/features/feedback/feedback-toolbar";
import { manilaToday, parseFilters } from "@/features/feedback/filters";
import { FEEDBACK_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

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

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <div className="flex shrink-0 items-center gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Feedback</h1>
          <p className="text-sm leading-[normal] text-[#6e6680]">
            Every Feedback is tied to a delivered Order.
          </p>
        </div>
        <DateRangeButton filters={filters} today={manilaToday()} />
      </div>
      <FeedbackSummaryCards summary={result.list.summary} />
      <FeedbackListView list={result.list} filters={filters} />
    </div>
  );
}
