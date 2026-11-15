import type { ApprovalAction } from "./workflow";

/** A request as the browser sees it: plain strings, no Dates. */
export type ApprovalView = {
  id: string;
  action: ApprovalAction;
  targetId: string;
  amountInCentavos: number;
  limitInCentavos: number;
  reason: string;
  requesterId: string;
  requesterName: string;
  status: string;
  requestedAt: string;
  managerName: string | null;
  ceoName: string | null;
  declineReason: string | null;
};

export type ApprovalTab = "waiting" | "approved" | "declined" | "all";

export const WAITING = ["waiting-manager", "waiting-ceo"];
export const APPROVED = ["approved", "executing", "completed"];

export function inTab(status: string, tab: ApprovalTab): boolean {
  if (tab === "all") return true;
  if (tab === "waiting") return WAITING.includes(status);
  if (tab === "approved") return APPROVED.includes(status);
  return status === "declined";
}

export const ACTION_LABELS: Record<ApprovalAction, string> = {
  "payment.approve-anyway": "Approve payment anyway",
  "return.approve": "Approve return",
  "return.decline": "Reject return",
  "return.refund": "Refund",
  "return.replace": "Replacement",
  "return.extend-window": "Extend return window",
  "write-off": "Write-off",
};

/** Refunds and write-offs move money or stock, so their approval waits for the server. */
export function isMoneyDecision(action: ApprovalAction): boolean {
  return action === "return.refund" || action === "write-off";
}

export const pesos = (centavos: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: centavos % 100 === 0 ? 0 : 2 }).format(centavos / 100);

export function waitingLabel(status: string): string {
  return status === "waiting-ceo" ? "Waiting for the CEO's final approval" : "Waiting for approval";
}

export function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

export function summarize(requests: ApprovalView[], now: number) {
  const waiting = requests.filter(r => WAITING.includes(r.status));
  const oldest = waiting.reduce<number | null>((min, r) => Math.min(min ?? Infinity, Date.parse(r.requestedAt)), null);
  const day = new Date(now).toDateString();
  const today = requests.filter(r => new Date(r.requestedAt).toDateString() === day);
  return {
    waiting: waiting.length,
    oldest: oldest === null ? null : ago(new Date(oldest).toISOString(), now),
    money: waiting.reduce((sum, r) => sum + r.amountInCentavos, 0),
    approvedToday: today.filter(r => APPROVED.includes(r.status)).length,
    declinedToday: today.filter(r => r.status === "declined").length,
  };
}

/** Which step, if any, this Role may decide on this request. */
export function stepFor(role: string | null, status: string): "manager" | "ceo" | null {
  if (role === "manager" && status === "waiting-manager") return "manager";
  if (role === "ceo" && status === "waiting-ceo") return "ceo";
  return null;
}

export function toView(row: Record<string, unknown>): ApprovalView {
  return {
    id: String(row.id), action: row.action as ApprovalAction, targetId: String(row.target_id),
    amountInCentavos: Number(row.amount_in_centavos), limitInCentavos: Number(row.limit_in_centavos),
    reason: String(row.reason ?? ""), requesterId: String(row.requester_id), requesterName: String(row.requester_name),
    status: String(row.status), requestedAt: new Date(row.requested_at as string | Date).toISOString(),
    managerName: (row.manager_name as string | null) ?? null, ceoName: (row.ceo_name as string | null) ?? null,
    declineReason: (row.decline_reason as string | null) ?? null,
  };
}
