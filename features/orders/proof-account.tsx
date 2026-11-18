import type { PaymentMethod } from "./payment-methods";

/** The account the Customer said they paid, saved with the proof so a later edit by the shop never changes it. */
export interface ProofAccount {
  method: string;
  label: string | null;
  bankName: string | null;
  name: string | null;
  number: string | null;
}

export interface ProofAccountRow {
  account_id: string | null; account_method: string | null; account_bank_name: string | null;
  account_label: string | null; account_name: string | null; account_number: string | null;
}

/** Null for a proof sent before Customers picked an account. */
export function proofAccount(row: ProofAccountRow): ProofAccount | null {
  if (!row.account_id && !row.account_number && !row.account_name) return null;
  return { method: row.account_method ?? "", label: row.account_label, bankName: row.account_bank_name, name: row.account_name, number: row.account_number };
}

export type ProofOutcome = "Pending" | "Verified" | "Rejected";

/** Pending until Staff decide; Verified once the Order moved past awaiting payment and the proof was not rejected. */
export function proofOutcome(proof: { rejected: boolean }, orderStatus: string): ProofOutcome {
  if (proof.rejected) return "Rejected";
  return orderStatus === "awaiting payment" || orderStatus === "cancelled" ? "Pending" : "Verified";
}

const BADGE: Record<ProofOutcome, string> = {
  Pending: "bg-[#fdf1d8] text-[#8a5a00]",
  Verified: "bg-[#dcfce7] text-[#15803d]",
  Rejected: "bg-[#fee2e2] text-[#b91c1c]",
};

export function ProofBadge({ outcome }: { outcome: ProofOutcome }) {
  return <span data-proof-badge={outcome} className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[outcome]}`}>{outcome}</span>;
}

const METHOD: Record<string, string> = { gcash: "GCash", maya: "Maya", "bank-transfer": "Bank transfer" };

/** "Paid to": the saved account beside the Order's payment details. */
export function ProofAccountView({ account, method }: { account: ProofAccount | null; method: PaymentMethod | string }) {
  const rows: [string, string | null][] = account
    ? [
        ["Method", METHOD[account.method] ?? METHOD[method] ?? account.method],
        ["Account", account.label],
        ["Bank", account.bankName],
        ["Account name", account.name],
        ["Account number", account.number],
      ]
    : [];
  return (
    <section aria-label="Account paid" className="space-y-2 rounded-lg border border-[#e4e4e7] px-4 py-3 text-sm">
      <h3 className="font-semibold">Account the Customer paid</h3>
      {account ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          {rows.filter(([, value]) => value).map(([label, value]) => (
            <div key={label} className="contents"><dt className="text-[#71717a]">{label}</dt><dd className="font-medium">{value}</dd></div>
          ))}
        </dl>
      ) : (
        <p className="text-[13px] text-[#71717a]">The Customer did not pick an account with this proof.</p>
      )}
    </section>
  );
}
