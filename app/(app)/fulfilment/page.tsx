import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BackgroundRefresh } from "@/features/orders/background-refresh";
import { loadFulfilmentBoard } from "@/features/orders/fulfilment";
import { FulfilmentBoardView } from "@/features/orders/fulfilment-board";
import { FULFILMENT_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

export default async function FulfilmentPage() {
  await requireModule(FULFILMENT_MODULE);

  const result = await loadFulfilmentBoard(ticketsDatabase);

  return (
    <div className="flex flex-col gap-5 px-4 py-7 sm:px-8">
      <BackgroundRefresh />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Fulfilment</h1>
        <p className="text-sm leading-[normal] text-[#6e6680]">
          Every Order ready to prepare moves left to right. Each move updates the Order&apos;s status on the store.
        </p>
      </div>
      {result.ok ? (
        <FulfilmentBoardView board={result.board} />
      ) : (
        <Alert variant="destructive">
          <AlertTitle>Fulfilment is temporarily unavailable</AlertTitle>
          <AlertDescription>
            CREOMS could not read the store&apos;s Orders. Reload to try again; if it keeps happening, tell whoever
            maintains CREOMS.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
