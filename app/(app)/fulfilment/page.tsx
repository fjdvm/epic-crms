import { FULFILMENT_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

export default async function FulfilmentPage() {
  await requireModule(FULFILMENT_MODULE);

  return (
    <div className="p-md sm:p-lg space-y-sm">
      <h1 className="text-2xl font-semibold leading-[normal] text-foreground">Fulfilment</h1>
      <p className="text-muted-foreground">This is where Staff will move Orders to preparing, dispatched and delivered. It is not built yet.</p>
    </div>
  );
}
