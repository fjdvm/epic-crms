import { CampaignFormSkeleton } from "@/features/marketing/campaign-form-skeleton";

/** Whether the Announcement is edited or shown as sent is only known once it loads, so the heading is a skeleton. */
export default function Loading() {
  return <CampaignFormSkeleton />;
}
