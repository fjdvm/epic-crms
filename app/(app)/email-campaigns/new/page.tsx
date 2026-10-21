import { subscriberCount } from "@/features/marketing/announcements";
import { CampaignForm } from "@/features/marketing/campaign-form";
import { database } from "@/lib/db";
import { MARKETING_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

export default async function NewCampaignPage() {
  await requireModule(MARKETING_MODULE);

  const counts = await subscriberCount(database()).catch(() => null);

  return <CampaignForm subscribers={counts?.subscribers ?? null} />;
}
