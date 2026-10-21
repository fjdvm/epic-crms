import { notFound } from "next/navigation";

import { AnnouncementDetail } from "@/features/marketing/announcement-detail";
import { getAnnouncement, subscriberCount } from "@/features/marketing/announcements";
import { CampaignForm } from "@/features/marketing/campaign-form";
import { crmsDatabase } from "@/lib/crms-db";
import { database } from "@/lib/db";
import { MARKETING_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule(MARKETING_MODULE);

  const announcement = await getAnnouncement(crmsDatabase(), (await params).id);

  if (!announcement) notFound();
  // Only a Draft is edited; anything else has moved on and is shown as it was sent.
  if (announcement.state !== "draft") return <AnnouncementDetail announcement={announcement} />;

  const counts = await subscriberCount(database()).catch(() => null);

  return <CampaignForm draft={announcement} subscribers={counts?.subscribers ?? null} />;
}
