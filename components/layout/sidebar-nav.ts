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
  ClipboardCheck,
  ListChecks,
  Landmark,
  IdCard,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SENIOR_PWD_PAGE } from "@/lib/portal/pages";

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
  group: "OVERVIEW",
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

/** Its own Portal Module (Senior/PWD): Staff holding Customer Profiles do not see it unless they hold this too. */
export const seniorPwdItem: NavItem = {
  group: "CUSTOMERS",
  name: "Senior/PWD checks",
  href: SENIOR_PWD_PAGE,
  icon: IdCard,
};

export const myTasksItem: NavItem = {
  group: "OVERVIEW",
  name: "My Tasks",
  href: "/my-tasks",
  icon: ListChecks,
};

export const ordersItem: NavItem = {
  group: "COMMERCE",
  name: "Orders",
  href: "/orders",
  icon: ShoppingCart,
};

/** No page yet: shown dimmed and not clickable until Products & Stocks is built. */
export const productsStocksItem: NavItem = {
  group: "COMMERCE",
  name: "Products & Stocks",
  href: null,
  icon: Package,
};

export const paymentsItem: NavItem = {
  group: "COMMERCE",
  name: "Payments",
  href: "/payments",
  icon: CreditCard,
};

export const fulfilmentItem: NavItem = {
  group: "COMMERCE",
  name: "Fulfilment",
  href: "/fulfilment",
  icon: Truck,
};

export const returnsItem: NavItem = {
  group: "COMMERCE",
  name: "Returns",
  href: "/returns",
  icon: RotateCcw,
};

export const approvalsItem: NavItem = {
  group: "MANAGEMENT",
  name: "Approvals",
  href: "/approvals",
  icon: ClipboardCheck,
};

export const ticketsItem: NavItem = {
  group: "CUSTOMER SUPPORT",
  name: "Tickets",
  href: "/tickets",
  icon: Ticket,
};

export const conversationsItem: NavItem = {
  group: "CUSTOMER SUPPORT",
  name: "Conversations",
  href: "/conversations",
  icon: MessageCircle,
};

export const feedbackItem: NavItem = {
  group: "CUSTOMER SUPPORT",
  name: "Feedback",
  href: "/feedback",
  icon: Star,
};

export const commerceSettingsItem: NavItem = {
  group: "MANAGEMENT",
  name: "Commerce Settings",
  href: "/management/commerce-settings",
  icon: Landmark,
};

/** The Figma sidebar, top to bottom. */
export const sidebarItems: NavItem[] = [
  dashboardItem,
  myTasksItem,
  customerProfilesItem,
  seniorPwdItem,
  ordersItem,
  productsStocksItem,
  paymentsItem,
  fulfilmentItem,
  returnsItem,
  ticketsItem,
  conversationsItem,
  feedbackItem,
  approvalsItem,
  commerceSettingsItem,
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
    desc: "Contact profiles, tickets & feedback",
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
