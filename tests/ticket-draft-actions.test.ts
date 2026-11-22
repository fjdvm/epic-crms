import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { reply, requestDraftedReply } from "@/features/tickets/actions";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

const { audit, requireModule, configuredModels } = vi.hoisted(() => ({ audit: vi.fn(), requireModule: vi.fn(), configuredModels: vi.fn() }));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: audit, gatewayFileStorage: {} }));
vi.mock("@/lib/portal/staff", () => ({ requireModule }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/tickets-db", () => ({ ticketsDatabase: () => db.sql, ticketsWriterDatabase: () => db.sql }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => db.sql }));
vi.mock("@/lib/ai/structured", async importOriginal => ({ ...await importOriginal<typeof import('@/lib/ai/structured')>(), configuredStructuredModels: configuredModels }));
let db: TestDatabase;
beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql.unsafe(readFileSync('docs/db/crms-ticket-drafts.sql', 'utf8'));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  vi.clearAllMocks();
  requireModule.mockResolvedValue({ id: 'portal-id', username: 'liza', name: 'Liza Cruz', role: 'Staff' });
  configuredModels.mockReturnValue([{ name: 'fake', model: new MockLanguageModelV4({ doGenerate: async () => ({
    content: [{ type: 'text', text: JSON.stringify({ sentences: ['Hello!', 'Thank you for getting in touch.'] }) }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 10, text: 10, reasoning: undefined } }, warnings: [],
  }) }) }]);
  await db.sql`truncate ticket_messages, tickets, customers restart identity cascade`;
  await db.sql`truncate crms.ticket_drafts restart identity`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria Santos', 'maria@example.com')`;
  await db.sql`insert into tickets (customer_id, subject, claimed_by_id, claimed_by_name) values ('c1', 'Help', 'liza', 'Liza Cruz')`;
});
it('audits sent as drafted and sent as edited with the Claimer identity only after a successful normal send', async () => {
  const result = await requestDraftedReply(1, { language: 'English' });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  expect(audit).not.toHaveBeenCalled();
  expect(await db.sql`select * from ticket_messages`).toHaveLength(0);
  for (const [body, decision] of [[result.draft.text, 'sent as drafted'], ['Here is my edited reply.', 'sent as edited']]) {
    const form = new FormData(); form.set('body', body); form.set('draftId', String(result.draft.id));
    const sent = await reply(1, form);
    expect(sent.ok).toBe(true);
    expect(audit).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'ticket.drafted_reply_sent', actor: { type: 'user', id: 'portal-id', display_name: 'Liza Cruz' },
      description: `Liza Cruz ${decision} on Ticket TKT-1.`, metadata: expect.objectContaining({ decision, draftId: result.draft.id }),
    }));
  }
  expect(audit).toHaveBeenCalledTimes(2);
  expect(audit.mock.calls[0][0].operationId).not.toBe(audit.mock.calls[1][0].operationId);
  await db.sql`update tickets set claimed_by_id = 'other' where id = 1`;
  const form = new FormData(); form.set('body', 'Cannot send'); form.set('draftId', String(result.draft.id));
  expect((await reply(1, form)).ok).toBe(false);
  expect(audit).toHaveBeenCalledTimes(2);
});
it('requires the Tickets Module, refuses read-only Roles before configuring models, and allows a Manager Claimer', async () => {
  requireModule.mockRejectedValueOnce(new Error('denied'));
  await expect(requestDraftedReply(1, { language: 'English' })).rejects.toThrow('denied');
  expect(requireModule).toHaveBeenCalledWith('Tickets');
  for (const role of ['Admin']) {
    requireModule.mockResolvedValue({ id: 'portal-id', username: 'liza', name: 'Liza Cruz', role });
    expect((await requestDraftedReply(1, { language: 'English' })).ok).toBe(false);
  }
  expect(configuredModels).not.toHaveBeenCalled();
  requireModule.mockResolvedValue({ id: 'portal-id', username: 'liza', name: 'Liza Cruz', role: 'CREOMS Manager' });
  expect((await requestDraftedReply(1, { language: 'English' })).ok).toBe(true);
});
it('refuses forged, foreign, missing and dropped draft references without sending or auditing', async () => {
  const made = await requestDraftedReply(1, { language: 'English' });
  if (!made.ok) throw new Error(made.reason);
  await db.sql`update crms.ticket_drafts set requested_by_id = 'other' where id = ${made.draft.id}`;
  for (const draftId of [String(made.draft.id), '999', 'NaN', '-1', '']) {
    const form = new FormData(); form.set('body', 'hello'); form.set('draftId', draftId);
    expect(await reply(1, form)).toEqual({ ok: false, reason: 'invalid-draft' });
  }
  await db.sql`update crms.ticket_drafts set requested_by_id = 'liza', reply = null where id = ${made.draft.id}`;
  const form = new FormData(); form.set('body', 'hello'); form.set('draftId', String(made.draft.id));
  expect(await reply(1, form)).toEqual({ ok: false, reason: 'invalid-draft' });
  expect(await db.sql`select * from ticket_messages`).toHaveLength(0);
  expect(audit).not.toHaveBeenCalled();
});
