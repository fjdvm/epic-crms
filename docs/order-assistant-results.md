# Order assistant Tickets and Results

Part of #471; implements #495. CREOMS reads the storefront's `assistant_chats`,
`assistant_messages` and `assistant_handoffs` tables. It never calls a model.

Apply `docs/db/crms-assistant-flags.sql` as `creoms_writer` and
`docs/db/creoms-assistant-readonly.sql` as the storefront database owner after
storefront migrations 0042/0043. Both are additive and safe to rerun.

The Tickets tab opens `/tickets/assistant`. Sent handoffs are ordered oldest first;
opening the Ticket shows the approved Handoff summary, full stored chat and exact
stored model input. Staff and Managers may mark an assistant answer wrong with a
1–500 character reason after confirmation. The immutable local flag keeps the
answer, reason, time, Staff id and name, and sends an Audit Event to the gateway.
Admin cannot write flags.

Results at `/tickets/assistant/results` requires the Tickets Module and a Manager,
Admin role. It is read-only for all three. Staff are denied before data is
read. These are weekly counts, starting Monday at midnight in Manila:

- Questions: stored Customer messages, compared with the preceding full week.
- Answered without a Ticket: saved assistant messages with outcome `answered`
  whose chat currently has no linked Ticket. A later handoff changes that count.
- Handed off: Customer-approved, sent handoffs, counted by `sent_at`, not assistant
  suggestions that the Customer has not sent.
- Top questions: fixed storefront recognised-kind rules applied to stored questions;
  unrecognised questions stay visible as their own group. The mirrored rules in
  `question-kind.ts` must be updated if the storefront changes its question kinds.
- Flagged answers: flags recorded this week, with their reason and Staff name.

All figures describe retained records only. The storefront retains unlinked chats
for 90 days; no estimate of Staff time saved, helpfulness or model confidence is
shown. Figma's AI settings and customer preview are deliberately omitted per #471.
No polling, focus refetch, model call, Customer notification or shop-data mutation
is introduced by these read screens.
