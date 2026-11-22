# Tickets and Conversations v2: CREOMS spec (DRAFT, not published)

Linked spec: `tickets-v2-ecommerce.md` (ships first; this one depends on its migration). Vocabulary follows `CONTEXT.md`.

## Problem Statement

CREOMS Staff can claim, reply, hold and escalate, but the lifecycle they see no longer matches the shop's rules. Only Staff can resolve, Completed is final, Managers can only move an already Claimed Ticket, nobody can see which Customer Messages they have not read, a Claimer who leaves leaves a Ticket nobody can answer while the Customer's clock runs, and the Ticket lists and reports are built on the old statuses and "Not fixed" and Follow-up flows.

## Solution

Align CREOMS with the new lifecycle, which the storefront now owns. Staff see five statuses with On hold, Escalated and Claimer unavailable as overlays, and Tickets tabs Unclaimed, My Tickets, All open and Resolved & Closed. Managers can Assign an Unclaimed Ticket. Only the Claimer replies, only on an active Ticket. Staff lose the Resolve button; the Customer resolves. Unread counts and Seen marks work per Claimer. The Conversations page has Mine, Unclaimed and All. Reports use the new definitions. CREOMS never closes a Ticket by itself.

## User Stories

### Tabs and lists
1. As Staff, I want an Unclaimed tab of active Tickets with no Claimer, oldest first, so that I can pick up unanswered work.
2. As Staff, I want a My Tickets tab of active Tickets I Claimed, so that I see my own work.
3. As a Manager, I want an All open tab of every active Ticket with the Claimed by filter, so that I see the whole team's work.
4. As Admin or CEO, I want All open read-only, so that I can look but not act.
5. As Staff, I want a Resolved & Closed tab, Legacy completions included, so that I can look back at finished work.
6. As Staff, I want a count on each tab that follows the same visibility as its list, so that counts never reveal what I cannot open.
7. As Staff, I want Awaiting Staff Reply, Awaiting Customer Reply, On hold and Escalated as filters or pills rather than tabs, so that the tabs stay simple.
8. As Staff, I want a Ticket to be Overdue only when it is Open or Awaiting Staff Reply and the Customer's last Message has had no Staff reply for the first reply target, so that Tickets waiting on the Customer never look late.
9. As Staff, I want a Ticket with no Linked order to show "None yet", so that a gap is not mistaken for missing data.

### Ticket details
10. As Staff, I want the Ticket page to show Customer information, subject, description, status, Claimer, Linked order, images and timestamps, so that I have the full picture.
11. As Staff, I want an Open conversation button on the Ticket page, so that I can go straight to the chat.
12. As Staff, I want any Ticket openable read-only by every Staff member with the Tickets Module, so that I can help without owning it.
13. As Staff, I want no Resolve, Release or Reassign buttons on a Ticket I do not hold, so that I cannot act on someone else's work.
14. As Staff, I want no Resolve button at all, because only the Customer resolves, so that the rule is clear.
15. As Staff, I want ratings shown read-only on the Ticket page, one per resolution, so that I see how each went.
16. As Staff, I want a Reopen event and a Closure reason visible in the Ticket's activity, so that I know its history.
17. As a Manager, I want "Follow-up of" and "Follow-up:" links on old Tickets kept readable, so that history is not lost.

### Claim, Assign, Reassign
18. As Staff, I want to Claim an Unclaimed active Ticket, so that I can answer it.
19. As Staff, I want two people unable to Claim the same Ticket, so that we never answer twice.
20. As Staff, I want no Claim on a Ticket that is already Assigned, so that nobody takes another's work.
21. As a Manager, I want to Assign an Unclaimed Ticket to a named Staff member with an optional note, so that urgent work gets an owner.
22. As a Manager, I want to Reassign a Claimed Ticket with a required reason, so that moves are explained.
23. As a Manager, I want Assign and Reassign to keep the Conversation and history, so that nothing is lost.
24. As Staff, I want a Ticket Assigned to me to move into My Tickets and out of Unclaimed with an alert, so that I notice it.
25. As Staff, I want to Release a Ticket I Claimed, so that someone else can take it, but not while it is Escalated.
26. As a Manager, I want to take an Escalated Ticket through Reassign and send it back with a note, as today.
27. As Admin or CEO, I want Assign and Reassign history readable without buttons, so that I stay read-only.
28. As Staff, I want a Ticket I open on a Customer's behalf to start Open and Claimed by me, so that I own it.
29. As Staff, I want what I record on a phone-intake Ticket not to count as a response, so that the Customer is not put on a clock for nothing.

