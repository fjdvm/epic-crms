import { RETURNS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

/** Module landing route; the list, tabs and stat-card UI is tracked separately in #172. */
export default async function ReturnsPage() {
  await requireModule(RETURNS_MODULE);
  return <div className="p-md sm:p-lg"><h1 className="text-2xl font-semibold">Returns</h1></div>;
}
