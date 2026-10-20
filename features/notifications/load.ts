import type postgres from "postgres";

import { DEFAULT_SCHEMA, listNotifications, type NotificationFeed, type Viewer } from "./notifications";

/** The bell's feed; a missing or unreachable database becomes `null` so the header still renders. */
export async function loadNotifications(
  connect: () => postgres.Sql,
  viewer: Viewer,
): Promise<NotificationFeed | null> {
  try {
    return await listNotifications(connect(), DEFAULT_SCHEMA, undefined, viewer);
  } catch (error) {
    console.error("Notifications could not be read", error);

    return null;
  }
}

/** Who is looking at the bell, from the pages the Portal lets them open; null when it shows them nothing. */
export function viewerFor(staff: { username: string }, permittedPages: string[]): Viewer | null {
  const viewer = {
    customerProfiles: permittedPages.includes("/customer-profiles"),
    ticketsStaffId: permittedPages.includes("/tickets") ? staff.username : null,
  };

  return viewer.customerProfiles || viewer.ticketsStaffId !== null ? viewer : null;
}
