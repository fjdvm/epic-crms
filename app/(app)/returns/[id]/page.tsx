import { refundProofRow } from "@/features/returns/refund-proof-reader";
import { loadRefundCorrections, loadRefundDraft } from "@/features/returns/refund-draft";
import { reviewRefundProof } from "@/features/returns/refund-review";
import type { SavedProof } from "@/features/returns/optimistic-status";
import type { ProofReadView } from "@/features/orders/proof-read";
import { notFound } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BackgroundRefresh } from "@/features/orders/background-refresh";
import { ReturnDetailView } from "@/features/returns/return-detail";
import { loadReturnDetail } from "@/features/returns/returns";
import { loadReplacementStock } from "@/features/returns/replacement-stock";
import { fetchReturnPhoto } from "@/features/returns/photo-bytes";
import { keptFlagExplanation } from "@/features/returns/return-flag-explain";
import { currentAutomaticChecks } from "@/features/settings/automatic-checks-server";
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
  const returnRequests = requests.filter((r) => r.action !== "return.extend-window" && r.action !== "return.change-destination" && r.targetId === id);
  const windowRequest = requests.find((r) => r.action === "return.extend-window" && r.targetId === String(detail.orderId) && r.status !== "completed" && r.status !== "declined");
  const destinationRequest = requests.find((r) => r.action === "return.change-destination" && r.targetId === id && r.status !== "completed" && r.status !== "declined");
  // The proof Staff saved before marking Refunded; a read failure just leaves it out.
  const draft = detail.status === "refunded" ? null : await loadRefundDraft(crmsDatabase(), detail.id).catch((error) => {
    console.error("The saved refund proof could not be read", error);

    return null;
  });
  const proofFileId = detail.refundProofFileId ?? draft?.fileId ?? null;
  const [imageUrls, deliveryPhotoUrl, videoUrl, refundProofUrl, refundRow, refundCorrections] = await Promise.all([
    Promise.all(detail.images.map((image) => viewUrl(image.fileId))),
    detail.deliveryPhotoFileId ? viewUrl(detail.deliveryPhotoFileId) : undefined,
    detail.videoFileId ? viewUrl(detail.videoFileId) : undefined,
    proofFileId ? viewUrl(proofFileId) : undefined,
    // Findings the Proof reader already stored; reading them never calls the model, and a failure just shows nothing read yet.
    refundProofRow(crmsDatabase(), proofFileId),
    proofFileId ? loadRefundCorrections(crmsDatabase(), proofFileId).catch(() => []) : [],
  ]);

  const refundRead: ProofReadView | null = refundRow
    ? { status: refundRow.status === "reading" || refundRow.status === "none" ? "pending" : refundRow.status, findings: refundRow.findings,
      flags: { reusedReferenceOrderIds: [], reusedImageProofIds: [] }, corrections: refundCorrections } : null;
  const review = reviewRefundProof(refundRow ? { status: refundRow.status === "none" ? "pending" : refundRow.status, findings: refundRow.findings } : null, refundCorrections, draft?.savedAt);
  const savedProof: SavedProof | null = draft
    ? { amountInCentavos: draft.amountInCentavos, method: draft.method, refundedOn: draft.refundedOn, reference: draft.reference, reading: review.reading, unresolved: review.unresolved }
    : null;

  // Stock is read only while a replacement may still be chosen or sent; the CEO step depends on the items' selling price.
  const mayReplace = detail.status === "requested" || ((detail.status === "approved" || detail.status === "goods received") && detail.finalResolution === "replacement");
  const selling = detail.items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const [stock, limit] = await Promise.all([
    mayReplace ? loadReplacementStock(ticketsDatabase, detail.id) : undefined,
    crmsDatabase()<{ limit_in_centavos: string }[]>`select limit_in_centavos from crms.approval_settings where singleton`
      .then(([row]) => (row ? Number(row.limit_in_centavos) : null)).catch(() => null),
  ]);
  // An unreadable limit errs toward asking the CEO; the server decides either way.
  const needsCeo = limit === null || selling > limit;

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
        refundRead={refundRead}
        savedProof={savedProof}
        role={role}
        requests={returnRequests}
        windowRequest={windowRequest}
        destinationRequest={destinationRequest}
        stock={stock}
        needsCeo={needsCeo}
      />
    </>
  );
}
