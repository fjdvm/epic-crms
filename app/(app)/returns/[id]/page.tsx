import { notFound } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BackgroundRefresh } from "@/features/orders/background-refresh";
import { ReturnDetailView } from "@/features/returns/return-detail";
import { loadReturnDetail } from "@/features/returns/returns";
import { gatewayFileStorage } from "@/lib/gateway";
import { RETURNS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

/** A short-lived address for a stored image; null when it exists but could not be reached. */
async function viewUrl(fileId: string): Promise<string | null> {
  try {
    return await gatewayFileStorage.viewUrl(fileId);
  } catch (error) {
    console.error(`The image ${fileId} could not be reached`, error);

    return null;
  }
}

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule(RETURNS_MODULE);

  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();

  const result = await loadReturnDetail(ticketsDatabase, Number(id));

  if (!result.ok) {
    return (
      <div className="p-md sm:p-lg">
        <BackgroundRefresh />
        <Alert variant="destructive">
          <AlertTitle>This Return is temporarily unavailable</AlertTitle>
          <AlertDescription>
            CREOMS could not read the store&apos;s Returns. Reload to try again; if it keeps happening, tell
            whoever maintains CREOMS.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!result.detail) notFound();

  const { detail } = result;
  const [imageUrls, deliveryPhotoUrl] = await Promise.all([
    Promise.all(detail.images.map((image) => viewUrl(image.fileId))),
    detail.deliveryPhotoFileId ? viewUrl(detail.deliveryPhotoFileId) : undefined,
  ]);

  return (
    <>
      <BackgroundRefresh />
      <ReturnDetailView detail={detail} imageUrls={imageUrls} deliveryPhotoUrl={deliveryPhotoUrl} />
    </>
  );
}
