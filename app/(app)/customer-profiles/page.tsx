import { CUSTOMER_PROFILES_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

export default async function CustomerProfilesPage() {
  await requireModule(CUSTOMER_PROFILES_MODULE);

  return (
    <div className="p-md sm:p-lg">
      <h1 className="text-headline-md text-foreground">Customer Profiles</h1>
      <p className="text-body-sm text-muted-foreground mt-xs">
        Customers will appear here.
      </p>
    </div>
  );
}