### Replying and Conversations
30. As the Claimer, I want to reply to the Customer with text, up to three images, or both, so that I can answer fully.
31. As Staff, I want a reply refused unless I am the current Claimer and the Ticket is active, so that only one person talks to the Customer.
32. As a Manager, I want to be unable to reply until I am the Claimer, so that I take ownership first.
33. As the Claimer, I want my first Message to the Customer to start the Customer inactivity deadline and let them resolve, so that the cycle begins correctly.
34. As the Claimer, I want a reply never to extend an existing deadline, so that the rule is predictable.
35. As the Claimer, I want a reply while the Ticket is On hold to leave the hold in place, so that I do not lose it.
36. As Staff, I want a Message saved whole or not at all, with "Message not sent" and my draft kept if an image fails, so that I never send half a Message.
37. As Staff, I want a Conversations page with Mine, Unclaimed and All tabs, so that I can work chats from one place.
38. As Staff, I want to Claim from an Unclaimed chat's header, so that I can start answering.
39. As a Manager, I want to Assign from an Unclaimed chat's header, so that I can route it.
40. As Admin or CEO, I want the All tab read-only, so that I can monitor.
41. As Staff, I want a Resolved or Closed chat read-only with a note that the Customer can reopen on the storefront, so that I know why I cannot reply.
42. As Staff, I want internal notes and AI drafts to stay Staff-only and never count as replies or as read, so that the Customer sees only real answers.

### Unread and Seen
43. As the Claimer, I want an unread count on Tickets I Claimed, so that I see where Customers wrote.
44. As Staff or Manager, I want no unread count on other people's Tickets, so that counts mean my work.
45. As the Claimer, I want a chat marked read only when its Messages are actually displayed, so that a background update does not hide a Message I have not seen.
46. As the Claimer, I want a Message that arrives after I opened the chat to stay unread, so that I do not miss it.
47. As Staff, I want browsing an Unclaimed chat or someone else's never to mark anything read, so that I cannot move the Claimer's marker.
48. As the new Claimer after a move, I want every Customer Message unread, so that I review the whole thread.
49. As a Customer, I want my Seen marks to survive a move, so that the history I saw stays true.

### Claimer unavailable, hold, escalate
50. As a Manager, I want Tickets whose Claimer is deactivated or lost the Tickets Module flagged "Claimer unavailable", so that I can act.
51. As a Manager, I want one alert per incident, so that I am not spammed.
52. As a Manager, I want the Customer's deadline paused while the Claimer is unavailable, so that the Customer is not closed out for our gap.
53. As a Manager, I want Assign or Reassign to an eligible Staff member to end the flag and resume the saved time only if still Awaiting Customer Reply and nothing else pauses it, so that the clock is fair.
54. As Staff, I want to put a Ticket On hold with a reason, an optional Staff note and a return time, and have the Customer see only "We're on it", so that reasons stay internal.
55. As Staff, I want a Customer Message to end my hold at once, so that I answer the Customer's new Message.
56. As the Claimer, I want to escalate with a reason and note, as today, so that Managers help.

### Alerts
57. As Staff, I want a new Ticket to alert everyone with the Tickets Module, as today.
58. As the Claimer, I want a new Customer Message to alert me (or every Staff member while Unclaimed), as today.
59. As the Claimer, I want a Customer reopening to alert me, and every Manager with the Tickets Module while the Ticket is Unclaimed, so that nothing is lost.
60. As Staff, I want an Assign or Reassign to alert the new Claimer, and Reassign also the previous one.
61. As Staff, I want a Customer marking Resolved to raise no alert, so that I am not interrupted.
62. As Staff, I want old "Not fixed" alerts to stay visible and no new ones to be raised, so that history is preserved.

### Reports and audit
63. As a Manager, I want Resolved to count Customer resolutions only, so that inactivity closures never look like successes.
64. As a Manager, I want resolve time from creation to the first Customer resolution, and from each Reopen to the next, with the existing pause rules.
65. As a Manager, I want Reopen rate by episode, each counted once, historical Follow-ups once and never beside a matching Reopen.
66. As a Manager, I want Closed by inactivity shown separately, excluding Legacy completions, with its share of all outcomes.
67. As a Manager, I want Resolved credited to the Claimer at resolution time, and inactivity closures shown as assigned at closure.
68. As a Manager, I want average rating from submitted ratings only.
69. As a Manager, I want past reports' dates, ratings and attribution unchanged.
70. As Admin or CEO, I want Assign, Reassign, claim, release, hold, escalate and Staff replies in the Ticket Audit Events with my identity from the session, never a Message body, email, phone, image or signed link.

## Implementation Decisions

