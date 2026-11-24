import { describe, expect, it } from "vitest";

import type { AreaFigures } from "@/features/ai-insights/areas";
import type { CustomerInsights } from "@/features/ai-insights/customers";
import type { OperationsInsights } from "@/features/ai-insights/operations";
import type { OrderInsights } from "@/features/ai-insights/orders";
import type { PaymentInsights } from "@/features/ai-insights/payments";
import { buildSuggestions, worsened } from "@/features/ai-insights/suggestions";

const area = (key: string, name: string, f: Partial<AreaFigures>): AreaFigures =>
  ({ key, name, orders: 0, sales: 0, cod: 0, failed: 0, returned: 0, previousOrders: 0, cities: [], ...f });

const payments = (f: Partial<PaymentInsights> = {}): PaymentInsights => ({
  methods: [], verify: { orders: 0, medianHours: null, slowestHours: null, weekdayMedianHours: null, weekendMedianHours: null },
  proofs: { submitted: 0, rejected: 0, reusedReference: 0 },
  unpaid: [{ key: "under-1-day", orders: 0, value: 0 }, { key: "1-to-3-days", orders: 0, value: 0 }, { key: "over-3-days", orders: 0, value: 0 }],
  refunds: { count: 0, amount: 0, reasons: [] }, nearFreeDelivery: { orders: 0, eligible: 0 }, ...f,
});
const customers = (loyalAtRisk: number) => ({ loyalAtRisk } as CustomerInsights);
const orders = (pairs: OrderInsights["pairs"]) => ({ pairs } as OrderInsights);
const operations = (f: { products?: OperationsInsights["returns"]["products"]; lowest?: OperationsInsights["feedback"]["lowestProducts"]; couriers?: OperationsInsights["fulfilment"]["couriers"] }) => ({
  fulfilment: { dispatched: 0, medianDispatchHours: null, couriers: f.couriers ?? [] },
  returns: { requested: 0, reasons: [], products: f.products ?? [], restockedValue: 0, writtenOffValue: 0 },
  tickets: { opened: 0, resolved: 0, medianResolveHours: null, categories: [], averageRating: null },
  feedback: { ratings: 0, average: null, negativeShare: null, lowestProducts: f.lowest ?? [] },
} as OperationsInsights);

const keys = (inputs: Parameters<typeof buildSuggestions>[0]) => buildSuggestions(inputs).map((s) => s.key);

describe("suggestion rules", () => {
  it("flags an area with many failed deliveries and an area whose Orders rose, but not small ones", () => {
    const s = buildSuggestions({ areas: { unmapped: { orders: 0, sales: 0 }, areas: [
      area("cavite", "Cavite", { orders: 10, failed: 2, previousOrders: 5 }),
      area("cebu", "Cebu", { orders: 4, failed: 4, previousOrders: 1 }),
    ] } });
    expect(s.map((x) => x.key)).toEqual(["area-failed:cavite", "area-rising:cavite"]);
    expect(s[0]).toMatchObject({ module: "Fulfilment", numbers: { orders: 10, failedPercent: 20 }, action: { href: "/fulfilment" } });
    expect(s[0].text).toBe("20% of the 10 Orders to Cavite had a failed delivery. Check the addresses and the courier used there.");
    expect(s[1].text).toBe("Orders to Cavite rose 100%, from 5 to 10. Make sure deliveries there can keep up.");
  });

  it("suggests a win-back offer once 3 loyal Customers have gone quiet", () => {
    expect(keys({ customers: customers(2) })).toEqual([]);
    const [s] = buildSuggestions({ customers: customers(3) });
    expect(s).toMatchObject({ key: "loyal-at-risk", module: "Customer Profiles", action: { href: "/customer-profiles?stage=at-risk" } });
  });

  it("prefers the weekend message when weekend proofs wait twice as long", () => {
    const verify = { orders: 8, medianHours: 7, slowestHours: 30, weekdayMedianHours: 2, weekendMedianHours: 9 };
    expect(keys({ payments: payments({ verify }) })).toEqual(["slow-proofs-weekend"]);
    expect(keys({ payments: payments({ verify: { ...verify, weekendMedianHours: 3 } }) })).toEqual(["slow-proofs"]);
    expect(keys({ payments: payments({ verify: { ...verify, orders: 4 } }) })).toEqual([]);
  });

  it("raises old unpaid Orders and Orders just under free delivery, the latter for Managers only", () => {
    const s = buildSuggestions({ payments: payments({
      unpaid: [{ key: "under-1-day", orders: 9, value: 1 }, { key: "1-to-3-days", orders: 0, value: 0 }, { key: "over-3-days", orders: 3, value: 450000 }],
      nearFreeDelivery: { orders: 4, eligible: 10 },
    }) });
    expect(s.map((x) => x.key)).toEqual(["unpaid-over-3-days", "near-free-delivery"]);
    expect(s[0].text).toContain("3 Orders worth ₱4,500 have waited over 3 days");
    expect(s[1].action).toEqual({ label: "Open Commerce Settings", href: "/management/commerce-settings", managerOnly: true });
  });

  it("suggests a bundle, stock, returns, rating and courier checks from their figures", () => {
    const s = keys({
      orders: orders([{ a: "Ube Halaya", b: "Ube Jam", orders: 6, ordersOfLessPopular: 12 }]),
      stock: [{ name: "Ube Jam (250g)", available: 4, soldPerDay: 2, daysLeft: 2 }],
      operations: operations({
        products: [{ product: "Ube Jam", sold: 20, returned: 3 }, { product: "Halaya", sold: 100, returned: 3 }],
        lowest: [{ product: "Ube Polvoron", ratings: 4, average: 3.2 }, { product: "Halaya", ratings: 5, average: 4.1 }],
        couriers: [{ courier: "Lalamove", dispatched: 10, failed: 2 }, { courier: "Grab", dispatched: 4, failed: 4 }],
      }),
    });
    expect(s.sort()).toEqual(["bundle:ube-halaya:ube-jam", "courier:lalamove", "low-rating:ube-polvoron", "returns:ube-jam", "stock:ube-jam-250g"]);
  });

  it("puts the most urgent first", () => {
    const s = keys({ customers: customers(3), stock: [{ name: "Jam", available: 1, soldPerDay: 1, daysLeft: 1 }] });
    expect(s).toEqual(["stock:jam", "loyal-at-risk"]);
  });

  it("brings a suggestion back only when a number gets larger", () => {
    expect(worsened({ a: 3, b: 1 }, { a: 3, b: 2 })).toBe(false);
    expect(worsened({ a: 4 }, { a: 3 })).toBe(true);
  });
});
