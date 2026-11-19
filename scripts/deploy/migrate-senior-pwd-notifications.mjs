import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.CREOMS_WRITER_DATABASE_URL;
if (!url) throw new Error("CREOMS_WRITER_DATABASE_URL is required.");
const connection = new URL(url);
if (connection.hostname.endsWith(".neon.tech")) connection.hostname = connection.hostname.replace(/-pooler(?=\.)/, "");
if (connection.hostname.includes("-pooler")) throw new Error("Use a direct connection for migrations.");
const sql = postgres(connection.toString(), { max: 1 });
try {
  await sql.unsafe(readFileSync(new URL("../../docs/db/crms-senior-pwd-notifications.sql", import.meta.url), "utf8"));
  const [row] = await sql`select pg_get_constraintdef(oid) like '%senior-pwd-waiting%' as installed from pg_constraint where conname = 'notifications_kind_check' and conrelid = 'crms.notifications'::regclass`;
  if (!row.installed) throw new Error("Senior/PWD notifications migration did not install the notification kind.");
  console.log("Senior/PWD notifications migration applied and verified.");
} finally {
  await sql.end();
}
