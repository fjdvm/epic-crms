import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { listAnnouncements, subscriberCount } from "@/features/marketing/announcements";
import { CampaignList, SubscribersCard } from "@/features/marketing/campaign-list";
import { crmsDatabase } from "@/lib/crms-db";
import { database } from "@/lib/db";
import { MARKETING_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

export default async function EmailCampaignsPage() {
  await requireModule(MARKETING_MODULE);

  const [announcements, counts] = await Promise.allSettled([
    listAnnouncements(crmsDatabase()),
    subscriberCount(database()),
  ]);

  if (announcements.status === "rejected") {
    console.error("Announcements could not be read", announcements.reason);

    return (
      <div className="p-md sm:p-lg space-y-md">
        <h1 className="text-2xl font-semibold leading-[normal] text-foreground">Email campaigns</h1>
        <Alert variant="destructive">
          <AlertTitle>Email campaigns are temporarily unavailable</AlertTitle>
          <AlertDescription>
            CREOMS could not read the Announcements. Reload to try again; if it keeps happening, tell whoever
            maintains CREOMS.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (counts.status === "rejected") console.error("Subscribers could not be counted", counts.reason);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <div className="flex shrink-0 items-center gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Email campaigns</h1>
          <p className="text-sm leading-[normal] text-[#6e6680]">Every Announcement goes to every Subscriber.</p>
        </div>
        <Link
          href="/email-campaigns/new"
          className="shrink-0 rounded-lg bg-[#5b2a86] px-[14px] py-[9px] text-sm font-medium leading-[normal] whitespace-nowrap text-white"
        >
          New campaign
        </Link>
      </div>
      <SubscribersCard counts={counts.status === "fulfilled" ? counts.value : null} />
      <CampaignList announcements={announcements.value} />
    </div>
  );
}
