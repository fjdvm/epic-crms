import { notFound, redirect } from "next/navigation";

import { getAnnouncement } from "@/features/marketing/announcements";
import { CampaignForm } from "@/features/marketing/campaign-form";
import { crmsDatabase } from "@/lib/crms-db";
import { MARKETING_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule(MARKETING_MODULE);

  const announcement = await getAnnouncement(crmsDatabase(), (await params).id);

  if (!announcement) notFound();
  // Only a Draft is edited here; anything else has moved on and is back at the list.
  if (announcement.state !== "draft") redirect("/email-campaigns");

  return <CampaignForm draft={announcement} />;
}
