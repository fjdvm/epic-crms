import postgres from "postgres";

let client: postgres.Sql | undefined;

/**
 * Connection to the shared ecommerce database. CREOMS only ever connects with the
 * read-only `creoms_readonly` role (see docs/db/creoms-readonly-role.sql); the role
 * itself has SELECT only, so no code path here can write to public or neon_auth.
 */
export function database(): postgres.Sql {
  const url = process.env.CREOMS_DATABASE_URL;

  if (!url) {
    throw new Error("CREOMS_DATABASE_URL is not set; see .env.example");
  }

  client ??= postgres(url, { max: 5, idle_timeout: 20 });

  return client;
}
