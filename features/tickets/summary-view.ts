export interface TicketSummary {
  text: string;
  model: string;
  sentText: string;
  systemPrompt: string;
  createdAt: string;
}
export interface SummaryResult {
  summary: TicketSummary | null;
  unavailable: boolean;
}
