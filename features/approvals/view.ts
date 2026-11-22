import type { ApprovalAction } from "./workflow";

/** Senior/PWD ID checks sit in the same list but are decided on their own review page, not by a Manager step. */
export type ApprovalListAction = ApprovalAction | "id-check";

/** A request as the browser sees it: plain strings, no Dates. */
export type ApprovalView = {
  id: string;
  action: ApprovalListAction;
  /** The Module the request was raised under; a Return unless said otherwise. */
  module?: string;
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
  /** What Staff checked when they asked a Manager to decide a Return; only on `return.decide`. */
  check?: { inWindow: boolean; photoSupportsReason: boolean };
};

export type ApprovalTab = "waiting" | "approved" | "declined" | "all";

export const WAITING = ["waiting-manager", "waiting-ceo", "waiting-id"];
export const APPROVED = ["approved", "executing", "completed"];

export function inTab(status: string, tab: ApprovalTab): boolean {
  if (tab === "all") return true;
  if (tab === "waiting") return WAITING.includes(status);
  if (tab === "approved") return APPROVED.includes(status);
  return status === "declined";
}

/** What kind of approval a request is, so the list can be grouped and filtered by it. */
export type ApprovalKind = "id-check" | "refund" | "payment" | "cancellation" | "write-off" | "return" | "price";
export type KindFilter = "all" | ApprovalKind;

export const KIND_LABELS: Record<ApprovalKind, string> = {
  "id-check": "ID checks", refund: "Refunds", payment: "Payments", cancellation: "Cancellations", "write-off": "Write-offs", return: "Returns", price: "Shop prices",
};
export const KINDS = Object.keys(KIND_LABELS) as ApprovalKind[];

export function kindOf(action: ApprovalListAction): ApprovalKind {
  if (action === "id-check") return "id-check";
  if (action === "return.refund") return "refund";
  if (action === "payment.approve-anyway") return "payment";
  if (action === "order.cancel-after-dispatch" || action === "order.cancel-settle") return "cancellation";
  if (action === "write-off") return "write-off";
  if (action === "product.price") return "price";
  return "return";
}

export function isKindFilter(value: string | undefined): value is KindFilter {
  return value === "all" || KINDS.includes(value as ApprovalKind);
}

/** What the request is about and where to open it: a Return, an Order, or an ID check's review page. */
export function targetOf(r: Pick<ApprovalView, "action" | "targetId" | "module">): { label: string; href: string } {
  if (r.action === "id-check") return { label: `ID check #${r.targetId}`, href: `/customer-profiles/senior-pwd/${r.targetId}` };
  if (r.action === "product.price") return { label: `Product ${r.targetId}`, href: "/orders/stock" };
  const aboutOrder = r.action.startsWith("order.") || r.action.startsWith("payment.") || (r.action === "write-off" && r.module === "Fulfilment");
  return aboutOrder
    ? { label: `BR-${r.targetId}`, href: `/orders/${r.targetId}` }
    : { label: `RMA-${r.targetId}`, href: `/returns/${r.targetId}` };
}

export function actionLabel(action: ApprovalListAction): string {
  return action === "id-check" ? "Senior/PWD ID check" : ACTION_LABELS[action];
}

export const ACTION_LABELS: Record<ApprovalAction, string> = {
  "order.cancel-after-dispatch": "Cancel after dispatch",
  "order.cancel-settle": "Cancellation refund and stock",
  "payment.approve-anyway": "Approve payment anyway",
  "return.approve": "Approve return",
  "return.decline": "Reject return",
  "return.refund": "Refund",
  "return.replace": "Replacement",
  "return.extend-window": "Extend return window",
  "return.change-destination": "Change refund destination",
  "return.decide": "Decide return",
  "write-off": "Write-off",
  "product.price": "Shop price",
};

/** Refunds and write-offs move money or stock, so their approval waits for the server. */
export function isMoneyDecision(action: ApprovalListAction): boolean {
  return action === "return.refund" || action === "write-off" || action === "product.price" || action === "order.cancel-after-dispatch" || action === "order.cancel-settle";
}

export const pesos = (centavos: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: centavos % 100 === 0 ? 0 : 2 }).format(centavos / 100);

export function waitingLabel(status: string): string {
  if (status === "waiting-id") return "Waiting for review";
  return status === "waiting-ceo" ? "Waiting for final approval" : "Waiting for approval";
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
export function stepFor(role: string | null, status: string): "manager" | null {
  // A request left waiting for the old CEO step is finished by any Manager-level person.
  if (role === "manager" && (status === "waiting-manager" || status === "waiting-ceo")) return "manager";
  return null;
}

export function toView(row: Record<string, unknown>): ApprovalView {
  return {
    id: String(row.id), action: row.action as ApprovalAction, module: row.module ? String(row.module) : undefined, targetId: String(row.target_id),
    amountInCentavos: Number(row.amount_in_centavos), limitInCentavos: Number(row.limit_in_centavos),
    reason: String(row.reason ?? ""), requesterId: String(row.requester_id), requesterName: String(row.requester_name),
    status: String(row.status), requestedAt: new Date(row.requested_at as string | Date).toISOString(),
    managerName: (row.manager_name as string | null) ?? null, ceoName: (row.ceo_name as string | null) ?? null,
    declineReason: (row.decline_reason as string | null) ?? null,
    ...(row.action === "return.decide" ? { check: checkOf(row.payload) } : {}),
  };
}

function checkOf(payload: unknown): ApprovalView["check"] {
  const p = (payload ?? {}) as Record<string, unknown>;
  return { inWindow: p.inWindow === true, photoSupportsReason: p.photoSupportsReason === true };
}

/** An ID check as a row of the list: waiting until reviewed, then approved or declined (revoked and expired count as declined). */
export function idCheckToView(v: {
  id: number; customerName: string; idType: "senior" | "pwd"; status: string; submittedAt: Date;
  decidedByName: string | null; declineReason: string | null;
}, readerFlags?: number): ApprovalView {
  const kind = v.idType === "senior" ? "Senior citizen" : "PWD";
  // The ID reader's count, on waiting checks only: a hint of what to look at, never a decision.
  const flagged = v.status === "pending" && readerFlags
    ? ` · ID reader flagged ${readerFlags} thing${readerFlags === 1 ? "" : "s"} to check` : "";
  const status = v.status === "pending" ? "waiting-id" : v.status === "approved" ? "approved" : "declined";

  return {
    id: `id-${v.id}`, action: "id-check", module: "Senior/PWD", targetId: String(v.id), amountInCentavos: 0, limitInCentavos: 0,
    reason: `${kind} ID uploaded for review${flagged}`, requesterId: "", requesterName: v.customerName, status,
    requestedAt: v.submittedAt.toISOString(), managerName: v.decidedByName, ceoName: null,
    declineReason: status === "declined" ? v.declineReason ?? `${v.status[0].toUpperCase()}${v.status.slice(1)}` : null,
  };
}
