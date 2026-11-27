import { redirect } from "next/navigation";

import { AI_INSIGHTS_PAGE } from "@/lib/portal/pages";
import { FEEDBACK_MODULE } from "@/lib/portal/config";
import { canSeeAiInsights, requireModule } from "@/lib/portal/staff";

/**
 * The Feedback page was folded into AI insights. The path stays because it stands for the Feedback Module in the
 * page list (the bell, Needs attention and `/` read it), so old links land in the right place: Manager-level Roles
 * and Admin on the Feedback cards, Staff on Customer Profiles, where each customer's Feedback tab lists theirs.
 */
export default async function FeedbackPage() {
  const staff = await requireModule(FEEDBACK_MODULE);
  redirect(canSeeAiInsights(staff.role) ? `${AI_INSIGHTS_PAGE}?category=feedback` : "/customer-profiles");
}
