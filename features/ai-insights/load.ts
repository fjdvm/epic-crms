import type postgres from "postgres";

import { cachedAnalytics } from "@/features/dashboard/breakdowns";
import { resolvePeriod, type Period } from "@/features/dashboard/period";
import {
  CUSTOMER_PROFILES_MODULE, FEEDBACK_MODULE, FULFILMENT_MODULE, ORDERS_MODULE, PAYMENTS_MODULE, RETURNS_MODULE, TICKETS_MODULE,
} from "@/lib/portal/config";

import { areaInsightsIn } from "./areas";
import { customerInsightsIn } from "./customers";
import { operationsInsightsIn, stockCoverAt } from "./operations";
import { orderInsightsIn } from "./orders";
import { paymentInsightsIn } from "./payments";
import type { SuggestionInputs } from "./suggestions";

export const AI_INSIGHTS_MODULES = [
  ORDERS_MODULE, PAYMENTS_MODULE, CUSTOMER_PROFILES_MODULE, FULFILMENT_MODULE, RETURNS_MODULE, TICKETS_MODULE, FEEDBACK_MODULE,
];
export const OPERATIONS_MODULES = [FULFILMENT_MODULE, RETURNS_MODULE, TICKETS_MODULE, FEEDBACK_MODULE];

export const SUGGESTION_DAYS = 30;

/** Suggestions always look at the last 30 Philippine days, whatever period the page shows, so a dismissal means the same thing. */
export function suggestionPeriod(now: Date): Period {
  const end = resolvePeriod("today", now).end;
  const span = SUGGESTION_DAYS * 24 * 60 * 60 * 1000;
  const start = new Date(end.getTime() - span);
  return { start, end, previous: { start: new Date(start.getTime() - span), end: start } };
}

export interface Sources { source: postgres.Sql; crms: postgres.Sql }

const key = (name: string, period: Period) => `ai-insights:${name}:${period.start.toISOString()}:${period.end.toISOString()}`;
/** Undefined when the person does not hold the Module; null when it could not be read. */
const guarded = <T>(held: boolean, read: () => Promise<T>): Promise<T | null> | undefined =>
  held ? read().catch(() => null) : undefined;

/** Each section as its own promise, so the page streams them separately. All read through the five-minute analytics cache. */
export function loadSections({ source, crms }: Sources, modules: readonly string[], period: Period, now: Date) {
  const has = (...wanted: string[]) => wanted.some((m) => modules.includes(m));
  // Unpaid Orders age by the clock, so the Payments section is cached by the minute it was read in.
  const minute = Math.floor(now.getTime() / 60_000);
  return {
    areas: guarded(has(ORDERS_MODULE), () => cachedAnalytics(source, key("areas", period), () => areaInsightsIn(source, period))),
    orders: guarded(has(ORDERS_MODULE), () => cachedAnalytics(source, key("orders", period), () => orderInsightsIn(source, period))),
    payments: guarded(has(PAYMENTS_MODULE), () =>
      cachedAnalytics(source, `${key("payments", period)}:${minute}`, () => paymentInsightsIn(source, period, now))),
    customers: guarded(has(CUSTOMER_PROFILES_MODULE), () =>
      cachedAnalytics(source, key("customers", period), () => customerInsightsIn(source, period, now))),
    operations: guarded(has(...OPERATIONS_MODULES), () =>
      cachedAnalytics(source, key("operations", period), () => operationsInsightsIn(source, period))),
    stock: guarded(has(ORDERS_MODULE), () =>
      cachedAnalytics(source, `ai-insights:stock:${minute}`, () => stockCoverAt(source, crms, now))),
  };
}

export async function loadSuggestionInputs(sources: Sources, modules: readonly string[], now: Date): Promise<SuggestionInputs> {
  const sections = loadSections(sources, modules, suggestionPeriod(now), now);
  const [areas, orders, payments, customers, operations, stock] = await Promise.all([
    sections.areas, sections.orders, sections.payments, sections.customers, sections.operations, sections.stock,
  ]);
  return { areas, orders, payments, customers, operations, stock };
}
