import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.CREOMS_WRITER_DATABASE_URL;
if (!url) throw new Error("CREOMS_WRITER_DATABASE_URL is required.");
const connection = new URL(url);
// Neon exposes the same branch directly by removing -pooler from its endpoint hostname.
if (connection.hostname.endsWith(".neon.tech")) connection.hostname = connection.hostname.replace(/-pooler(?=\.)/, "");
if (connection.hostname.includes("-pooler")) throw new Error("Use a direct connection for migrations.");
const sql = postgres(connection.toString(), { max: 1 });
try {
  await sql.begin(async tx => {
    await tx`set local role creoms_writer`;
    await tx.unsafe(readFileSync(new URL("../../docs/db/crms-pickup-instructions-drop.sql", import.meta.url), "utf8"));
  });
  const [row] = await sql`select to_regclass('crms.pickup_instructions') is null as gone`;
  if (!row.gone) throw new Error("Pickup instructions table is still there.");
  console.log("Pickup instructions table drop applied and verified.");
} finally {
  await sql.end();
}
