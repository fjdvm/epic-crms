import { ManagementFrame } from "@/features/management/tabs";
import { requireManagement } from "@/lib/portal/staff";

// The server refuses anyone but a Manager or the CEO holding the Management Module; hiding the link is not the gate.
export default async function PaymentManagementPage() {
  await requireManagement();

  return <ManagementFrame active="/management/payment-management" />;
}
