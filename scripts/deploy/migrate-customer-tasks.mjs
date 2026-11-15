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
    await tx.unsafe(readFileSync(new URL("../../docs/db/crms-customer-tasks.sql", import.meta.url), "utf8"));
  });
  console.log("Customer Tasks migration applied.");
} finally {
  await sql.end();
}
