import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.CREOMS_WRITER_DATABASE_URL;
if (!url) throw new Error("CREOMS_WRITER_DATABASE_URL is required.");
const connection = new URL(url);
if (connection.hostname.endsWith(".neon.tech")) connection.hostname = connection.hostname.replace(/-pooler(?=\.)/, "");
if (connection.hostname.includes("-pooler")) throw new Error("Use a direct connection for migrations.");
const sql = postgres(connection.toString(), { max: 1 });
try {
  await sql.unsafe(readFileSync(new URL("../../docs/db/crms-unusual-activity-explanations.sql", import.meta.url), "utf8"));
  const [row] = await sql`select to_regclass('crms.unusual_activity_explanations') is not null as installed`;
  if (!row.installed) throw new Error("Unusual activity explanations migration did not create the table.");
  console.log("Unusual activity explanations migration applied and verified.");
} finally {
  await sql.end();
}
