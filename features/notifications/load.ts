import type postgres from "postgres";

import { listNotifications, type NotificationFeed } from "./notifications";

/** The bell's feed; a missing or unreachable database becomes `null` so the header still renders. */
export async function loadNotifications(connect: () => postgres.Sql): Promise<NotificationFeed | null> {
  try {
    return await listNotifications(connect());
  } catch (error) {
    console.error("Notifications could not be read", error);

    return null;
  }
}
