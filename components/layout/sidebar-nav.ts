import {
  Users,
  Building2,
  ShoppingCart,
  CreditCard,
  Truck,
  LayoutGrid,
  LayoutDashboard,
  Mail,
  MessageCircle,
  RotateCcw,
  Star,
  Ticket,
  Users2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  /** The label above its section of the sidebar, as in the Figma. */
  group: string;
  name: string;
  /** Null for an entry whose page does not exist yet: shown dimmed, not clickable. */
  href: string | null;
  icon: LucideIcon;
}

export interface SystemItem {
  fullName: string;
  desc: string;
  icon: LucideIcon;
  active: boolean;
  url?: string;
  /** The Enterprise Portal, which shows the returning card while it opens. */
  portal?: boolean;
}

export type SystemChild = SystemItem;

export const customerProfilesItem: NavItem = {
  group: "CUSTOMERS",
  name: "Customer Profiles",
  href: "/customer-profiles",
  icon: Users,
};

export const ticketsItem: NavItem = {
  group: "SERVICE",
  name: "Tickets",
  href: "/tickets",
  icon: Ticket,
};

export const conversationsItem: NavItem = {
  group: "SERVICE",
  name: "Conversations",
  href: "/conversations",
  icon: MessageCircle,
};

export const feedbackItem: NavItem = {
  group: "SERVICE",
  name: "Feedback",
  href: "/feedback",
  icon: Star,
};

export const emailCampaignsItem: NavItem = {
  group: "MARKETING",
  name: "Email campaigns",
  href: "/email-campaigns",
  icon: Mail,
};

/** An entry from the Figma sidebar whose page is still to come. */
function comingSoon(group: string, name: string, icon: LucideIcon): NavItem {
  return { group, name, href: null, icon };
}

/** The Figma sidebar, top to bottom. Entries with no page yet are dimmed and do nothing. */
export const sidebarItems: NavItem[] = [
  comingSoon("", "Dashboard", LayoutDashboard),
  customerProfilesItem,
  comingSoon("SALES", "Orders", ShoppingCart),
  comingSoon("SALES", "Payments", CreditCard),
  comingSoon("SALES", "Fulfilment", Truck),
  comingSoon("SALES", "Returns", RotateCcw),
  ticketsItem,
  conversationsItem,
  feedbackItem,
  emailCampaignsItem,
];

export const systems: SystemItem[] = [
  {
    fullName: "Enterprise Portal",
    desc: "All systems hub & app launcher",
    icon: LayoutGrid,
    active: false,
    portal: true,
    url: process.env.NEXT_PUBLIC_HOST_URL ?? "https://localhost:3000/",
  },
  {
    fullName: "Customer Relationship Management",
    desc: "Contact profiles, tickets & marketing",
    icon: Building2,
    active: true,
    url: process.env.NEXT_PUBLIC_CRMS_URL ?? "https://localhost:3005/",
  },
  {
    fullName: "Human Resource Management",
    desc: "Staff directory & payroll",
    icon: Users2,
    active: false,
    url: process.env.NEXT_PUBLIC_HRMS_URL ?? "https://localhost:3001/",
  },
  {
    fullName: "E-Commerce Storefront",
    desc: "Online orders & products",
    icon: ShoppingCart,
    active: false,
    url: process.env.NEXT_PUBLIC_OOS_URL ?? "https://localhost:3004/",
  },
  {
    fullName: "Point of Sale",
    desc: "Retail & register checkout",
    icon: CreditCard,
    active: false,
    url: process.env.NEXT_PUBLIC_POS_URL ?? "https://localhost:3002/",
  },
  {
    fullName: "Supply Chain Management",
    desc: "Inventory & logistics",
    icon: Truck,
    active: false,
    url: process.env.NEXT_PUBLIC_SCMS_URL ?? "https://localhost:3003/",
  },
];
