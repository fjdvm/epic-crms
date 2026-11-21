import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import type { FakeFileStorage } from "./fake-file-storage";
import type postgres from "postgres";

export const FAKE_STOREFRONT_URL = "https://storefront.test";
export const FAKE_SERVICE_SECRET = "fake-creoms-service-key-for-tests-only";

/** The storefront Order status contract, backed by the test database shared with CREOMS reads. */
export class FakeStorefront {
  refusal: string | null = null;
  unavailable = false;
  requests = 0;
  packedEvents: { action: string; actor: { id: string; name: string }; at: string }[] = [];
  /** Courier bookings the fake storefront has recorded, by Order id. */
  couriers = new Map<number, Record<string, string>>();
  resentEmails: { orderId: number; kind: string; occurrence: string | null; staffName: string }[] = [];
  /** Emails (`kind` or `kind:occurrence`) Notification already accepted: a resend reconciles them and sends nothing. */
  acceptedEmails = new Set<string>();
  /** Re-upload emails the fake storefront sent, one per rejection. */
  reuploadEmails: { orderId: number; reason: string; link: string }[] = [];

  /** Senior/PWD decision emails, one per decision. They never carry the ID number. */
  interruptCancellation = false;
  verificationEmails: { verificationId: number; status: string; text: string }[] = [];
  /** Server secret that keys the ID-number hash. */
  private static HASH_KEY = "fake-id-hash-key";

  constructor(private sql: postgres.Sql, private now: () => Date = () => new Date(), private files?: FakeFileStorage) {}

  /** The storefront keeps the courier booking on the Order, the rider details with it. */
  private async saveCourier(id: number, courier: { name: string; trackingUrl?: string; riderName?: string; riderPlate?: string; riderPhone?: string }) {
    await this.sql`update orders set courier = ${courier.name}, courier_tracking_url = ${courier.trackingUrl ?? null},
      rider_name = ${courier.riderName ?? null}, rider_plate = ${courier.riderPlate ?? null}, rider_phone = ${courier.riderPhone ?? null} where id = ${id}`;
  }

