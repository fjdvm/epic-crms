import { Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
}

export const customerProfilesItem: NavItem = {
  name: "Customer Profiles",
  href: "/customer-profiles",
  icon: Users,
};

export const sidebarItems: NavItem[] = [customerProfilesItem];
