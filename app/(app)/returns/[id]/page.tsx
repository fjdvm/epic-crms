import { notFound } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BackgroundRefresh } from "@/features/orders/background-refresh";
import { ReturnDetailView } from "@/features/returns/return-detail";
import { loadReturnDetail } from "@/features/returns/returns";
import { fetchReturnPhoto } from "@/features/returns/photo-bytes";
import { keptFlagExplanation } from "@/features/returns/return-flag-explain";
import { currentAutomaticChecks } from "@/features/settings/automatic-checks";
import { fingerprintReturnPhotos, loadReturnFlags } from "@/features/returns/return-flags";
import { crmsDatabase } from "@/lib/crms-db";
import { gatewayFileStorage } from "@/lib/gateway";
import { RETURNS_MODULE } from "@/lib/portal/config";
import { shopRole } from "@/lib/portal/roles";
import { approvals } from "@/features/approvals/server";
import { toView } from "@/features/approvals/view";
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
  const staff = await requireModule(RETURNS_MODULE);
  const role = shopRole(staff.role);

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
  const requests = (await approvals().list(staff, RETURNS_MODULE).catch(() => []))
    .map((row) => toView(row as unknown as Record<string, unknown>));
  // A window request targets the Order, not the Return.
  const returnRequests = requests.filter((r) => r.action !== "return.extend-window" && r.targetId === id);
  const windowRequest = requests.find((r) => r.action === "return.extend-window" && r.targetId === String(detail.orderId) && r.status !== "completed" && r.status !== "declined");
  const [imageUrls, deliveryPhotoUrl, videoUrl, refundProofUrl] = await Promise.all([
    Promise.all(detail.images.map((image) => viewUrl(image.fileId))),
    detail.deliveryPhotoFileId ? viewUrl(detail.deliveryPhotoFileId) : undefined,
    detail.videoFileId ? viewUrl(detail.videoFileId) : undefined,
    detail.refundProofFileId ? viewUrl(detail.refundProofFileId) : undefined,
  ]);

  // Photos not yet fingerprinted are done now; a failure here only means no flag, never an error page.
  const flags = await (async () => {
    await fingerprintReturnPhotos(ticketsDatabase(), crmsDatabase(), fetchReturnPhoto, [detail.id]);

    return (await loadReturnFlags(ticketsDatabase(), crmsDatabase(), [detail.id], (await currentAutomaticChecks()).returns)).get(detail.id);
  })().catch((error) => {
    console.error("Return flags could not be read", error);

    return undefined;
  });

  // Staff never see the AI-written explanation; a read failure just leaves it out.
  const flagExplanations: Partial<Record<"frequent-returns" | "similar-photo", string>> = {};
  if (role && role !== "staff") {
    for (const flag of flags ?? []) {
      const kept = await keptFlagExplanation(crmsDatabase(), detail.id, flag.rule).catch(() => null);
      if (kept) flagExplanations[flag.rule] = kept;
    }
  }

  return (
    <>
      <BackgroundRefresh />
      <ReturnDetailView
        flags={flags}
        flagExplanations={flagExplanations}
        detail={detail}
        imageUrls={imageUrls}
        deliveryPhotoUrl={deliveryPhotoUrl}
        videoUrl={videoUrl}
        refundProofUrl={refundProofUrl}
        role={role}
        requests={returnRequests}
        windowRequest={windowRequest}
      />
    </>
  );
}
