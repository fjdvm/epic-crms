import { expect, it, vi } from "vitest";

import { proofReadsFor, proofReadsOrEmpty } from "@/features/orders/proof-read";

// postgres.Sql is both a tagged template and a helper (sql(ids)); the stub serves both.
const stub = (rows: unknown[] | Error) => Object.assign((first: unknown) => (Array.isArray(first) && "raw" in first ? Promise.resolve().then(() => { if (rows instanceof Error) throw rows; return rows; }) : first), {}) as never;

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
