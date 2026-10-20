import postgres from "postgres";

let client: postgres.Sql | undefined;

/**
 * Connection for Tickets and Messages in the shared ecommerce database, as the `creoms_tickets`
 * role (see the ecommerce repo's docs/sql/creoms-tickets-role.sql). That role can read and update
 * Tickets and read and add Messages, and nothing else.
 */
export function ticketsDatabase(): postgres.Sql {
  // Until the Ticket write slices ship the pages only read, so the read-only URL is enough. Drop
  // this fallback once Claim, reply and Mark resolved need the `creoms_tickets` role.
  const url = process.env.CREOMS_TICKETS_DATABASE_URL || process.env.CREOMS_DATABASE_URL;

  if (!url) {
    throw new Error("CREOMS_TICKETS_DATABASE_URL is not set; see .env.example");
  }

  client ??= postgres(url, { max: 3, idle_timeout: 20 });

  return client;
}
