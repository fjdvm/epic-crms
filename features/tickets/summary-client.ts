import type { SummaryResult } from "./summary-view";

/** One open request, independent of the serialized Server Action queue; no retries or refetch triggers. */
export async function loadTicketSummary(ticketId: number): Promise<SummaryResult> {
  const response = await fetch("/api/tickets/summary", {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", "X-CREOMS-Ticket-Open": "1" },
    body: JSON.stringify({ ticketId }),
  });
  if (!response.ok) return { summary: null, unavailable: true };
  return response.json();
}
