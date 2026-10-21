import type { FeedbackSummary, ResponseRate } from "./feedback";

const CARD = "flex min-w-0 flex-col gap-[6px] rounded-xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]";

/** The Average rating, Low ratings and Response rate cards, for the Feedback the date range and star filter leave. */
export function FeedbackSummaryCards({ summary, response }: { summary: FeedbackSummary; response: ResponseRate }) {
  return (
    <div className="grid shrink-0 grid-cols-2 gap-4 lg:grid-cols-4">
      <div className={CARD} data-testid="average-rating">
        <p className="text-[13px] font-medium text-[#6e6680]">Average rating</p>
        <p className="text-2xl font-semibold text-[#1f1a2e]">
          {summary.average === null ? "–" : `${summary.average.toFixed(1)} ★`}
        </p>
        <p className="text-xs text-[#6e6680]">
          {summary.count} Feedback
        </p>
      </div>
      <div className={CARD} data-testid="low-ratings">
        <p className="text-[13px] font-medium text-[#6e6680]">Low ratings</p>
        <p className="text-2xl font-semibold text-[#1f1a2e]">{summary.low}</p>
        <p className="text-xs text-[#9a3412]">1 to 3 stars</p>
      </div>
      <div className={CARD} data-testid="response-rate">
        <p className="text-[13px] font-medium text-[#6e6680]">Response rate</p>
        {response.rate === null ? (
          <p className="text-xs text-[#6e6680]">No requests yet</p>
        ) : (
          <>
            <p className="text-2xl font-semibold text-[#1f1a2e]">{response.rate}%</p>
            <p className="text-xs text-[#6e6680]">Of delivery emails</p>
          </>
        )}
      </div>
    </div>
  );
}
