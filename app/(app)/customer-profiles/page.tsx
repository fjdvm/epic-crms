import { CustomerListView } from "@/features/customer-profiles/customer-list";
import { loadCustomers, SORT_KEYS, STAGES, type SortKey } from "@/features/customer-profiles/customers";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

  const stage = STAGES.find((s) => s === first(raw.stage));

  const result = await loadCustomers(database, { search, stage, sort, direction, page });

  if (!result.ok) {
    return (
      <div className="p-md sm:p-lg space-y-md">
        <h1 className="text-headline-md text-foreground">Customer Profiles</h1>
        <Alert variant="destructive">
          <AlertTitle>Customers are temporarily unavailable</AlertTitle>
          <AlertDescription>
            CREOMS could not read the store&apos;s customer data. Reload to try again; if it keeps
            happening, tell whoever maintains CREOMS.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { list } = result;

  return (
    <div className="p-md sm:p-lg space-y-md">
      <div>
        <h1 className="text-headline-md text-foreground">
          Customer Profiles{" "}
          <span className="text-muted-foreground font-normal">({list.profileCount})</span>
        </h1>
      </div>
      <CustomerListView list={list} params={{ search, stage, sort, direction, page: list.page }} />
    </div>
  );
}
