import { expect, it, vi } from "vitest";

import { proofReadsFor, proofReadsOrEmpty, rejudge } from "@/features/orders/proof-read";

// postgres.Sql is both a tagged template and a helper (sql(ids)); the stub serves both.
const stub = (rows: unknown[] | Error, changes: unknown[] = []) => { let n = 0; return Object.assign((first: unknown) => (Array.isArray(first) && "raw" in first ? Promise.resolve().then(() => { if (rows instanceof Error) throw rows; return n++ === 0 ? rows : changes; }) : first), {}) as never; };

it("maps stored rows by proof id and treats a claim still reading as pending", async () => {
  const out = await proofReadsFor(stub([
    { proof_id: 1, status: "read", findings: { amount: { finding: "Match", read: "1", expected: "1" } }, flags: { reusedReferenceOrderIds: [3] } },
    { proof_id: 2, status: "reading", findings: null, flags: {} },
  ]), [1, 2, 3]);
  expect(out[1].status).toBe("read");
  expect(out[1].flags).toEqual({ reusedReferenceOrderIds: [3], reusedImageProofIds: [] });
  expect(out[2].status).toBe("pending");
  expect(out[3]).toBeUndefined();
});

it("makes no query for no proofs, and a failing read gives no findings instead of an error", async () => {
  expect(await proofReadsFor(stub([]), [])).toEqual({});
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await proofReadsOrEmpty(stub(new Error("down")), [1])).toEqual({});
  spy.mockRestore();
});

it("attaches corrections to their proof, oldest first, and keeps the original reading", async () => {
  const at = new Date("2026-11-18T10:00:00Z");
  const out = await proofReadsFor(stub(
    [{ proof_id: 1, status: "read", findings: { amount: { finding: "Mismatch", read: "1000", expected: "₱1,250.00" } }, flags: {} }],
    [{ proof_id: 1, kind: "correction", field: "amount", original_value: "1000", corrected_value: "1250", original_finding: "Mismatch", reason: "cut off", by_name: "Ana", created_at: at }],
  ), [1]);
  expect(out[1].findings!.amount.read).toBe("1000");
  expect(out[1].corrections).toEqual([{ kind: "correction", field: "amount", value: "1250", originalValue: "1000", originalFinding: "Mismatch", reason: "cut off", by: "Ana", at }]);
});

it("re-judges a typed correction against what the Order expects", () => {
  expect(rejudge("amount", "1250", "₱1,250.00")).toBe("Match");
  expect(rejudge("amount", "₱1,000", "₱1,250.00")).toBe("Mismatch");
  expect(rejudge("amount", "abc", "₱1,250.00")).toBe("Needs Review");
  expect(rejudge("date", "2026-11-18", "after 2026-11-18")).toBe("Match");
  expect(rejudge("date", "2026-11-01", "after 2026-11-18")).toBe("Mismatch");
  expect(rejudge("reference", "ab-12", "AB12")).toBe("Match");
  expect(rejudge("accountNumber", "0917 123 4567", "09171234567")).toBe("Match");
  expect(rejudge("recipient", "Juan", "Juan Dela Cruz")).toBe("Mismatch");
  expect(rejudge("reference", "x", null)).toBe("Needs Review");
});
