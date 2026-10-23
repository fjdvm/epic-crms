import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create role creoms_readonly nosuperuser nocreatedb nocreaterole noinherit`;
}, 60_000);
afterAll(async () => { await db.close(); });

it("applies the Returns grant repeatedly and allows SELECT without allowing Return writes", async () => {
  const migration = readFileSync(new URL("../docs/db/creoms-returns-readonly.sql", import.meta.url), "utf8");
  await db.sql`grant insert, update, delete, truncate on order_returns, order_return_items,
    order_return_images, order_return_history to creoms_readonly`;
  await db.sql.unsafe(migration);
  await db.sql.unsafe(migration);
  for (const table of ["order_returns", "order_return_items", "order_return_images", "order_return_history"]) {
    const [privileges] = await db.sql`select
      has_table_privilege('creoms_readonly', ${table}, 'INSERT') as insert,
      has_table_privilege('creoms_readonly', ${table}, 'UPDATE') as update,
      has_table_privilege('creoms_readonly', ${table}, 'DELETE') as delete,
      has_table_privilege('creoms_readonly', ${table}, 'TRUNCATE') as truncate`;
    expect(privileges).toEqual({ insert: false, update: false, delete: false, truncate: false });
    await db.sql.begin(async tx => {
      await tx`set local role creoms_readonly`;
      expect(await tx`select * from ${tx(table)}`).toHaveLength(0);
    });
    await expect(db.sql.begin(async tx => {
      await tx`set local role creoms_readonly`;
      await tx`delete from ${tx(table)}`;
    })).rejects.toMatchObject({ code: "42501" });
  }
});