  private async requestReturn(request: Request, orderId: number): Promise<Response> {
    const customerId = request.headers.get("X-Test-Customer");
    if (!customerId) return Response.json({ error: "Sign in first." }, { status: 401 });
    const body = await request.json();
    if (!Array.isArray(body.lineIds) || body.lineIds.length === 0 ||
      body.lineIds.some((id: unknown) => !Number.isSafeInteger(id) || Number(id) < 1) ||
      new Set(body.lineIds).size !== body.lineIds.length ||
      !["damaged", "defective", "wrong item", "other"].includes(body.reason) ||
      typeof body.note !== "string" || !Array.isArray(body.imageFileIds) ||
      body.imageFileIds.length < 1 || body.imageFileIds.length > 3 ||
      body.imageFileIds.some((id: unknown) => typeof id !== "string" || !id.trim()) ||
      (body.preferredResolution !== undefined && !["refund", "replacement"].includes(body.preferredResolution)) ||
      (body.videoFileId !== undefined && (typeof body.videoFileId !== "string" || !body.videoFileId.trim()))) {
      return Response.json({ error: "Invalid Return request." }, { status: 400 });
    }
    return this.sql.begin(async tx => {
      const [order] = await tx`select o.*, c.full_name from orders o join customers c on c.id = o.customer_id
        where o.id = ${orderId} and o.customer_id = ${customerId} for update of o`;
      if (!order) return Response.json({ error: "Order was not found." }, { status: 404 });
      const now = this.now();
      const deliveredAt = order.delivered_at as Date | null;
      if (order.status !== "delivered" || !deliveredAt || now < deliveredAt ||
        now.getTime() >= deliveredAt.getTime() + 24 * 60 * 60 * 1000) {
        return Response.json({ error: "The 24-hour Refund window is closed." }, { status: 409 });
      }
      const lines = await tx`select * from order_lines where order_id = ${orderId} and id in ${tx(body.lineIds)}`;
      if (lines.length !== body.lineIds.length) return Response.json({ error: "Choose this Order's whole line items." }, { status: 400 });
      const [overlap] = await tx`select 1 from order_return_items i join order_returns r on r.id = i.return_id
        where r.order_id = ${orderId} and r.status not in ('declined','cancelled') and i.order_line_id in ${tx(body.lineIds)} limit 1`;
      if (overlap) return Response.json({ error: "Those items already have a Return." }, { status: 409 });
      const [total] = await tx`select count(*)::int as count from order_lines where order_id = ${orderId}`;
      const amount = lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.price_in_centavos), 0) +
        (lines.length === total.count ? Number(order.delivery_fee_in_centavos ?? 0) : 0);
      const [created] = await tx`insert into order_returns (order_id, reason, note, amount_in_centavos, requested_at, preferred_resolution, video_file_id)
        values (${orderId}, ${body.reason}, ${body.note}, ${amount}, ${now}, ${body.preferredResolution ?? "refund"}, ${body.videoFileId ?? null}) returning id`;
      for (const line of lines) {
        await tx`insert into order_return_items (return_id, order_line_id, product_name, size_label, quantity, price_in_centavos)
          values (${created.id}, ${line.id}, ${line.product_name}, ${line.size_label}, ${line.quantity}, ${line.price_in_centavos})`;
      }
      for (const [index, fileId] of body.imageFileIds.entries()) {
        await tx`insert into order_return_images (return_id, position, file_id) values (${created.id}, ${index + 1}, ${fileId})`;
      }
      await tx`insert into order_return_history (return_id, status, actor_type, actor_id, actor_name, occurred_at)
        values (${created.id}, 'requested', 'customer', ${customerId}, ${order.full_name}, ${now})`;
      return Response.json({ id: created.id }, { status: 201 });
    });
  }

  /** Whole line items only: each is sellable (added back to IMS stock) or damaged (written off once approved). */
  readonly restocked: { returnId: number; orderLineId: number; quantity: number }[] = [];
  readonly writtenOff: { returnId: number; orderLineId: number; quantity: number }[] = [];
  readonly decisionEmails: { returnId: number; kind: string }[] = [];
  private async inspectReturn(request: Request, id: number): Promise<Response> {
    if (this.refusal) return Response.json({ error: this.refusal }, { status: 409 });
    const input = await request.json();
    if (!input.staffId || !input.staffName || !input.inspectionId) return Response.json({ error: "Staff attribution is required." }, { status: 400 });
    return this.sql.begin(async tx => {
      const [current] = await tx`select * from order_returns where id = ${id} for update`;
      if (!current) return Response.json({ error: "Return was not found." }, { status: 404 });
      const items = await tx`select * from order_return_items where return_id = ${id} order by order_line_id`;
      const done = { id, inspectionId: input.inspectionId, action: input.action };
      if (input.action === "inspect") {
        if (items.every(i => i.inspection_id === input.inspectionId)) return Response.json(done);
        if (current.status !== "goods received" || items.some(i => i.condition)) return Response.json({ error: "Return is not ready to inspect or was already inspected." }, { status: 409 });
        const given = new Map((input.items ?? []).map((i: { orderLineId: number; condition: string }) => [i.orderLineId, i.condition]));
        if (given.size !== items.length || !items.every(i => ["sellable", "damaged"].includes(given.get(i.order_line_id) as string))) {
          return Response.json({ error: "Mark every item sellable or damaged." }, { status: 400 });
        }
        const at = this.now();
        for (const item of items) {
          const condition = given.get(item.order_line_id);
          await tx`update order_return_items set condition = ${condition as string}, inspected_at = ${at}, inspected_by_id = ${input.staffId},
            inspected_by_name = ${input.staffName}, inspection_id = ${input.inspectionId},
            restocked_at = ${condition === "sellable" ? at : null} where return_id = ${id} and order_line_id = ${item.order_line_id}`;
          if (condition === "sellable") this.restocked.push({ returnId: id, orderLineId: item.order_line_id, quantity: item.quantity });
        }
        return Response.json(done);
      }
      if (input.action === "write-off") {
        const damaged = items.filter(i => i.condition === "damaged");
        if (damaged.every(i => i.written_off_at) && damaged.length) return Response.json(done);
        if (!damaged.length || input.inspectionId !== items[0]?.inspection_id) return Response.json({ error: "Nothing to write off on this Return." }, { status: 409 });
        const at = this.now();
        for (const item of damaged) {
          await tx`update order_return_items set written_off_at = ${at} where return_id = ${id} and order_line_id = ${item.order_line_id}`;
          this.writtenOff.push({ returnId: id, orderLineId: item.order_line_id, quantity: item.quantity });
        }
        this.decisionEmails.push({ returnId: id, kind: "write-off" });
        return Response.json(done);
      }
      return Response.json({ error: "Unknown inspection step." }, { status: 400 });
    });
  }

  /** Replacement Order emails the fake storefront sent, one per Replacement Order. */
  readonly replacementEmails: { returnId: number; replacementOrderId: number }[] = [];
  /** Stock the fake storefront has set aside, by Size label. Defaults to plenty. */
  reservations: { orderId: number; productName: string; sizeLabel: string; quantity: number }[] = [];
  outOfStock = new Set<string>();

  /** The new Order is ₱0, linked to the original, quoted no Delivery fee, and reserves its own stock. Repeating returns the same Order. */
  private async createReplacementOrder(request: Request, returnId: number): Promise<Response> {
    if (this.refusal) return Response.json({ error: this.refusal }, { status: 409 });
    const input = await request.json();
    if (!input.staffId || !input.staffName) return Response.json({ error: "Staff attribution is required." }, { status: 400 });
    return this.sql.begin(async tx => {
      const [ret] = await tx`select * from order_returns where id = ${returnId} for update`;
      if (!ret) return Response.json({ error: "Return was not found." }, { status: 404 });
      const [existing] = await tx`select id from orders where replacement_for_return_id = ${returnId}`;
      if (existing) return Response.json({ returnId, replacementOrderId: existing.id });
      if (ret.final_resolution !== "replacement") return Response.json({ error: "This Return is not a replacement." }, { status: 409 });
      const items = await tx`select * from order_return_items where return_id = ${returnId} order by order_line_id`;
      const short = items.find(item => this.outOfStock.has(`${item.product_name}|${item.size_label}`));
      if (short) return Response.json({ error: `${short.product_name} (${short.size_label}) is out of stock for a replacement.` }, { status: 409 });
      const [original] = await tx`select * from orders where id = ${ret.order_id}`;
      const [created] = await tx`insert into orders (customer_id, status, subtotal_in_centavos, delivery_fee_in_centavos, fulfillment_method,
        payment_method, replacement_for_order_id, replacement_for_return_id)
        values (${original.customer_id}, 'paid', 0, 0, ${original.fulfillment_method}, ${original.payment_method}, ${original.id}, ${returnId}) returning id`;
      for (const item of items) {
        await tx`insert into order_lines (order_id, product_name, size_label, price_in_centavos, quantity)
          values (${created.id}, ${item.product_name}, ${item.size_label}, 0, ${item.quantity})`;
        this.reservations.push({ orderId: created.id, productName: item.product_name, sizeLabel: item.size_label, quantity: item.quantity });
      }
      this.replacementEmails.push({ returnId, replacementOrderId: created.id });
      return Response.json({ returnId, replacementOrderId: created.id }, { status: 201 });
    });
  }

  /** One extension per Order, by 24 hours, with a reason, while the Order is delivered. */
  private async extendWindow(request: Request, orderId: number): Promise<Response> {
    if (this.refusal) return Response.json({ error: this.refusal }, { status: 409 });
    const input = await request.json();
    if (!input.staffId || !input.staffName) return Response.json({ error: "Staff attribution is required." }, { status: 400 });
    if (typeof input.reason !== "string" || !input.reason.trim()) return Response.json({ error: "Enter a reason for extending the window." }, { status: 400 });
    return this.sql.begin(async tx => {
      const [order] = await tx`select * from orders where id = ${orderId} for update`;
      if (!order) return Response.json({ error: "Order was not found." }, { status: 404 });
      if (order.refund_window_extended_at) return Response.json({ error: "The Refund window was already extended once." }, { status: 409 });
      if (order.status !== "delivered" || !order.delivered_at) return Response.json({ error: "Only a delivered Order has a Refund window to extend." }, { status: 409 });
      await tx`update orders set refund_window_extended_at = ${this.now()}, refund_window_extension_reason = ${input.reason.trim()} where id = ${orderId}`;
      return Response.json({ orderId, endsAt: new Date(order.delivered_at.getTime() + 48 * 60 * 60 * 1000).toISOString() });
    });
  }

  private async changeDestination(request: Request, id: number): Promise<Response> {
    if (this.refusal) return Response.json({ error: this.refusal }, { status: 409 });
    const input = await request.json();
    if (!input.staffId || !input.staffName) return Response.json({ error: "Staff attribution is required." }, { status: 400 });
    if (input.customerConfirmed !== true || typeof input.reason !== "string" || !input.reason.trim()) return Response.json({ error: "A reason and the Customer's confirmation are required." }, { status: 400 });
    return this.sql.begin(async tx => {
      const [ret] = await tx`select * from order_returns where id = ${id} for update`;
      if (!ret) return Response.json({ error: "Return was not found." }, { status: 404 });
      if (!["approved", "goods received"].includes(ret.status) || ret.final_resolution !== "refund") return Response.json({ error: "Money was already sent or the refund is not approved." }, { status: 409 });
      const changedAt = this.now();
      await tx`update order_returns set refund_method = ${input.method}, refund_account_name = ${input.accountName}, refund_account_number = ${input.accountNumber},
        refund_bank_name = ${input.bankName}, refund_destination_confirmed_at = ${changedAt} where id = ${id}`;
      return Response.json({ returnId: id, changedAt: changedAt.toISOString() });
    });
  }

  private async decideReturn(request: Request, id: number): Promise<Response> {
    if (this.refusal) return Response.json({ error: this.refusal }, { status: 409 });
    const update = await request.json();
    if (typeof update.staffId !== "string" || !update.staffId.trim() ||
      typeof update.staffName !== "string" || !update.staffName.trim()) {
      return Response.json({ error: "Staff attribution is required." }, { status: 400 });
    }
    if (update.status === "approved" && typeof update.goodsRequired !== "boolean") {
      return Response.json({ error: "Say whether the goods must come back." }, { status: 400 });
    }
    if (update.status === "approved" && update.finalResolution !== undefined &&
      !["refund", "replacement"].includes(update.finalResolution)) {
      return Response.json({ error: "Invalid Resolution." }, { status: 400 });
    }
    if (update.status === "refunded" && (typeof update.refundProofFileId !== "string" || !update.refundProofFileId.trim())) {
      return Response.json({ error: "Refund proof is required." }, { status: 400 });
    }
    if (update.status === "refunded" && (!Number.isSafeInteger(update.refundAmountInCentavos) || update.refundAmountInCentavos < 0 ||
      !["gcash", "maya", "bank-transfer"].includes(update.refundPaidMethod) || !/^\d{4}-\d{2}-\d{2}$/.test(update.refundedOn ?? "") ||
      typeof update.refundReference !== "string" || update.refundReference.trim().length < 4)) {
      return Response.json({ error: "Refund details are required." }, { status: 400 });
    }
    if (update.status === "declined" && (typeof update.declineReason !== "string" || !update.declineReason.trim())) {
      return Response.json({ error: "Enter a reason for declining the Return." }, { status: 400 });
    }
    if (update.status === "refunded") {
      // #232 contract: linked Active Private proof may still be Temporary until confirmation.
      // The storefront companion validator accepts unexpired Temporary proof before CREOMS promotes it.
      const file = this.files?.files.get(update.refundProofFileId);
      if (!file || file.returnId !== id || file.visibility !== "private" || file.status !== "active") {
        return Response.json({ error: "Refund proof must be linked to this Return." }, { status: 400 });
      }
    }
    return this.sql.begin(async tx => {
      const [current] = await tx`select * from order_returns where id = ${id} for update`;
      if (!current) return Response.json({ error: "Return was not found." }, { status: 404 });
      const allowed = (update.status === "approved" || update.status === "declined") && current.status === "requested" ||
        update.status === "goods received" && current.status === "approved" && current.goods_required === true ||
        (update.status === "refunded" || update.status === "replaced") &&
          (current.status === "goods received" || current.status === "approved" && current.goods_required === false) &&
          current.final_resolution === (update.status === "refunded" ? "refund" : "replacement");
      if (!allowed) return Response.json({ error: "Return already changed." }, { status: 409 });
      const at = this.now();
      const [order] = await tx`select delivery_fee_in_centavos from orders where id = ${current.order_id}`;
      const fee = order?.delivery_fee_in_centavos ?? 0;
      const [changed] = await tx`update order_returns set status = ${update.status},
        final_resolution = ${update.status === "approved" ? update.finalResolution ?? current.preferred_resolution : current.final_resolution},
        refund_proof_file_id = ${update.status === "refunded" ? update.refundProofFileId : current.refund_proof_file_id},
        replaced_at = ${update.status === "replaced" ? at : current.replaced_at},
        goods_required = ${update.status === "approved" ? update.goodsRequired : current.goods_required},
        decline_reason = ${update.status === "declined" ? update.declineReason.trim() : current.decline_reason},
        refunded_at = ${update.status === "refunded" ? at : current.refunded_at},
        refund_amount_in_centavos = ${update.status === "refunded" ? update.refundAmountInCentavos : current.refund_amount_in_centavos},
        refund_paid_method = ${update.status === "refunded" ? update.refundPaidMethod : current.refund_paid_method},
        refund_paid_on = ${update.status === "refunded" ? update.refundedOn : current.refund_paid_on},
        refund_reference = ${update.status === "refunded" ? update.refundReference : current.refund_reference},
        refund_delivery_fee_in_centavos = ${update.status === "refunded" && update.deliveryFeeReason ? fee : current.refund_delivery_fee_in_centavos},
        refund_delivery_fee_reason = ${update.status === "refunded" && update.deliveryFeeReason ? update.deliveryFeeReason : current.refund_delivery_fee_reason}
        where id = ${id} returning *, refund_paid_on::text as paid_on_text`;
      await tx`insert into order_return_history (return_id, status, actor_type, actor_id, actor_name, occurred_at, note)
        values (${id}, ${update.status}, 'staff', ${update.staffId}, ${update.staffName}, ${at}, ${changed.decline_reason})`;
      return Response.json({ id, status: changed.status, goodsRequired: changed.goods_required,
        finalResolution: changed.final_resolution, refundProofFileId: changed.refund_proof_file_id,
        refundAmountInCentavos: changed.refund_amount_in_centavos, refundPaidMethod: changed.refund_paid_method,
        refundedOn: changed.paid_on_text, refundReference: changed.refund_reference,
        declineReason: changed.decline_reason, refundDeliveryFeeInCentavos: changed.refund_delivery_fee_in_centavos, actedBy: { id: update.staffId, name: update.staffName, at: at.toISOString() } });
    });
  }

  /** The Customer submits a proof (the first, or another after a rejection); a new proof returns the Order to checking. */
  async submitProof(orderId: number, reference: string, screenshotFileId: string | null = null): Promise<void> {
    await this.sql.begin(async tx => {
      const [order] = await tx`select status, payment_method from orders where id = ${orderId} for update`;
      if (!order || order.status !== "awaiting payment" || order.payment_method === "cash-on-delivery") throw new Error("Order does not take a proof");
      const at = this.now();
      await tx`insert into order_payment_proofs (order_id, reference, screenshot_file_id, submitted_at) values (${orderId}, ${reference}, ${screenshotFileId}, ${at})`;
      await tx`update orders set gcash_reference_number = ${reference}, payment_proof_file_id = ${screenshotFileId},
        payment_proof_submitted_at = ${at}, payment_proof_rejected_at = null where id = ${orderId}`;
    });
  }

  private async rejectProof(request: Request, id: number): Promise<Response> {
    if (this.refusal) return Response.json({ error: this.refusal }, { status: 409 });
    const { reason, staffId, staffName } = await request.json();
    if (typeof reason !== "string" || !reason.trim()) return Response.json({ error: "Enter a reason for rejecting the proof." }, { status: 400 });
    if (!staffId || !staffName) return Response.json({ error: "Staff attribution is required." }, { status: 400 });
    return this.sql.begin(async tx => {
      const [order] = await tx`select * from orders where id = ${id} for update`;
      if (!order) return Response.json({ error: "Order was not found." }, { status: 404 });
      if (order.status !== "awaiting payment" || order.payment_proof_submitted_at === null || order.payment_proof_rejected_at !== null) {
        return Response.json({ error: "Order already changed." }, { status: 409 });
      }
      const at = this.now();
      await tx`update order_payment_proofs set rejected_at = ${at}, rejected_by_id = ${staffId}, rejected_by_name = ${staffName}, rejection_reason = ${reason.trim()}
        where id = (select max(id) from order_payment_proofs where order_id = ${id})`;
      const [changed] = await tx`update orders set payment_proof_rejected_at = ${at}, payment_proof_rejections = payment_proof_rejections + 1
        where id = ${id} returning status, payment_proof_rejections, delivery_fee_in_centavos`;
      this.reuploadEmails.push({ orderId: id, reason: reason.trim(), link: `${FAKE_STOREFRONT_URL}/orders/${id}/payment` });
      return Response.json({ id, status: changed.status, rejections: changed.payment_proof_rejections, deliveryFeeInCentavos: changed.delivery_fee_in_centavos });
    });
  }

  /** The Customer uploads the ID photo and types the number. The number is hashed at once and never stored. */
  async submitVerification(customerId: string, idType: "senior" | "pwd", idNumber: string, photoFileId: string): Promise<number | { error: string }> {
    const idHash = createHmac("sha256", FakeStorefront.HASH_KEY).update(idNumber.replace(/\s+/g, "").toUpperCase()).digest("hex");
    return this.sql.begin(async tx => {
      const [taken] = await tx`select 1 from senior_pwd_verifications where id_hash = ${idHash} and customer_id <> ${customerId}
        and status in ('pending', 'approved') limit 1`;
      if (taken) return { error: "This ID is already used on another account." };
      // Like the storefront: an ID that was used on another account before (declined, revoked) is accepted but flagged.
      const [before] = await tx`select id from senior_pwd_verifications where id_hash = ${idHash} and customer_id <> ${customerId} order by id desc limit 1`;
      const [row] = await tx`insert into senior_pwd_verifications (customer_id, id_type, id_hash, photo_file_id, submitted_at, same_id_as_verification_id)
        values (${customerId}, ${idType}, ${idHash}, ${photoFileId}, ${this.now()}, ${before?.id ?? null}) returning id`;
      return Number(row.id);
    });
  }

  /** File-storage removes a Temporary photo after seven days; the storefront then asks the Customer to upload again. */
  async removeStalePhotos(): Promise<void> {
    await this.sql`update senior_pwd_verifications set status = 'expired', photo_file_id = null
      where status = 'pending' and submitted_at <= ${new Date(this.now().getTime() - 7 * 24 * 60 * 60 * 1000)}`;
  }

  private async decideVerification(request: Request, id: number, action: string): Promise<Response> {
    if (this.refusal) return Response.json({ error: this.refusal }, { status: 409 });
    const body = await request.json();
    if (!body.staffId || !body.staffName) return Response.json({ error: "Staff attribution is required." }, { status: 400 });
    return this.sql.begin(async tx => {
      const [v] = await tx`select *, to_char(expires_on, 'YYYY-MM-DD') as expires from senior_pwd_verifications where id = ${id} for update`;
      if (!v) return Response.json({ error: "Verification was not found." }, { status: 404 });
      const ok = action === "approve" ? v.status === "pending" || body.override && ["declined", "revoked"].includes(v.status)
        : action === "decline" ? v.status === "pending" : v.status === "approved";
      if (!ok) return Response.json({ error: "Verification already changed." }, { status: 409 });
      if (action === "approve") {
        const [other] = await tx`select 1 from senior_pwd_verifications where id_hash = ${v.id_hash} and id <> ${id} and status = 'approved'
          and expires_on > ${this.now()} limit 1`;
        if (other) return Response.json({ error: "This ID is already verified on another account." }, { status: 409 });
      }
      if (action !== "approve" && !String(body.reason ?? "").trim()) return Response.json({ error: "A reason is required." }, { status: 400 });
      const status = { approve: "approved", decline: "declined", revoke: "revoked" }[action]!;
      // The photo is deleted right after review.
      await tx`update senior_pwd_verifications set status = ${status}, photo_file_id = null, decided_at = ${this.now()},
        decided_by_id = ${body.staffId}, decided_by_name = ${body.staffName},
        decline_reason = ${action === "approve" ? null : body.reason.trim()},
        expires_on = ${action === "approve" ? body.expiresOn : v.expires} where id = ${id}`;
      this.verificationEmails.push({ verificationId: id, status,
        text: action === "decline" ? `Your Senior/PWD ID was declined: ${body.reason.trim()}` : `Your Senior/PWD verification is ${status}.` });
      return Response.json({ id, status, expiresOn: action === "approve" ? body.expiresOn : v.expires });
    });
  }

  handle = async (request: Request): Promise<Response> => {
    this.requests++;
    if (this.unavailable) throw new Error("Storefront unavailable");
    // Customer authentication in the fake only. Production uses the storefront's own session.
    const customerCancellation = new URL(request.url).pathname.match(/^\/api\/orders\/(\d+)\/cancellation$/);
    if (customerCancellation && request.method === "POST") {
      const customerId = request.headers.get("X-Test-Customer"), id = Number(customerCancellation[1]);
      if (!customerId) return Response.json({ error: "Sign in first." }, { status: 401 });
      const { reason } = await request.json();
      if (typeof reason !== "string" || !reason.trim()) return Response.json({ error: "Enter a reason." }, { status: 400 });
      return this.sql.begin(async tx => {
        const [order] = await tx`select o.*, c.full_name from orders o join customers c on c.id = o.customer_id where o.id = ${id} and o.customer_id = ${customerId} for update of o`;
        if (!order || order.status !== "dispatched") return Response.json({ error: "Only your dispatched Order can have a cancellation request." }, { status: 409 });
        const [r] = await tx`insert into order_cancellations (id,order_id,reason,actor_type,actor_id,actor_name)
          values (${randomUUID()},${id},${reason},'customer',${customerId},${order.full_name}) on conflict (order_id) do update set order_id = excluded.order_id returning *`;
        return Response.json({ id, requestId: r.id, status: r.status === "waiting-manager" ? r.approval_status : r.status }, { status: 202 });
      });
    }
    const returnRequest = new URL(request.url).pathname.match(/^\/api\/orders\/(\d+)\/returns$/);
    if (returnRequest && request.method === "POST") return this.requestReturn(request, Number(returnRequest[1]));
    const returnDecision = new URL(request.url).pathname.match(/^\/api\/internal\/returns\/(\d+)\/status$/);
    const verificationDecision = new URL(request.url).pathname.match(/^\/api\/internal\/senior-pwd\/(\d+)\/(approve|decline|revoke)$/);
    const resource = returnDecision || /^\/api\/internal\/returns\/\d+\/(inspection|replacement-order)$/.test(new URL(request.url).pathname) || /^\/api\/internal\/orders\/\d+\/refund-window\/extend$/.test(new URL(request.url).pathname) || /^\/api\/internal\/returns\/\d+\/refund-destination$/.test(new URL(request.url).pathname) ? "returns" : verificationDecision ? "senior-pwd" : "orders";
    const parts = request.headers.get("authorization")?.replace(/^Bearer /, "").split(".");
    if (!parts || parts.length !== 3) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const [header, payload, signature] = parts;
    const expected = createHmac("sha256", FAKE_SERVICE_SECRET).update(`${header}.${payload}`).digest("base64url");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    const now = Math.floor(Date.now() / 1000);
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ||
      JSON.parse(Buffer.from(header, "base64url").toString()).alg !== "HS256" ||
      claims.iss !== "creoms" || claims.aud !== `brenraphaels-${resource}` || claims.scope !== `${resource}:status` ||
      claims.iat > now || claims.exp <= now || claims.exp - claims.iat > 900) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (returnDecision && request.method === "POST") return this.decideReturn(request, Number(returnDecision[1]));
    if (verificationDecision && request.method === "POST") return this.decideVerification(request, Number(verificationDecision[1]), verificationDecision[2]);
    const replacement = new URL(request.url).pathname.match(/^\/api\/internal\/returns\/(\d+)\/replacement-order$/);
    if (replacement && request.method === "POST") return this.createReplacementOrder(request, Number(replacement[1]));
    const destination = new URL(request.url).pathname.match(/^\/api\/internal\/returns\/(\d+)\/refund-destination$/);
    if (destination && request.method === "POST") return this.changeDestination(request, Number(destination[1]));
    const extension = new URL(request.url).pathname.match(/^\/api\/internal\/orders\/(\d+)\/refund-window\/extend$/);
    if (extension && request.method === "POST") return this.extendWindow(request, Number(extension[1]));
    const cancellation = new URL(request.url).pathname.match(/^\/api\/internal\/orders\/(\d+)\/cancellation$/);
    if (cancellation && request.method === "POST") {
      const id = Number(cancellation[1]), input = await request.json();
      if (this.refusal) return Response.json({ error: this.refusal }, { status: 409 });
      return this.sql.begin(async tx => {
        const [order] = await tx`select * from orders where id = ${id} for update`;
        if (!order || order.status !== "dispatched") return Response.json({ error: "Order already changed." }, { status: 409 });
        if (input.action === "request") {
          const [r] = await tx`insert into order_cancellations (id,order_id,reason,actor_type,actor_id,actor_name)
            values (${randomUUID()},${id},${input.reason},'staff',${input.staffId},${input.staffName}) on conflict (order_id) do update set order_id = excluded.order_id returning *`;
          return Response.json({ id, requestId: r.id, status: r.status === "waiting-manager" ? r.approval_status : r.status });
        }
        const [r] = await tx`select * from order_cancellations where id = ${input.requestId} and order_id = ${id}`;
        if (r && input.action === "decide") {
          await tx`update order_cancellations set approval_status = ${input.decision}, decline_reason = ${input.decision === "declined" ? input.reason : null} where id = ${r.id}`;
          return Response.json({ id, requestId: r.id, status: input.decision });
        }
        if (!r) return Response.json({ error: "Request was not found." }, { status: 409 });
        if (order.payment_method !== "cash-on-delivery" && this.files?.files.get(input.refundProofFileId)?.orderId !== id) return Response.json({ error: "Link refund proof first." }, { status: 400 });
        if (this.interruptCancellation) {
          await tx`update order_cancellations set status = 'settling', stock_outcome = ${input.stockOutcome}, refund_method = ${input.refundMethod}, refund_proof_file_id = ${input.refundProofFileId} where id = ${r.id}`;
          return Response.json({ error: "IMS did not confirm the restock. Resume the same cancellation." }, { status: 503 });
        }
        await tx`update orders set status = 'cancelled' where id = ${id}`;
        await tx`update order_cancellations set status = 'cancelled', stock_outcome = ${input.stockOutcome}, refund_method = ${input.refundMethod}, refund_proof_file_id = ${input.refundProofFileId} where id = ${r.id}`;
        return Response.json({ id, status: "cancelled", ...input });
      });
    }
    const inspection = new URL(request.url).pathname.match(/^\/api\/internal\/returns\/(\d+)\/inspection$/);
    if (inspection && request.method === "POST") return this.inspectReturn(request, Number(inspection[1]));
    const failure = new URL(request.url).pathname.match(/^\/api\/internal\/orders\/(\d+)\/failed-delivery$/);
    if (failure && request.method === "POST") {
      if (this.refusal) return Response.json({ error: this.refusal }, { status: 409 });
      const id = Number(failure[1]), input = await request.json();
      return this.sql.begin(async tx => {
        const [order] = await tx`select * from orders where id = ${id} for update`;
        if (!order || order.status !== "dispatched" || order.fulfillment_method !== "delivery") return Response.json({ error: "Only dispatched Delivery Orders." }, { status: 409 });
        const [attempt] = await tx`select * from failed_deliveries where id = ${input.attemptId} and order_id = ${id}`;
        if (input.action === "record") {
          if (!input.reason?.trim() || !input.customerMessage?.trim() || !["rebook", "request-cancellation"].includes(input.nextStep)) return Response.json({ error: "Enter a reason and Staff decision." }, { status: 400 });
          await tx`insert into failed_deliveries (id, order_id, reason, next_step, customer_message, staff_id, staff_name)
            values (${input.attemptId}, ${id}, ${input.reason}, ${input.nextStep}, ${input.customerMessage}, ${input.staffId}, ${input.staffName}) on conflict do nothing`;
        } else if (!attempt) return Response.json({ error: "Failed attempt was not found." }, { status: 409 });
        else if (input.action === "rebook") {
          if (attempt.disposition) return Response.json({ error: "Goods cannot be rebooked." }, { status: 409 });
          this.couriers.set(id, input.courier);
          await tx`update failed_deliveries set courier = ${tx.json(input.courier)}, rebooked_at = now() where id = ${input.attemptId}`;
        } else await tx`update failed_deliveries set disposition = ${input.action}, disposed_at = now() where id = ${input.attemptId}`;
        return Response.json({ id, status: "dispatched", attemptId: input.attemptId, action: input.action });
      });
    }
    const cancelItems = new URL(request.url).pathname.match(/^\/api\/internal\/orders\/(\d+)\/items\/cancel$/);
    if (cancelItems && request.method === "POST") {
      const id = Number(cancelItems[1]);
      const { lineIds, staffId, staffName, expectedStatus } = await request.json();
      if (this.refusal) return Response.json({ error: this.refusal }, { status: 409 });
      return this.sql.begin(async tx => {
        const [order] = await tx`select * from orders where id = ${id} for update`;
        if (!order || order.status !== expectedStatus || !["placed", "confirmed", "awaiting payment", "paid", "preparing"].includes(order.status) || !staffId || !staffName) {
          return Response.json({ error: "Items can no longer be cancelled on this Order." }, { status: 409 });
        }
        const lines = await tx`select * from order_lines where order_id = ${id}`;
        const remaining = lines.filter(line => !lineIds.includes(line.id));
        if (!remaining.length || lines.length - remaining.length !== lineIds.length) return Response.json({ error: "Those items already changed. Refresh the Order." }, { status: 409 });
        const subtotal = remaining.reduce((sum, line) => sum + line.quantity * line.price_in_centavos, 0);
        const needsQuote = order.fulfillment_method === "delivery" && order.subtotal_in_centavos > 250000 && subtotal <= 250000;
        await tx`delete from order_lines where order_id = ${id} and id in ${tx(lineIds)}`;
        const [updated] = await tx`update orders set subtotal_in_centavos = ${subtotal},
          status = ${order.status}, delivery_fee_in_centavos = ${needsQuote ? null : order.delivery_fee_in_centavos}
          where id = ${id} returning *`;
        return Response.json({ id, status: updated.status, deliveryFeeInCentavos: updated.delivery_fee_in_centavos });
      });
    }
    const courierEdit = new URL(request.url).pathname.match(/^\/api\/internal\/orders\/(\d+)\/courier$/);
    if (courierEdit && request.method === "POST") {
      if (this.refusal) return Response.json({ error: this.refusal }, { status: 409 });
      const id = Number(courierEdit[1]), { courier, staffId, staffName } = await request.json();
      if (!staffId || !staffName) return Response.json({ error: "Staff attribution is required." }, { status: 400 });
      if (!["Lalamove", "Grab"].includes(courier?.name) || (courier.trackingUrl !== undefined && !/^https:\/\/\S{1,2040}$/.test(courier.trackingUrl))) {
        return Response.json({ error: "Choose Lalamove or Grab; a booking link must be https." }, { status: 400 });
      }
      const [order] = await this.sql`select status, fulfillment_method from orders where id = ${id}`;
      if (!order || order.status !== "dispatched" || order.fulfillment_method !== "delivery") return Response.json({ error: "Order already changed." }, { status: 409 });
      this.couriers.set(id, courier);
      await this.saveCourier(id, courier);
      return Response.json({ id, status: "dispatched", courier: { name: courier.name, trackingUrl: courier.trackingUrl ?? null }, deliveryFeeInCentavos: null });
    }
    const resend = new URL(request.url).pathname.match(/^\/api\/internal\/orders\/(\d+)\/email\/resend$/);
    if (resend && request.method === "POST") {
      if (this.refusal) return Response.json({ error: this.refusal }, { status: 409 });
      const id = Number(resend[1]), body = await request.json();
      const occurrence: string | null = body.occurrence ?? null;
      const [outcome] = await this.sql`select status from order_email_outcomes where order_id = ${id} and kind = ${body.kind} and coalesce(occurrence, '') = ${occurrence ?? ""}`;
      if (outcome?.status !== "failed") return Response.json({ error: "That email is not marked as failed." }, { status: 409 });
      await this.sql`update order_email_outcomes set status = 'sent', reason = null, updated_at = now() where order_id = ${id} and kind = ${body.kind} and coalesce(occurrence, '') = ${occurrence ?? ""}`;
      const accepted = this.acceptedEmails.has(occurrence ? `${body.kind}:${occurrence}` : body.kind);
      if (!accepted) this.resentEmails.push({ orderId: id, kind: body.kind, occurrence, staffName: body.staffName });
      return Response.json({ id, kind: body.kind, occurrence, status: accepted ? "reconciled" : "sent" });
    }
    const reject = new URL(request.url).pathname.match(/^\/api\/internal\/orders\/(\d+)\/payment-proof\/reject$/);
    if (reject && request.method === "POST") return this.rejectProof(request, Number(reject[1]));
    const match = new URL(request.url).pathname.match(/^\/api\/internal\/orders\/(\d+)\/status$/);
    if (!match || request.method !== "POST") return new Response(null, { status: 404 });
    if (this.refusal) return Response.json({ error: this.refusal }, { status: 409 });
    const id = Number(match[1]);
    const update = await request.json();
    const [order] = await this.sql`select * from orders where id = ${id}`;
    if (!order) return Response.json({ error: "Order was not found." }, { status: 404 });
    const mayConfirm = update.status === "confirmed" && (order.status === "placed" || order.fulfillment_method === "delivery" && order.delivery_fee_in_centavos === null && ["confirmed", "awaiting payment", "paid", "preparing"].includes(order.status));
    const mayCancel = update.status === "cancelled" &&
      ["placed", "confirmed", "awaiting payment", "paid", "preparing"].includes(order.status);
    const mayPrepare = update.status === "preparing" && (order.status === "paid" ||
      (order.status === "confirmed" && order.payment_method === "cash-on-delivery"));
    const mayDispatch = update.status === "dispatched" && order.status === "preparing" && order.fulfillment_method === "delivery";
    const mayDeliver = update.status === "delivered" && order.status === "dispatched" && order.fulfillment_method === "delivery";
    const mayMarkPaid = update.status === "paid" && order.status === "awaiting payment";
    if (mayDeliver && (!update.deliveryPhotoFileId || order.delivery_photo_file_id)) {
      return Response.json({ error: "Exactly one permanent Delivery photo is required." }, { status: 400 });
    }
    if (mayDispatch && (!["Lalamove", "Grab"].includes(update.courier?.name) ||
      (update.courier?.trackingUrl !== undefined && !/^https:\/\/\S{1,2040}$/.test(update.courier.trackingUrl)))) {
      return Response.json({ error: "Dispatching a Delivery Order needs the courier, and any tracking link must be https." }, { status: 400 });
    }
    if (mayMarkPaid && order.payment_proof_rejections >= 3 && !update.approvedAnyway?.reason?.trim()) {
      return Response.json({ error: "After 3 rejected proofs a Manager must approve with a reason." }, { status: 400 });
    }
    if (mayMarkPaid && order.payment_proof_rejections < 3 && order.payment_proof_rejected_at !== null) {
      return Response.json({ error: "The proof was rejected. Wait for another." }, { status: 409 });
    }
    // COD completion saves the collection with the status; any other amount is refused and nothing is kept.
    const cod = order.payment_method === "cash-on-delivery" && mayDeliver;
    if (cod) {
      const total = order.subtotal_in_centavos - (order.discount_in_centavos ?? 0) + (order.delivery_fee_in_centavos ?? 0);
      if (!update.codCollection || update.codCollection.amountInCentavos !== total || !update.codCollection.staffId || !update.codCollection.staffName) {
        return Response.json({ error: "The collected amount must equal the saved total." }, { status: 400 });
      }
    }
    if ((mayMarkPaid || mayPrepare) && (!update.staffId || !update.staffName)) {
      return Response.json({ error: "Staff attribution is required." }, { status: 400 });
    }
    if (!mayConfirm && !mayCancel && !mayPrepare && !mayDispatch && !mayDeliver && !mayMarkPaid) return Response.json({ error: "Order already changed." }, { status: 409 });
    if (mayConfirm && order.fulfillment_method === "delivery" &&
      (!Number.isSafeInteger(update.deliveryFeeInCentavos) || update.deliveryFeeInCentavos < 0)) {
      return Response.json({ error: "A Delivery fee is required." }, { status: 400 });
    }
    if (mayConfirm) {
      // The real storefront takes these as flat fields; `amounts` is not accepted.
      const fee = update.deliveryFeeInCentavos ?? 0;
      if (update.amounts !== undefined || update.subtotalInCentavos !== order.subtotal_in_centavos ||
        !Number.isSafeInteger(update.approvedDiscountInCentavos) || !Number.isSafeInteger(update.totalInCentavos) ||
        update.totalInCentavos !== update.subtotalInCentavos - update.approvedDiscountInCentavos + fee || !update.staffId || !update.staffName) {
        return Response.json({ error: "The amounts do not match the Order. Refresh it before confirming." }, { status: 409 });
      }
    }
    const [changed] = await this.sql`
      update orders set status = ${mayConfirm && order.status !== "placed" ? order.status : update.status},
        delivery_photo_file_id = ${mayDeliver ? update.deliveryPhotoFileId : order.delivery_photo_file_id},
        dispatched_at = ${mayDispatch ? new Date() : order.dispatched_at},
        delivered_at = ${mayDeliver ? new Date() : order.delivered_at},
        cod_collected_amount_in_centavos = ${cod ? update.codCollection.amountInCentavos : order.cod_collected_amount_in_centavos},
        cod_collected_at = ${cod ? new Date() : order.cod_collected_at},
        cod_collected_by_id = ${cod ? update.codCollection.staffId : order.cod_collected_by_id},
        cod_collected_by_name = ${cod ? update.codCollection.staffName : order.cod_collected_by_name},
        delivery_fee_in_centavos = ${update.deliveryFeeInCentavos ?? order.delivery_fee_in_centavos},
        paid_by_id = ${mayMarkPaid ? update.staffId : order.paid_by_id},
        paid_by_name = ${mayMarkPaid ? update.staffName : order.paid_by_name},
        packed_by_id = ${mayPrepare ? update.staffId : order.packed_by_id},
        packed_by_name = ${mayPrepare ? update.staffName : order.packed_by_name},
        packed_at = ${mayPrepare ? new Date() : order.packed_at},
        paid_at = ${mayMarkPaid ? new Date() : order.paid_at}
      where id = ${id} and status = ${order.status} returning id, status, delivery_fee_in_centavos, delivery_photo_file_id, packed_by_id, packed_by_name, packed_at`;
    if (!changed) return Response.json({ error: "Order already changed." }, { status: 409 });
    if (mayPrepare) this.packedEvents.push({ action: "order.packed", actor: { id: changed.packed_by_id, name: changed.packed_by_name }, at: changed.packed_at.toISOString() });
    if (mayDispatch && update.courier) {
      this.couriers.set(id, update.courier);
      await this.saveCourier(id, update.courier);
    }
    return Response.json({ id: changed.id, status: changed.status, ...(changed.packed_at ? { packedBy: { id: changed.packed_by_id, name: changed.packed_by_name, at: changed.packed_at.toISOString() } } : {}), ...(this.couriers.has(id) ? { courier: this.couriers.get(id) } : {}), deliveryFeeInCentavos: changed.delivery_fee_in_centavos, deliveryPhotoFileId: changed.delivery_photo_file_id });
  };
}

export function storefrontFetch(storefront: FakeStorefront): typeof fetch {
  return (async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin !== FAKE_STOREFRONT_URL) throw new Error("Unexpected destination");
    return storefront.handle(request);
  }) as typeof fetch;
}
