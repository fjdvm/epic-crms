import postgres from "postgres";

let client: postgres.Sql | undefined;

/** Reads Tickets, Messages, Customers and Orders as the read-only role. */
export function ticketsDatabase(): postgres.Sql {
  const url = process.env.CREOMS_DATABASE_URL;

  if (!url) {
    throw new Error("CREOMS_DATABASE_URL is not set; see .env.example");
  }

  client ??= postgres(url, { max: 3, idle_timeout: 20 });

  return client;
}

let writer: postgres.Sql | undefined;

/**
 * Connection for changing Tickets and adding Messages, as the `creoms_tickets` role (see the
 * ecommerce repo's docs/sql/creoms-tickets-role.sql). That role can read and update Tickets and
 * read and add Messages, and nothing else.
 */
export function ticketsWriterDatabase(): postgres.Sql {
  const url = process.env.CREOMS_TICKETS_DATABASE_URL;

  if (!url) {
    throw new Error("CREOMS_TICKETS_DATABASE_URL is not set; see .env.example");
  }

  writer ??= postgres(url, { max: 3, idle_timeout: 20 });

  return writer;
}
