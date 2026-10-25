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

After an uncertain response, Staff refresh the Order or Return and read its status and
Delivery photo/refund proof id. A committed record is the source of truth; never repeat a
delivery or refund to recover its proof. If it holds the uploaded File id, an operator can
promote that exact File through authenticated `PATCH /files/<id>` with
`{ "retentionType": "permanent" }`, checking the id, retention and null expiry returned.
If the record has no matching reference, leave the File Temporary. Do this before its
seven-day expiry. CREOMS does not introduce a reconciliation job in this ticket.

Promotion can also fail after a confirmed write. The action returns an explicit message
that the Order was delivered or the Return was refunded and says not to repeat it. The
same read-and-promote recovery applies; the confirmed storefront write stays committed.

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
