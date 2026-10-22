import type { CustomerChoice, OrderChoice } from "./new-ticket";

async function choices<T>(params: URLSearchParams, signal?: AbortSignal): Promise<T[]> {
  const response = await fetch(`/api/tickets/choices?${params}`, { signal, cache: "no-store" });
  if (!response.ok || response.redirected || !response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Ticket choices unavailable");
  }
  return response.json();
}

export const findCustomers = (term: string, signal?: AbortSignal) =>
  choices<CustomerChoice>(new URLSearchParams({ q: term }), signal);

export const findCustomerOrders = (customerId: string, signal?: AbortSignal) =>
  choices<OrderChoice>(new URLSearchParams({ customerId }), signal);
