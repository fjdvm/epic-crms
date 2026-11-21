import { crmsDatabase } from "@/lib/crms-db";
import { maskNumber } from "@/features/management/payment-account-format";

import { isPrepaid } from "./payment-methods";
import type { PaymentAccountOption } from "./orders";

/** Order payment methods use dashes; the Payment accounts table uses underscores. */
const accountMethod = (method: string) => method.replace("-", "_");

/** Active Payment accounts that match how the Customer chose to pay. Empty for Cash on Delivery or when they cannot be read. */
export async function matchingPaymentAccounts(method: string): Promise<PaymentAccountOption[]> {
  if (!isPrepaid(method)) return [];
  try {
    const rows = await crmsDatabase()<{ id: string; label: string; account_name: string; account_number: string }[]>`
      select id, label, account_name, account_number from crms.payment_accounts
      where active and method = ${accountMethod(method)} order by created_at, id`;
    return rows.map((r) => ({ id: r.id, label: r.label, accountName: r.account_name, maskedNumber: maskNumber(r.account_number) }));
  } catch {
    return [];
  }
}

/** Whether this account is active and matches the Order's method. */
export async function accountFitsMethod(accountId: string, method: string): Promise<boolean> {
  return (await matchingPaymentAccounts(method)).some((a) => a.id === accountId);
}
