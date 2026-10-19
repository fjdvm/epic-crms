import postgres from "postgres";

let client: postgres.Sql | undefined;

/**
 * Connection for CREOMS's own `crms` schema, as the `creoms_writer` role (see
 * docs/db/crms-schema.sql). That role can write only to `crms`, never to storefront or
 * neon_auth tables.
 */
export function crmsDatabase(): postgres.Sql {
  const url = process.env.CREOMS_WRITER_DATABASE_URL;

  if (!url) {
    throw new Error("CREOMS_WRITER_DATABASE_URL is not set; see .env.example");
  }

  client ??= postgres(url, { max: 3, idle_timeout: 20 });

  return client;
}
