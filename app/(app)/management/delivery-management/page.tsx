import { crmsDatabase } from "@/lib/crms-db";
import { FreeDeliveryForm } from "@/features/management/free-delivery-form";
import { loadFreeDeliveryThreshold } from "@/features/management/free-delivery-threshold";
import { ManagementFrame } from "@/features/management/tabs";
import { requireManagement } from "@/lib/portal/staff";

// The server refuses anyone but a Manager or the CEO holding the Management Module; hiding the link is not the gate.
export default async function DeliveryManagementPage() {
  await requireManagement();
  const threshold = await loadFreeDeliveryThreshold(crmsDatabase()).catch(() => null);

  return (
    <ManagementFrame active="/management/delivery-management">
      <FreeDeliveryForm currentInCentavos={threshold} />
    </ManagementFrame>
  );
}
