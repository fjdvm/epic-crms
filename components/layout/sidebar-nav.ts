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
  Package,
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

export const dashboardItem: NavItem = {
  group: "",
  name: "Dashboard",
  href: "/dashboard",
  icon: LayoutDashboard,
};

export const customerProfilesItem: NavItem = {
  group: "CUSTOMERS",
  name: "Customer Profiles",
  href: "/customer-profiles",
  icon: Users,
};

export const ordersItem: NavItem = {
  group: "SALES",
  name: "Orders",
  href: "/orders",
  icon: ShoppingCart,
};

export const paymentsItem: NavItem = {
  group: "SALES",
  name: "Payments",
  href: "/payments",
  icon: CreditCard,
};

export const fulfilmentItem: NavItem = {
  group: "SALES",
  name: "Fulfilment",
  href: "/fulfilment",
  icon: Truck,
};

export const returnsItem: NavItem = {
  group: "SALES",
  name: "Returns",
  href: "/returns",
  icon: RotateCcw,
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
  name: "Email Campaigns",
  href: "/email-campaigns",
  icon: Mail,
};

/** The Figma sidebar, top to bottom. */
export const sidebarItems: NavItem[] = [
  dashboardItem,
  customerProfilesItem,
  ordersItem,
  paymentsItem,
  fulfilmentItem,
  returnsItem,
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
    url: process.env.NEXT_PUBLIC_HOST_URL ?? "https://portal.buildwrite.me/",
  },
  {
    fullName: "Customer Relationship Management",
    desc: "Contact profiles, tickets & marketing",
    icon: Building2,
    active: true,
    url: process.env.NEXT_PUBLIC_CRMS_URL ?? "https://creoms.buildwrite.me/",
  },
  {
    fullName: "Human Resource Management",
    desc: "Staff directory & payroll",
    icon: Users2,
    active: false,
    url: process.env.NEXT_PUBLIC_HRMS_URL ?? "https://hrms.buildwrite.me/",
  },
  {
    fullName: "Point of Sale",
    desc: "Retail & register checkout",
    icon: CreditCard,
    active: false,
    url: process.env.NEXT_PUBLIC_POS_URL ?? "https://web-pos-alpha-vert.vercel.app/",
  },
  {
    fullName: "Inventory Management System",
    desc: "Inventory & stock management",
    icon: Package,
    active: false,
    url: process.env.NEXT_PUBLIC_IMS_URL ?? "https://br-sims.vercel.app/",
  },
];
