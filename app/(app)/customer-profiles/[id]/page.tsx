import { notFound } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CustomerProfileView } from "@/features/customer-profiles/customer-profile";
import { loadCustomerProfile } from "@/features/customer-profiles/profile";
import { database } from "@/lib/db";
import { CUSTOMER_PROFILES_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

export default async function CustomerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule(CUSTOMER_PROFILES_MODULE);

  const { id } = await params;
  const result = await loadCustomerProfile(database, id);

  if (!result.ok) {
    return (
      <div className="p-md sm:p-lg">
        <Alert variant="destructive">
          <AlertTitle>This profile is temporarily unavailable</AlertTitle>
          <AlertDescription>
            CREOMS could not read the store&apos;s customer data. Reload to try again; if it keeps
            happening, tell whoever maintains CREOMS.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!result.profile) notFound();

  return (
    <div className="px-xl py-7">
      <CustomerProfileView profile={result.profile} />
    </div>
  );
}
