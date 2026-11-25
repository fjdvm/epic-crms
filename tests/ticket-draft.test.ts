import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { draftReply } from "@/features/tickets/draft";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql.unsafe(readFileSync("docs/db/crms-ticket-drafts.sql", "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate ticket_messages, tickets, customers restart identity cascade`;
  await db.sql`truncate crms.ticket_drafts restart identity`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria Santos', 'maria@example.com')`;
});
const actor = { id: "staff", name: "Liza Cruz", role: "Staff" };
const deps = () => ({ tickets: db.sql, crms: db.sql });
async function ticket() {
  const [t] = await db.sql`insert into tickets (customer_id, subject, claimed_by_id, claimed_by_name)
    values ('c1', 'Where is my order?', 'staff', 'Liza Cruz') returning id`;
  return Number(t.id);
}
function fake(sentences = ["Hello!", "{{status}}", "Thank you for your patience."]) {
  return new MockLanguageModelV4({ doGenerate: async () => ({
    content: [{ type: "text", text: JSON.stringify({ sentences }) }],
    finishReason: { unified: "stop", raw: undefined },
    usage: { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 10, text: 10, reasoning: undefined } }, warnings: [],
  }) });
}
it("only a working Claimer of an Open Ticket may configure a model", async () => {
  const id = await ticket();
  const never = () => { throw new Error("must not configure"); };
  for (const role of ["Admin", "unknown"]) {
    expect((await draftReply(deps(), { ...actor, role }, id, { language: "English" }, never)).ok).toBe(false);
  }
  expect((await draftReply(deps(), { ...actor, id: "other" }, id, { language: "English" }, never)).ok).toBe(false);
  for (const status of ["on_hold", "resolved", "completed"]) {
    await db.sql`update tickets set status = ${status} where id = ${id}`;
    expect((await draftReply(deps(), actor, id, { language: "English" }, never)).ok).toBe(false);
  }
  await db.sql`update tickets set status = 'open', claimed_by_id = null where id = ${id}`;
  expect((await draftReply(deps(), actor, id, { language: "English" }, never)).ok).toBe(false);
});
it("uses only six public Messages, masks private details, persists exact input and inserts real facts", async () => {
  const id = await ticket();
  const [o] = await db.sql`insert into orders (customer_id, status, subtotal_in_centavos, dispatched_at)
    values ('c1', 'dispatched', 99900, '2026-11-14T05:40:00Z') returning id`;
  await db.sql`update tickets set order_id = ${o.id} where id = ${id}`;
  await db.sql`insert into order_delivery_addresses (order_id, street, barangay, city, province, postal_code)
    values (${o.id}, '123 Private Street', 'Secret Village', 'Antipolo', 'Rizal', '1870')`;
  await db.sql`insert into ticket_messages (ticket_id, sender, body) values (${id}, 'customer', 'OLD omitted message')`;
  for (let i = 0; i < 6; i++) await db.sql`insert into ticket_messages (ticket_id, sender, body)
    values (${id}, 'customer', ${`Message ${i}: Maria Santos maria@example.com 0917 123 4567${i === 2 ? " at 123 Private Street, Secret Village, Antipolo, Rizal 1870" : ""}`})`;
  await db.sql`insert into ticket_messages (ticket_id, sender, body, internal) values (${id}, 'staff', 'SECRET note', true)`;
  const model = fake(["Hello!", "{{status}}", "{{dispatched_at}}", "{{payment_method}}"]);
  const result = await draftReply(deps(), actor, id, { language: "English" }, () => [{ name: "fake", model }]);
  expect(result).toMatchObject({ ok: true, draft: { text: expect.stringContaining('dispatched'), sentText: expect.any(String) } });
  if (!result.ok) throw new Error(result.reason);
  expect(result.draft.text).toContain('2026-11-14T05:40:00.000Z');
  expect(result.draft.sentText).not.toMatch(/OLD|SECRET|Maria|Santos|maria@|0917|123 Private|Secret Village|Antipolo|Rizal|1870|99900/);
  expect(result.draft.sentText).toContain('Message 0');
  expect(result.draft.sentText).toContain('Message 5');
  expect(model.doGenerateCalls[0].prompt).toContainEqual({ role: 'user', content: [{ type: 'text', text: result.draft.sentText }] });
  const [stored] = await db.sql`select * from crms.ticket_drafts where id = ${result.draft.id}`;
  expect(stored.sent_text).toBe(result.draft.sentText);
  expect(stored.reply).toBe(result.draft.text);
  expect(await db.sql`select * from ticket_messages where ticket_id = ${id} and sender = 'staff' and internal = false`).toHaveLength(0);
});
it("drops invented links, dates and statuses with a plain reason and keeps the submitted input", async () => {
  const id = await ticket();
  for (const sentence of ['https://invented.example/parcel', 'Delivered on 25 December 2026.', '{{invented_status}}']) {
    const model = fake([sentence]);
    const result = await draftReply(deps(), actor, id, { language: 'English' }, () => [{ name: 'fake', model }]);
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('could not be checked against the Order') });
  }
  const records = await db.sql`select reply, refusal, sent_text from crms.ticket_drafts`;
  expect(records).toHaveLength(3);
  expect(records.every(r => r.reply === null && r.refusal && r.sent_text)).toBe(true);
});
it("drops only the unchecked sentences and keeps the rest of the reply", async () => {
  const id = await ticket();
  const model = fake([
    'Sorry po that your ube arrived expired.',
    'We are sorry this happened.',
    'Delivered on 25 December 2026.',
    'Please send us a photo of the product so we can look into it.',
  ]);
  const result = await draftReply(deps(), actor, id, { language: 'English' }, () => [{ name: 'fake', model }]);
  if (!result.ok) throw new Error(result.reason);
  expect(result.draft.text).toBe('We are sorry this happened. Please send us a photo of the product so we can look into it.');
  const [stored] = await db.sql`select reply, refusal from crms.ticket_drafts where id = ${result.draft.id}`;
  expect(stored).toMatchObject({ reply: result.draft.text, refusal: null });
});
it("refuses when dropping leaves only Order facts and no reply", async () => {
  const id = await ticket();
  const [o] = await db.sql`insert into orders (customer_id, status) values ('c1', 'dispatched') returning id`;
  await db.sql`update tickets set order_id = ${o.id} where id = ${id}`;
  const model = fake(['Your order was delivered today.', '{{status}}']);
  expect(await draftReply(deps(), actor, id, { language: 'English' }, () => [{ name: 'fake', model }]))
    .toMatchObject({ ok: false, reason: expect.stringContaining('could not be checked against the Order') });
});
it("makes Taglish drafts and asks the model again for a strictly shorter draft", async () => {
  const id = await ticket();
  const long = await draftReply(deps(), actor, id, { language: 'Taglish' }, () => [{ name: 'fake', model: fake(['Hello po!', 'Naiintindihan ko po ang concern ninyo.', 'Salamat po sa inyong pasensya.']) }]);
  expect(long.ok).toBe(true);
  if (!long.ok) throw new Error(long.reason);
  const model = fake(['Hello po!', 'Salamat po sa inyong pasensya.']);
  const short = await draftReply(deps(), actor, id, { language: 'Taglish', shorterThanId: long.draft.id }, () => [{ name: 'fake', model }]);
  expect(short.ok).toBe(true);
  if (!short.ok) throw new Error(short.reason);
  expect(short.draft.text.length).toBeLessThan(long.draft.text.length);
  expect(short.draft.sentText).toContain('"makeShorter":true');
  expect(model.doGenerateCalls).toHaveLength(1);
  const unchanged = await draftReply(deps(), actor, id, { language: 'Taglish', shorterThanId: short.draft.id }, () => [{ name: 'fake', model }]);
  expect(unchanged).toMatchObject({ ok: false, reason: expect.stringContaining('not shorter') });
});
it("keeps the Ticket usable for manual replies after no keys or a provider failure", async () => {
  const id = await ticket();
  const { replyToTicket } = await import('@/features/tickets/ticket-actions');
  const failed = new MockLanguageModelV4({ doGenerate: async () => { throw new Error('offline'); } });
  for (const models of [() => [], () => [{ name: 'bad', model: failed }]]) {
    expect(await draftReply(deps(), actor, id, { language: 'English' }, models)).toMatchObject({ ok: false, reason: expect.stringContaining('by hand') });
  }
  expect(await replyToTicket(db.sql, id, actor, 'I can help you with this.')).toMatchObject({ ok: true });
});
it('inserts the current courier link and rebooking time locally, without sending the link or rider details', async () => {
  const id = await ticket();
  const [order] = await db.sql`insert into orders (customer_id, status, subtotal_in_centavos, dispatched_at)
    values ('c1', 'dispatched', 0, '2026-11-13T01:00:00Z') returning id`;
  await db.sql`update tickets set order_id = ${order.id} where id = ${id}`;
  await db.sql`insert into failed_deliveries (id, order_id, reason, next_step, customer_message, staff_id, staff_name, rebooked_at, courier)
    values ('attempt1', ${order.id}, 'Failed', 'rebook', 'Sorry', 'staff', 'Liza Cruz', '2026-11-14T05:40:00Z',
      '{"name":"Grab","trackingUrl":"https://grab.com/track/real-booking","riderPhone":"09171234567","riderName":"Private Rider"}')`;
  const model = fake(['Hello!', '{{status}}', '{{courier}}', '{{booked_at}}', '{{tracking_link}}']);
  const result = await draftReply(deps(), actor, id, { language: 'English' }, () => [{ name: 'fake', model }]);
  if (!result.ok) throw new Error(result.reason);
  expect(result.draft.text).toContain('Courier: Grab.');
  expect(result.draft.text).toContain('Courier booked: 2026-11-14T05:40:00.000Z.');
  expect(result.draft.text).toContain('https://grab.com/track/real-booking');
  expect(result.draft.sentText).not.toMatch(/https:|real-booking|0917|Private Rider/);
  expect(result.draft.sentText).toContain('2026-11-14T05:40:00.000Z');
});
it('drops a draft when the Linked order or Claim changes during generation', async () => {
  const id = await ticket();
  const [o] = await db.sql`insert into orders (customer_id, status) values ('c1', 'dispatched') returning id`;
  await db.sql`update tickets set order_id = ${o.id} where id = ${id}`;
  const model = fake(['{{status}}']);
  const generate = model.doGenerate;
  model.doGenerate = async options => {
    await db.sql`update orders set status = 'cancelled' where id = ${o.id}`;
    return generate(options);
  };
  expect(await draftReply(deps(), actor, id, { language: 'English' }, () => [{ name: 'fake', model }]))
    .toMatchObject({ ok: false, reason: expect.stringContaining('Linked order changed') });
  model.doGenerate = async options => {
    await db.sql`update tickets set claimed_by_id = 'other' where id = ${id}`;
    return generate(options);
  };
  expect(await draftReply(deps(), actor, id, { language: 'English' }, () => [{ name: 'fake', model }]))
    .toMatchObject({ ok: false, reason: expect.stringContaining('no longer Open and held by you') });
  expect((await db.sql`select reply from crms.ticket_drafts`).every(r => r.reply === null)).toBe(true);
});
it('cannot shorten a draft belonging to someone else or another Ticket', async () => {
  const id = await ticket();
  const result = await draftReply(deps(), actor, id, { language: 'English' }, () => [{ name: 'fake', model: fake(['Hello!']) }]);
  if (!result.ok) throw new Error(result.reason);
  const another = await ticket();
  const never = () => { throw new Error('must not configure'); };
  expect((await draftReply(deps(), actor, another, { language: 'English', shorterThanId: result.draft.id }, never)).ok).toBe(false);
  await db.sql`update crms.ticket_drafts set requested_by_id = 'other' where id = ${result.draft.id}`;
  expect((await draftReply(deps(), actor, id, { language: 'English', shorterThanId: result.draft.id }, never)).ok).toBe(false);
});
it('masks alternate addresses and unusual phone separators even on an unlinked Ticket', async () => {
  const id = await ticket();
  await db.sql`insert into ticket_messages (ticket_id, sender, body) values
    (${id}, 'customer', 'Please deliver to 45 New Road, Quezon City'),
    (${id}, 'customer', 'Call 0917/123/4567 or 0917‑123‑4567 please.'),
    (${id}, 'customer', 'Where is my order?')`;
  const result = await draftReply(deps(), actor, id, { language: 'English' }, () => [{ name: 'fake', model: fake(['Hello!']) }]);
  if (!result.ok) throw new Error(result.reason);
  expect(result.draft.sentText).not.toMatch(/45 New|Quezon|0917|123\/4567/);
  expect(result.draft.sentText).toContain('Where is my order?');
});
it('allows contextual English and Taglish prose while rejecting raw factual claims', async () => {
  const id = await ticket();
  for (const [language, prose] of [
    ['English', 'Thank you for sharing the photo of the leaking pouch. Please keep the packaging while I look into your concern.'],
    ['Taglish', 'Salamat po sa photo ng tumatagas na pouch. Paki-keep po ang packaging habang tinitingnan ko ang concern ninyo.'],
  ] as const) {
    const made = await draftReply(deps(), actor, id, { language }, () => [{ name: 'fake', model: fake([prose]) }]);
    expect(made).toMatchObject({ ok: true, draft: { text: prose } });
  }
  for (const prose of ['Your parcel is on the way.', 'Darating bukas ang parcel.', 'Na-deliver na po.', 'Your payment is paid.', 'Your courier is Lalamove.', 'The booking was yesterday.', 'Visit fake.example.com', 'Here is your address: 45 New Road.']) {
    expect(await draftReply(deps(), actor, id, { language: 'English' }, () => [{ name: 'fake', model: fake([prose]) }]))
      .toMatchObject({ ok: false, reason: expect.stringContaining('could not be checked') });
  }
});