- **Dependency.** Ships after the ecommerce migration; reads the new status, deadline, hold, Claimer-unavailable, Closure reason, rating and read-marker fields through the existing restricted database role, with only the explicitly required grants (Claimer read marker, assign and reassign, hold and escalate, Staff Message and attachment writes). CREOMS never closes a Ticket, never writes a Customer event and never moves the Customer's read marker.
- **Statuses and pills.** Five stored statuses read as stored; Awaiting Staff Reply, Awaiting Customer Reply, On hold, Escalated and Claimer unavailable are pills and filters. The old "Waiting on customer" tab, Completed, the Resolve button and Staff-marked resolution are removed.
- **Tabs and visibility.** Tickets: Unclaimed (everyone with the Module), My Tickets (Staff, Manager), All open (Manager, Admin, CEO; Admin and CEO read-only), Resolved & Closed (everyone with the Module). Counts and lists share one server-side visibility rule. Conversations: Mine, Unclaimed, All (Manager, Admin, CEO). Every tab and action is enforced on the server, not just hidden.
- **Reply rule.** Only the current Claimer, only on an active Ticket; a Manager takes ownership through Assign or Reassign first. Resolved and Closed Conversations are read-only.
- **Assign.** New Manager action on Unclaimed Tickets: named eligible Staff member (Tickets Module, active), optional note, alert to the assignee, audited. Reassign is unchanged (required reason, stale-Claimer check, previous and new Claimer alerted) apart from covering the new Closed state.
- **Unread.** The Claimer's marker advances only for Messages displayed in the Conversation view, never from the Ticket page or a background update, and only for the Claimer's own session. A reassignment resets the new Claimer's baseline. Live events arrive over the existing relay with reconnect refetch; no polling, timers that fetch, or fetching effects.
- **Claimer unavailable.** Evaluated on the server wherever a Ticket is listed or acted on, with a once-per-incident Manager alert and audit; the ecommerce sweep checks the same eligibility before closing.
- **Images.** Up to three JPG or PNG images of 5 MB, content-checked on the server, same wording as the storefront, saved whole or not at all; images open through short-lived links after an access check.
- **Audit.** CREOMS writes Staff and Manager events with the signed-in person as Actor, saved with the change and delivered with a per-occurrence key; privacy as in the ecommerce spec. Reading is not audited.
- **Reports.** Updated to the new definitions (Resolved, resolve time by episode, Reopen rate by episode, Closed by inactivity, credit by Claimer at resolution, ratings), preserving historical figures and never fabricating Customer resolutions for Legacy records.
- **Reused behaviour kept.** Service levels (first reply, resolve target), Priority, AI suggestions, summaries and drafted replies stay as they are. The Service level resolve clock additionally stops while Awaiting Customer Reply, as today, and is separate from the Customer inactivity deadline.
- **Missing screens in scope, built from existing components and styles, no Figma edits:** the Assign dialog, the Unclaimed chat header with Claim and Assign, the Claimer unavailable pill and Manager alert, the read-only Resolved/Closed chat note, the Closure reason and Reopen entries in the activity, and the rating display.
- **Deployment.** Migration compatibility: CREOMS must keep working against the migrated schema before this spec's PRs land.

## Testing Decisions

- Behaviour a person can see, not how it is built; time through the injected clock; no polling or fetching effect in any test.
- **Seam 2, CREOMS Tickets data layer** against PGlite, with the shared Ticket test database and fake Portal, relay, notifications, gateway audit and file storage. Prior art: the existing ticket database helper, ticket actions, conversations, escalate and report tests. Covers tab membership and counts per role, Overdue with the new statuses, Claim, Assign and Reassign (including stale Claimer), reply rules, Claimer unavailable and its alert, unread counts and baseline reset, alerts by event and recipient, atomic Messages and refusal wording, Ticket Audit Event contents, and each report figure including historical Follow-ups and Legacy records.
- **Concurrency.** Two simultaneous Claims and Assigns on one Ticket are verified against a real Postgres in a separate named test, since PGlite cannot prove row locking.
- **Seam 3, CREOMS pages through the fake Portal.** Module gating for each tab and action per role, no Resolve button, Staff seeing read-only Tickets, Admin and CEO read-only, and the immediate loading state of each page. Prior art: the existing list, detail and conversations view tests and the access tests.
- **Live behaviour.** Live events, reconnects and read-marker updates through the relay fake; the existing no-polling and live-update tests are extended.
- **Server enforcement.** Tests call the actions directly as the wrong role or wrong owner to prove the server, not the UI, refuses.
- **Compatibility.** Tests run CREOMS reads against the ecommerce-first migrated schema, and migration reruns do not change what CREOMS shows.

## Out of Scope

- Customer-side screens, actions, sweep, emails and migration (ecommerce spec).
- The unread-reply email; PDFs; more than three images.
- Customer data retention policy, tracked separately.
- Any AI feature change, Service level target change, or Figma editing.
- Staff-created Tickets are unchanged apart from the status and deadline rules.

## Further Notes

- Not published to the issue tracker, at the owner's request.
- Suggested slices after approval: (E1) ecommerce migration and role grants; (E2) status rules, Customer resolve, reopen, ratings; (E3) deadline, sweep, hold and unavailable pauses, emails; (E4) images and atomic Messages; (E5) read markers; (E6) storefront UI; then (C1) tabs and statuses; (C2) Assign and reply rules; (C3) unread; (C4) Claimer unavailable; (C5) Conversations tabs; (C6) reports; (C7) audit and alerts.
