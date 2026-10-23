import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getReturns, getReturnStats, getReturnDetail } from "@/features/returns/actions";
import { canOpenOrders, getShell, requireAnyModule } from "@/lib/portal/staff";
import { ORDER_DETAIL_MODULES } from "@/lib/portal/config";
import { FakePortal, FAKE_CALLBACK, FAKE_PORTAL_URL, FAKE_SYSTEM, FAKE_SECRET, portalFetch } from "./fake-portal";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

const session = vi.hoisted(() => ({ handle: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: session.handle }) }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/db", () => ({ database: () => db.sql }));
let db: TestDatabase;
let portal: FakePortal;
beforeAll(async () => { db = await startTestDatabase(); }, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  portal = new FakePortal();
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("CREOMS_DEV_BYPASS", "false");
  await db.sql`truncate order_returns, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria Santos', 'maria@example.com')`;
  await db.sql`insert into orders (customer_id) values ('c1')`;
  await db.sql`insert into order_returns (order_id, reason, amount_in_centavos) values (1, 'damaged', 10000)`;
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function signIn(modules: string[]) {
  portal.addStaff('ana', { username: 'ana', name: 'Ana Reyes', email: 'ana@example.com', role: 'Staff' }, modules);
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
  it('returns no data to other Modules or after Returns access is revoked', async () => {
    await signIn(['Orders', 'Payments', 'Fulfilment']);
    const denied = async () => {
      for (const read of [getReturns, getReturnStats, () => getReturnDetail(1)]) {
        await expect(read()).rejects.toMatchObject({ digest: expect.stringContaining('/no-access') });
      }
    };
    await denied();
    portal.grant('ana', 'Returns');
    expect((await getReturns()).ok).toBe(true);
    portal.revoke('ana', 'Returns');
    await denied();
  });
  it('allows Returns Staff to read the list, stats, detail and Order detail access', async () => {
    await signIn(['Returns']);
    expect(await getReturns()).toMatchObject({ ok: true, list: { rows: [{ number: 'RMA-1' }] } });
    expect(await getReturnStats()).toMatchObject({ ok: true, stats: { openReturns: 1 } });
    expect(await getReturnDetail(1)).toMatchObject({ ok: true, detail: { number: 'RMA-1' } });
    expect(await canOpenOrders()).toBe(true);
    expect(await requireAnyModule(ORDER_DETAIL_MODULES)).toMatchObject({ username: 'ana' });
    expect(await getShell()).toMatchObject({ permittedPages: ['/returns'] });
  });
});
