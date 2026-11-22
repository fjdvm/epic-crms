# Roles and approvals (#328)

The Portal assigns one Role and editable Module grants. `shopRole` maps its existing
`Staff/Employee`, `CRMS Manager`/`General Manager`/`CEO`/`VP` and `Super Admin` names to the three CREOMS
roles (CEO and VP are Manager-level; `isAssignable` still keeps them out of Ticket assignment); unknown roles have no shop write authority. Module validation always comes
first. No Role implicitly grants a page or an approval Module.

Apply `docs/db/crms-approvals.sql` as `creoms_writer` before deploying CREOMS. The
Portal companion migration seeds Role templates only; it never changes a person's
Module grants. Fresh Portal seeds install the same defaults.

A `return.decide` request (Staff asking a Manager to decide a Return, see
[Decide return](return-decisions.md#decide-return-staff-check-manager-decides)) is never approved on its own: the Manager
picks the decision on the Return, and `closeRequests` marks the request completed and tells the requester.

`approveReturn`, `declineReturn`, `markReturnRefunded` and `markReturnReplaced`
accept an optional final `{reason, approvalId}` argument. A Staff call with a reason
returns `{ok:false, reason:"Waiting for approval", status, approvalId}` without
changing the storefront or linking refund proof. Read the caller's requests with
`getApprovalRequests(module)`. A Manager-level person calls
`decideApproval(module, id, "approve"|"decline", reason)`; declines need a reason.
The requester retries the original action with its `approvalId` after approval.
It must match the target, payload and selling amount. An atomic claim prevents
concurrent execution. Successful actions consume the approval; uncertain thrown
executions stay claimed for investigation rather than repeating an external effect.

There is no CEO step: one Manager-level approval is final at any amount, and a Manager
performs their own decisions directly. Amounts are integer centavos and exclude delivery fees.
Requests still snapshot the stored limit. A request left in `waiting-ceo` from before
2026-11-23 is finished by any Manager-level person (recorded in the `ceo_*` columns).
Admin cannot execute shop writes.

`requestWriteOff(returnId, reason)` records the approval chain using the Return
items' selling prices; it never removes stock. Ticket #348 owns inspection and IMS
execution. Ticket #329 owns Role picker, request forms, waiting badges and approval
screens. No UI is introduced here.

The Approval limit is no longer shown or changed in Commerce Settings; `setLimit` remains for the stored value. The initial limit is 500000 centavos; every change is recorded with
the changer's identity and previous amount in an atomic local audit record and sent
to the shared Audit service.

Approval notifications are durable outbox entries delivered through the existing
in-app Portal notification service. Manager recipients must have the relevant
Module and Role; decisions notify the requester. Delivery runs after the response with a bounded batch. Failed delivery retries on a user
request/list/decision, using stable keys, never a timer. Role names are included in
the Portal's backend-only recipient directory.

`acceptAISuggestion(module, suggestionId, targetId)` records the named person's
acceptance in the durable audit log and shared Audit service. It never sends or
applies a suggestion; the existing human-confirmed mutation endpoint remains
mandatory. There is no autonomous suggestion execution path.

## The Approvals page, by type

`/approvals` lists everything waiting for a person, grouped by type: ID checks, Refunds, Payments (approve anyway), Cancellations, Write-offs and Returns
(`kindOf` in `features/approvals/view.ts`). Status tabs (Waiting, Approved, Declined, All) combine with a type filter that shows a count for each type;
`?type=id-check` opens on one type. `loadApprovalRows` (`features/approvals/overview.ts`) reads the requests of every Module the person holds (Returns,
Payments, Fulfilment) plus the Senior/PWD ID checks; one unreadable Module shows a notice and never hides the rest. Each row links to its Return, its Order
or its ID check's review page, and Approve/Decline use the row's own Module. Staff see the ID checks and the requests they raised; a Manager-level person (CEO and VP included) sees and decides
all; Admin views. Money decisions are never optimistic.

## Number fields

A field that holds a number uses `NumericInput` (`components/ui/numeric-input.tsx`, mask in `lib/numeric-mask.ts`): `peso` takes digits, commas and one dot
with two decimals; `whole` takes digits only (hours, counts, account numbers). Letters never get in, typed or pasted. The server parsers stay the authority.
