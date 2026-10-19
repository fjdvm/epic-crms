import { AddCustomerForm } from "@/features/customer-profiles/add-customer-form";
import { BackButton } from "@/components/shared/back-button";
import { CUSTOMER_PROFILES_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

export default async function AddCustomerPage() {
  await requireModule(CUSTOMER_PROFILES_MODULE);

  return (
    <div className="space-y-5 px-xl py-7">
      <BackButton fallbackHref="/customer-profiles" label="Customer Profiles" />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-foreground">Add customer</h1>
        <p className="text-sm text-muted-foreground">
          For people who order by chat, phone or in person and have no storefront account.
        </p>
      </div>
      <div className="max-w-3xl">
        <AddCustomerForm />
      </div>
    </div>
  );
}
