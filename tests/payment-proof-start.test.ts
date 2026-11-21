import { beforeEach, expect, it, vi } from "vitest";

let impl: () => Promise<unknown> = async () => undefined;
let calls = 0;
const read = () => { calls++; return impl(); };
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => { void fn(); } }));
vi.mock("@/lib/ai/structured", () => ({ configuredVisionModels: () => [] }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => ({}) }));
vi.mock("@/lib/tickets-db", () => ({ ticketsDatabase: () => ({}) }));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: {} }));
vi.mock("@/features/returns/photo-bytes", () => ({ fetchReturnPhoto: vi.fn() }));
vi.mock("@/features/orders/proof-reader", () => ({ readPendingProofs: () => read() }));
import { startPaymentProofRead } from "@/features/orders/payment-proof-start";

beforeEach(() => { calls = 0; });

it("reads pending proofs once in the background", async () => {
  impl = async () => ({ read: 1, needsReview: 0, skipped: 0 });
  startPaymentProofRead();
  await Promise.resolve();
  expect(calls).toBe(1);
});

it("swallows a failed read", async () => {
  const log = vi.fn(); const original = console.error; console.error = log;
  impl = async () => { throw new Error("boom"); };
  expect(() => startPaymentProofRead()).not.toThrow();
  await new Promise(r => setTimeout(r, 0));
  console.error = original;
  expect(log).toHaveBeenCalled();
});
