import { CampaignForm } from "@/features/marketing/campaign-form";
import { MARKETING_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

export default async function NewCampaignPage() {
  await requireModule(MARKETING_MODULE);

  return <CampaignForm />;
}
