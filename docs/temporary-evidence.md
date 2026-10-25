# Delivery photo and refund proof retention (#232)

Both server actions check their Module first, validate the image, upload and confirm an
Active Private Temporary File, and send its id once to the storefront. Refund proof also
gets its existing CRMS Return/refund-proof Link before the decision. Only a matching
storefront confirmation permits promotion to Permanent. Ticket Message attachments still
default to Permanent, and Announcement images remain Public and Permanent.

A storefront refusal preserves its reason and leaves the record unchanged by this action.
A lost, malformed or mismatched response never reports success, retries the write or
promotes the File. File-storage removes Temporary Files after seven days.

## Recovery within seven days

After an uncertain response, read the Order or Return rather than repeat its mutation.
The backend exposes `reconcileDeliveryPhoto(orderId)` and `reconcileRefundProof(returnId)`
for this recovery. Each checks Fulfilment or Returns access afresh, reads the record,
and derives the File id entirely from its persisted reference. It accepts no browser File
id. Only a delivered/received Order or refunded Return with a recorded File can promote;
otherwise recovery refuses. Promotion verifies the returned id, Permanent retention and
null expiry. Recovery is repeatable and never sends a storefront status request.

Invoke recovery before the Temporary File's seven-day expiry. Read/storage failures return
a clear failure and can be recovered later through the same action. No frontend recovery
control or scheduled reconciliation job is added by this backend ticket.

Promotion can also fail after a confirmed write. The action returns an explicit message
that the Order was delivered or the Return was refunded and says not to repeat it. The
same reconciliation actions apply; the confirmed storefront write stays committed.

## Rollout dependency

#227 is closed and unblocks delivery. However, storefront
`lib/returns/refund-proof.ts` still requires Permanent retention and a null expiry (verified
against its GitHub default branch on 2026-10-26). Before deploying this CREOMS change,
update and deploy that validator to accept unexpired Temporary proof while preserving
its Active, Private, image, size, exact Return Link and real-byte checks. The CREOMS fake
storefront models this required contract. Without that update refunds will be refused,
leaving Temporary proof; they will not be reported as successful. No database migration
or new environment variables are needed.

This lifecycle supersedes the Permanent-before-write flow in the older
`creoms-returns-and-delivery-photo.md` integration contract for delivery/refund proof only.

## Manual gateway acceptance after the dependency deploys

Using a test Order/Return and Staff holding the matching Module, verify the deployed
flow registers Temporary, confirms and submits once, then PATCHes to Permanent with
null expiry after the storefront echoes the File id. Verify a refused transition leaves
Temporary evidence and a clear error. For a lost acknowledgement, read the record and
reconcile the exact File within seven days without replaying the write. Revoke the Module
and verify a direct action call is refused before upload. This deployed check has not
been run as part of the local fake-backed suite.
