import { describe, expect, it } from "vitest";
import { writeUnits } from "./audit-coverage-scan";

// Guard for #741: every write Server Action and write API route (POST/PUT/PATCH/DELETE, plus the cron GETs) must
// reach the shared audit boundary (recordAudit, deliverGatewayAuditEvent or the injected AuditTrail) or sit on this
// reviewed exemption list with a reason. The list only shrinks: each group PR of #741 deletes its entries, and an
// entry whose unit is now audited, or no longer exists, fails the test until it is removed.
//
// Reasons start with "read-only:" (changes nothing, so no Audit Event is owed), "own-state:" (a person's own view
// state, not business data) or "gap:" (a real gap, naming the #741 group that closes it).
const exempt: Record<string, string> = {
  // Reads: nothing changes.
  "features/customer-profiles/task-actions.ts#listTaskOwners": "read-only: lists Staff to assign",
  "features/feedback/actions.ts#loadProductAdvice": "read-only: loads stored advice",
  "features/notifications/actions.ts#staffNotificationsLiveUrl": "read-only: returns a socket URL",
  "features/orders/actions.ts#loadCancellableOrderItems": "read-only",
  "features/orders/actions.ts#loadPaymentQueue": "read-only",
  "features/orders/actions.ts#loadPayments": "read-only",
  "features/orders/actions.ts#getFulfilmentBoard": "read-only",
  "features/orders/cod-actions.ts#loadCodFlagsForOrders": "read-only",
  "features/orders/failed-delivery-actions.ts#loadFailedDeliveryHistory": "read-only",
  "features/orders/live-actions.ts#staffOrdersLiveUrl": "read-only: returns a socket URL",
  "features/orders/payment-review-actions.ts#loadReviewManagers": "read-only: lists Managers",
  "features/orders/stock-live-actions.ts#staffStockLiveUrl": "read-only: returns a socket URL",
  "features/orders/stock-live-actions.ts#refetchStock": "read-only",
  "features/orders/stock-live-actions.ts#refetchStockSize": "read-only",
  "features/returns/actions.ts#getReturns": "read-only",
  "features/returns/actions.ts#getReturnStats": "read-only",
  "features/returns/actions.ts#getReturnDetail": "read-only",
  "features/senior-pwd/actions.ts#loadVerifications": "read-only",
  "features/senior-pwd/actions.ts#loadVerificationDetail": "read-only (the ID photo read is audited separately)",
  "features/tickets/actions.ts#liveUrl": "read-only: returns a socket URL",
  "features/tickets/actions.ts#findCustomers": "read-only: search",
  "features/tickets/actions.ts#findCustomerOrders": "read-only: search",
  "features/tickets/actions.ts#listTicketNotes": "read-only",
  "features/tickets/reassign-actions.ts#reassignOptions": "read-only: lists Staff",
  "features/tickets/reassign-actions.ts#absentTickets": "read-only",
  "app/api/dashboard/unusual-activity/explain/route.ts#POST": "read-only: AI explanation, saves nothing",
  "app/api/dashboard/unusual-activity/route.ts#POST": "read-only: AI reading of existing figures, saves nothing",
  "app/api/feedback/complaint-themes/route.ts#POST": "read-only: AI themes, saves nothing",
  "app/api/returns/[id]/flag-explanation/route.ts#POST": "read-only: AI explanation, saves nothing",
  "app/api/tickets/summary/route.ts#POST": "read-only: AI summary, saves nothing",
  // A person's own view state.
  "features/notifications/actions.ts#markNotificationRead": "own-state: the reader's own unread flag",
  "features/notifications/actions.ts#markAllNotificationsRead": "own-state: the reader's own unread flags",
  // Gaps still to close, by #741 group.
  "features/files/actions.ts#getFileView": "gap: group 1, sensitive read of an uploaded file",
  "features/files/actions.ts#requestFileUpload": "gap: group 1, upload started",
  "features/files/actions.ts#confirmFileUpload": "gap: group 1, upload saved",
  "features/files/actions.ts#importDeliveryPhotoLink": "gap: group 1, delivery photo imported",
  "features/orders/actions.ts#reconcileDeliveryPhoto": "gap: group 1, evidence promotion",
  "features/orders/actions.ts#loadPackingSlip": "gap: group 1, packing slip download",
  "features/orders/cancellation-actions.ts#reconcileCancellationProof": "gap: group 2, evidence promotion",
  "features/returns/actions.ts#reconcileRefundProof": "gap: group 2, evidence promotion",
  "app/api/internal/ims-stock/route.ts#POST": "gap: group 1, stock changed from the inventory system",
  "app/api/internal/ims-stock/route.ts#DELETE": "gap: group 1, deleted product removed from the inventory system",
  "app/api/notifications/sync/route.ts#POST": "gap: group 1, Staff-requested storefront sync",
  "app/api/orders/product-image/route.ts#POST": "gap: group 1, product image saved",
  "app/api/portal/logout/route.ts#POST": "gap: group 1, sign-out",
};

const units = writeUnits();
const ids = units.map((u) => u.id);

describe("audit coverage of write actions", () => {
  it("scans the real source (guards the guard)", () => {
    expect(units.length).toBeGreaterThan(100);
    expect(ids).toContain("features/orders/actions.ts#markPaid");
    expect(ids).toContain("app/api/cron/proof-reader/route.ts#GET");
    expect(ids).not.toContain("app/api/health/route.ts#GET");
    expect(units.find((u) => u.id === "features/orders/actions.ts#markPaid")?.audited).toBe(true);
    expect(units.find((u) => u.id === "features/orders/actions.ts#loadPayments")?.audited).toBe(false);
  });

  it("has an Audit Event or a reviewed exemption for every write action and route", () => {
    const missing = units.filter((u) => !u.audited && !(u.id in exempt)).map((u) => u.id);
    expect(missing, "add an Audit Event through the shared boundary, or a reviewed exemption with a reason").toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    const byId = new Map(units.map((u) => [u.id, u]));
    const stale = Object.keys(exempt).filter((id) => !byId.has(id) || byId.get(id)!.audited);
    expect(stale, "remove entries that are audited now or no longer exist").toEqual([]);
    for (const [id, reason] of Object.entries(exempt)) expect(reason, id).toMatch(/^(read-only|own-state|gap: group [1-5])/);
  });
});
