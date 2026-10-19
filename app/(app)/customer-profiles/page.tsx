import { CustomerListView } from "@/features/customer-profiles/customer-list";
import { listCustomers, SORT_KEYS, type SortKey } from "@/features/customer-profiles/customers";
import { database } from "@/lib/db";
import { CUSTOMER_PROFILES_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function CustomerProfilesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireModule(CUSTOMER_PROFILES_MODULE);

  const raw = await searchParams;
  const sort = SORT_KEYS.includes(first(raw.sort) as SortKey)
    ? (first(raw.sort) as SortKey)
    : "customerSince";
  const direction = first(raw.dir) === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number.parseInt(first(raw.page), 10) || 1);
  const search = first(raw.q).trim();

  const list = await listCustomers(database(), { search, sort, direction, page });

  return (
    <div className="p-md sm:p-lg space-y-md">
      <div>
        <h1 className="text-headline-md text-foreground">Customer Profiles</h1>
        <p className="text-body-sm text-muted-foreground mt-xs">
          {list.profileCount} {list.profileCount === 1 ? "profile" : "profiles"}
        </p>
      </div>
      <CustomerListView list={list} params={{ search, sort, direction, page: list.page }} />
    </div>
  );
}
