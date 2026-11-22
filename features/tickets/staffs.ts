import type postgres from "postgres";

import { portalGateway } from "@/features/notifications/portal-gateway";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { isAssignable, shopRole } from "@/lib/portal/roles";

import { claimerWorkload } from "./reassign";

/** Someone a Ticket can be assigned to: Staff / Employee, CREOMS Manager or General Manager with the Tickets module. */
export interface AssignableStaff {
  /** The Portal username, which is what a Ticket stores as its Claimer. */
  id: string;
  name: string;
  role: "staff" | "manager";
  /** Open Tickets they hold now. */
  open: number;
}

/** The people on the Staffs tab and in the drawer's Assign picker. Admin, CEO, VP and unknown Roles never appear. */
export async function loadAssignableStaff(connect: () => postgres.Sql): Promise<AssignableStaff[]> {
  try {
    const [people, load] = await Promise.all([portalGateway().recipients(), claimerWorkload(connect())]);

    return people
      .flatMap((p) => {
        const role = shopRole(p.role ?? "");
        if (!p.username || !p.name?.trim() || !p.modules.includes(TICKETS_MODULE) || !isAssignable(p.role ?? "") || (role !== "staff" && role !== "manager")) return [];

        return [{ id: p.username, name: p.name, role, open: load.get(p.username) ?? 0 }];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error("The assignable Staff could not be read", error);

    return [];
  }
}
