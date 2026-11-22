import { withRefundDetails } from "./refund-details";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getReturns, getReturnStats, getReturnDetail, approveReturn, declineReturn, markReturnGoodsReceived, markReturnRefunded, markReturnReplaced, reconcileRefundProof } from "@/features/returns/actions";
import { canOpenOrders, getShell, requireAnyModule } from "@/lib/portal/staff";
import { ORDER_DETAIL_MODULES } from "@/lib/portal/config";
import { FakePortal, FAKE_CALLBACK, FAKE_PORTAL_URL, FAKE_SYSTEM, FAKE_SECRET, portalFetch } from "./fake-portal";
import { revalidatePath } from "next/cache";
import { FakeStorefront, FAKE_SERVICE_SECRET, FAKE_STOREFRONT_URL, storefrontFetch } from "./fake-storefront";
import { refundVia, REFUND_PROOF_SQL, REFUND_PROOF_TABLES } from "./refund-via";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

import { FakeFileStorage, PNG } from "./fake-file-storage";
const storage = new FakeFileStorage();
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: vi.fn(async () => {}), get gatewayFileStorage() { return storage; } }));
function proof() {
  const form = new FormData();
  form.set("proof", storage.readyEvidence("Returns", PNG, "ana"));
  return withRefundDetails(form);
}
vi.mock("@/features/files/storage", () => ({
  storageUrl: (url: string) => url,
  directFileStorage: { view: vi.fn((id: string) => storage.view(id)) },
}));
const session = vi.hoisted(() => ({ handle: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: session.handle }) }),
  headers: async () => new Headers(),
}));
vi.mock("@/features/returns/refund-proof-start", () => ({ startRefundProofRead: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ database: () => db.sql }));
let db: TestDatabase;
let portal: FakePortal;
let storefront: FakeStorefront;
beforeAll(async () => { db = await startTestDatabase(); await db.sql`create schema if not exists crms`; await db.sql.unsafe(readFileSync("docs/db/crms-approvals.sql", "utf8")); for (const file of REFUND_PROOF_SQL) await db.sql.unsafe(readFileSync(file, "utf8")); await db.sql.unsafe(readFileSync("docs/db/crms-access-audit.sql", "utf8")); }, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql.unsafe(`truncate ${REFUND_PROOF_TABLES}`);
  portal = new FakePortal();
  storefront = new FakeStorefront(db.sql, undefined, storage);
  storage.reset();
  const portalRequest = portalFetch(portal);
  const storefrontRequest = storefrontFetch(storefront);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return new URL(request.url).origin === FAKE_PORTAL_URL ? portalRequest(request) : storefrontRequest(request);
  });
  vi.stubEnv("CREOMS_STOREFRONT_URL", FAKE_STOREFRONT_URL);
  vi.stubEnv("CREOMS_SERVICE_SECRET", FAKE_SERVICE_SECRET);
  vi.clearAllMocks();
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("CREOMS_DEV_BYPASS", "false");
  await db.sql`truncate order_returns, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria Santos', 'maria@example.com')`;
  await db.sql`insert into orders (customer_id, payment_method, subtotal_in_centavos) values ('c1', 'gcash', 10000000)`;
  await db.sql`insert into order_returns (order_id, reason, amount_in_centavos) values (1, 'damaged', 10000)`;
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function signIn(modules: string[]) {
  portal.addStaff('ana', { id: 'ana', username: 'ana', name: 'Ana Reyes', email: 'ana@example.com', role: 'CRMS Manager' }, modules);
  portal.signIn('ana');
  const verifier = 'proof-for-returns';
  const authorize = new URL('/api/integrations/authorize', FAKE_PORTAL_URL);
  authorize.search = new URLSearchParams({ system: FAKE_SYSTEM, redirect_uri: FAKE_CALLBACK, state: 's',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
  const response = await portal.handle(new Request(authorize));
  const code = new URL(response.headers.get('location')!).searchParams.get('code');
  const exchange = await portal.handle(new Request(`${FAKE_PORTAL_URL}/api/integrations/exchange`, {
    method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${FAKE_SYSTEM}:${FAKE_SECRET}`).toString('base64')}` },
    body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: FAKE_CALLBACK, state: 's' }),
  }));
  session.handle = (await exchange.json()).handle;
  expect(session.handle).toBeTruthy();
}

describe('Returns server access', () => {
  it('allows Returns-only Staff decisions and rechecks the Portal after revocation', async () => {
    await signIn(['Returns']);
    expect(await approveReturn(1, true)).toMatchObject({ ok: true });
    expect(await markReturnGoodsReceived(1)).toMatchObject({ ok: true });
    portal.revoke('ana', 'Returns');
    await expect(markReturnRefunded(1)).rejects.toMatchObject({ digest: expect.stringContaining('/no-access') });
    await expect(reconcileRefundProof(1)).rejects.toMatchObject({ digest: expect.stringContaining('/no-access') });
    expect(storage.files.size).toBe(0);
    expect(storefront.requests).toBe(2);
    portal.grant('ana', 'Returns');
    expect(await refundVia(db.sql, 1, proof())).toMatchObject({ ok: true });
    expect(await getReturnDetail(1)).toMatchObject({ ok: true, detail: {
      history: [
        { status: 'approved', actor: { id: 'ana', name: 'Ana Reyes' } },
        { status: 'goods received', actor: { id: 'ana', name: 'Ana Reyes' } },
        { status: 'refunded', actor: { id: 'ana', name: 'Ana Reyes' } },
      ],
    } });
    expect(storefront.requests).toBe(3);
  });
  it('returns no data to other Modules or after Returns access is revoked', async () => {
    await signIn(['Orders', 'Payments', 'Fulfilment']);
    const denied = async () => {
      for (const read of [getReturns, getReturnStats, () => getReturnDetail(1),
        () => approveReturn(1, false), () => declineReturn(1, "Wrong Order"),
        () => markReturnGoodsReceived(1), () => markReturnReplaced(1), () => reconcileRefundProof(1), () => markReturnRefunded(1)]) {
        await expect(read()).rejects.toMatchObject({ digest: expect.stringContaining('/no-access') });
      }
    };
    await denied();
    portal.grant('ana', 'Returns');
    expect((await getReturns()).ok).toBe(true);
    portal.revoke('ana', 'Returns');
    await denied();
    expect(storefront.requests).toBe(0);
    expect(storage.files.size).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it('allows Returns Staff to read the list, stats, detail and Order detail access', async () => {
    await signIn(['Returns']);
    expect(await getReturns()).toMatchObject({ ok: true, list: { rows: [{ number: 'RMA-1' }] } });
    expect(await getReturnStats()).toMatchObject({ ok: true, stats: { openReturns: 1 } });
    expect(await getReturnDetail(1)).toMatchObject({ ok: true, detail: { number: 'RMA-1' } });
    expect(await canOpenOrders()).toBe(true);
    expect(await requireAnyModule(ORDER_DETAIL_MODULES)).toMatchObject({ username: 'ana' });
    expect(await getShell()).toMatchObject({ permittedPages: ['/returns', '/approvals'] });
  });
});

vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => db.sql }));

vi.mock("next/server", () => ({ after: (work: () => Promise<void>) => work() }));
