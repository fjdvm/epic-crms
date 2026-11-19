import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.CREOMS_WRITER_DATABASE_URL;
if (!url) throw new Error("CREOMS_WRITER_DATABASE_URL is required.");
const connection = new URL(url);
if (connection.hostname.endsWith(".neon.tech")) connection.hostname = connection.hostname.replace(/-pooler(?=\.)/, "");
if (connection.hostname.includes("-pooler")) throw new Error("Use a direct connection for migrations.");
const sql = postgres(connection.toString(), { max: 1 });
try {
  await sql.unsafe(readFileSync(new URL("../../docs/db/crms-senior-pwd-discount.sql", import.meta.url), "utf8"));
  const [row] = await sql`select count(*)::int as n from crms.senior_pwd_discount_settings`;
  if (row.n !== 1) throw new Error("Senior/PWD discount migration did not install the settings row.");
  console.log("Senior/PWD discount migration applied and verified.");
} finally {
  await sql.end();
}
