# Roles and approvals (#328)

The Portal assigns one Role and editable Module grants. `shopRole` maps its existing
`Staff/Employee`, `CRMS Manager`, `Super Admin` and `CEO` names to the four CREOMS
roles; unknown roles have no shop write authority. Module validation always comes
first. No Role implicitly grants a page or an approval Module.

Apply `docs/db/crms-approvals.sql` as `creoms_writer` before deploying CREOMS. The
Portal companion migration seeds Role templates only; it never changes a person's
Module grants. Fresh Portal seeds install the same defaults.

`approveReturn`, `declineReturn`, `markReturnRefunded` and `markReturnReplaced`
accept an optional final `{reason, approvalId}` argument. A Staff call with a reason
returns `{ok:false, reason:"Waiting for approval", status, approvalId}` without
changing the storefront or linking refund proof. Read the caller's requests with
`getApprovalRequests(module)`. A Manager/CEO calls
`decideApproval(module, id, "approve"|"decline", reason)`; declines need a reason.
The requester retries the original action with its `approvalId` after approval.
It must match the target, payload and selling amount. An atomic claim prevents
concurrent execution. Successful actions consume the approval; uncertain thrown
executions stay claimed for investigation rather than repeating an external effect.

Only refund and write-off requests strictly above the saved limit have a CEO step.
Amounts are integer centavos and exclude delivery fees. Requests snapshot the limit
at submission, so changing Settings applies to new requests. Managers can perform
ordinary decisions directly; above-limit refunds instead return a CEO request with
the Manager decision already recorded. Admin and CEO cannot execute shop writes.

`requestWriteOff(returnId, reason)` records the approval chain using the Return
items' selling prices; it never removes stock. Ticket #348 owns inspection and IMS
execution. Ticket #329 owns Role picker, request forms, waiting badges and approval
screens. No UI is introduced here.

The Portal Settings backend is `POST /api/creoms/approval-limit`: `{}` reads,
`{amountInCentavos}` changes (Admin only). It issues a 60-second, centrally bound
CREOMS handle, calls `POST /api/approvals/limit`, then revokes the handle. The
CREOMS endpoint validates the Portal-owned `Portal Settings` capability against the live Portal. This capability admits only Admin, CEO and CREOMS Manager identities and does not depend on shop Module grants; no CREOMS page uses it. No extra shared
secret or database credential is required. `setApprovalLimit` is the corresponding
CREOMS action. The initial limit is 500000 centavos; every change is recorded with
the Admin's identity and previous amount in an atomic local audit record and sent
to the shared Audit service.

Approval notifications are durable outbox entries delivered through the existing
in-app Portal notification service. Manager/CEO recipients must have the relevant
Module and Role; decisions notify the requester. Delivery runs after the response with a bounded batch. Failed delivery retries on a user
request/list/decision, using stable keys, never a timer. Role names are included in
the Portal's backend-only recipient directory.

`acceptAISuggestion(module, suggestionId, targetId)` records the named person's
acceptance in the durable audit log and shared Audit service. It never sends or
applies a suggestion; the existing human-confirmed mutation endpoint remains
mandatory. There is no autonomous suggestion execution path.
