# Tickets and Conversations v2: Ecommerce spec (DRAFT, not published)

Linked spec: `tickets-v2-creoms.md`. Vocabulary follows CREOMS `CONTEXT.md` (Ticket, Ticket status, Customer inactivity deadline, Closure reason, Legacy completion, Legacy resolution, Reopen, Claim, Assign, Claimer unavailable, Unread, Ticket rating, Ticket email, Ticket Audit Event). This spec ships first.

## Problem Statement

A Customer can raise a Ticket and chat, but today only Staff can mark it Resolved, the Customer's only way back is a new "Follow-up" Ticket, a Resolved Ticket auto-completes after 3 days, and "Completed" is final. Customers cannot say their own problem is fixed, cannot reopen the same Ticket with its history, are not warned before a Ticket closes, cannot see which replies they have not read, and can attach only one image. Tickets a Customer has stopped answering sit open forever.

## Solution

Make the storefront and its database the owner of the new Ticket lifecycle. The Customer marks their own Ticket Resolved (with an optional rating) after the first Staff response, or reopens a Resolved or Closed Ticket by sending a new Message on the same Ticket and Conversation. A server sweep every 15 minutes closes Tickets the Customer has stopped answering for 72 hours, after a 24-hour warning. Four emails go out through Notification. Messages carry up to three images. The storefront shows unread and Seen marks, and the new statuses. Existing Tickets are migrated without inventing deadlines or Customer resolutions.

## User Stories

### Raising a Ticket
1. As a Customer, I want to raise a Ticket with a subject, a category from the fixed list, a description and an optional Linked order, so that Staff know what I need.
2. As a Customer, I want to choose only my own Orders as the Linked order, so that nobody sees another Customer's Order through my Ticket.
3. As a Customer, I want to attach up to three JPG or PNG images of up to 5 MB each to my first Message, so that I can show the problem.
4. As a Customer, I want a clear message when an image is too big, the wrong type, empty, or the fourth, so that I can fix it before sending.
5. As a Customer, I want a renamed non-image file refused by its real content, so that nothing unsafe is stored.
6. As a Customer, I want my Ticket to appear as Open and Unclaimed for Staff at once, so that someone picks it up.
7. As a Customer, I want my draft kept and "Message not sent" shown if any image fails to upload, so that I can retry without retyping.
8. As a Customer, I want a failed attempt to leave no text, image link or alert behind, so that Staff never see half a Message.
9. As a Customer, I want a Message to have text, images or both but never neither, so that I do not send an empty Message by accident.
10. As a Customer, I want my chosen Category kept and never overwritten by an AI suggestion, so that my description of the problem stays mine.

### Conversation
11. As a Customer, I want one Conversation per Ticket in My account, so that the whole story is in one place.
12. As a Customer, I want each Message to show its sender's name and time, so that I know who said what.
13. As a Customer, I want an unread indicator on a Ticket with Staff replies I have not seen, so that I know where to look.
14. As a Customer, I want a Message marked read only when it has actually been displayed to me, so that a background update never hides a reply I have not seen.
15. As a Customer, I want a Message that arrives after I opened the chat to stay unread, so that I do not miss it.
16. As a Customer, I want "Seen" under my Message once the Claimer has read it, so that I know someone has looked.
17. As a Customer, I want Staff replies to appear live while I am connected, so that the chat feels immediate.
18. As a Customer, I want to be told "We're on it" while a Ticket is On hold and never the reason, so that I am reassured without seeing internal detail.
19. As a Customer, I want to see my Ticket's status as Open, Awaiting Staff Reply, Awaiting Customer Reply, Resolved or Closed, so that I know whose turn it is.
20. As a Customer, I want a Ticket Staff opened for me to start Open and answered only when Staff reply to me, so that I am not closed out before anyone has actually answered.

### Resolving
21. As a Customer, I want a Mark as Resolved button after Staff have first answered me, so that I can tell the shop my problem is fixed.
22. As a Customer, I want no Mark as Resolved before Staff's first customer-visible response, so that I cannot close something nobody has looked at.
23. As a Customer, I want to give an optional 1 to 5 star rating and comment when I resolve, so that I can say how it went.
24. As a Customer, I want skipping the rating never to block resolving, so that resolving is quick.
25. As a Customer, I want a rating given once per resolution and never edited, so that it stays honest.
26. As a Customer, I want a confirmation email and in-app notice when my Ticket is Resolved, so that I have a record.
27. As a Customer, I want a Resolved Ticket to stay Resolved until I reopen it, so that it never closes on me with a different label.
28. As a Customer, I want the old "closes in 3 days" wording gone, so that I am not told something untrue.
29. As a Customer, I want Resolved and Closed Conversations read-only until I reopen, so that nothing changes by accident.

### Inactivity and warning
30. As a Customer, I want 72 hours to reply after Staff answer me before my Ticket closes, so that I have time to respond.
31. As a Customer, I want further Staff messages never to extend or shorten that time, so that the rule is predictable.
32. As a Customer, I want my reply to clear the time and make the Ticket Awaiting Staff Reply, so that the shop knows it is their turn.
33. As a Customer, I want the next Staff response to start a fresh 72 hours, so that each cycle is fair.
34. As a Customer, I want a Ticket where I am waiting on Staff never to close, so that I am never punished for the shop's delay.
35. As a Customer, I want a warning by email and in-app 24 hours before closure, so that I can reply in time.
36. As a Customer, I want only one warning per cycle even if the Ticket is held and resumed, so that I am not spammed.
37. As a Customer, I want no warning and no closure while my Ticket is On hold or the Claimer is unavailable, so that Staff delays never close it.
38. As a Customer, I want a Ticket closed for my inactivity to say "Closed — Customer inactivity" with an email and in-app notice, so that I know why.
39. As a Customer, I want a warning that is already stale (I replied, it was resolved, held or closed) never to be sent, so that I only get true warnings.

### Reopening
40. As a Customer, I want a Reopen Ticket button on my Resolved or Closed Tickets, so that I can continue the same conversation.
41. As a Customer, I want reopening to require a new Message, so that Staff know what changed.
42. As a Customer, I want the same Ticket and Conversation to come back with every Message, image and event, so that nothing is lost.
43. As a Customer, I want reopening to make the Ticket Awaiting Staff Reply and clear any old closure deadline, so that it is answered promptly.
44. As a Customer, I want no time limit on reopening, so that a late problem is still heard.
45. As a Customer, I want a confirmation email and in-app notice when I reopen, so that I know it worked.
46. As a Customer, I want to reopen a Ticket closed for inactivity as many times as I need, so that each reopening is handled.
47. As a Customer, I want "Start a follow-up" replaced by Reopen Ticket, so that there is one clear path.
48. As a Customer, I want the old "Not fixed" action gone and any old route to demand the same Message, so that nothing bypasses the rule.
49. As a Customer, I want old Follow-up links on past Tickets to stay readable, so that history is intact.
50. As a Customer, I want to be unable to reopen once I have begun deleting my account, so that deletion is not undone.
51. As a Customer, I want account deletion refused while any Ticket is not Resolved or Closed, naming the blocking Tickets, so that I know what to finish.

### Access and safety
52. As a Customer, I want to open, resolve and reopen only my own Tickets, so that nobody else can act on them.
53. As a Customer, I want images shown through short-lived private links made after an access check, so that a leaked link soon stops working.
54. As a Customer, I want my identity in any record to come from my signed-in session, never from fields I send, so that nobody can act as me.
55. As a Customer, I want my Ticket's images to stay private and be hidden with my data if I delete my account, so that they are not exposed.

### Staff and platform needs from this app
56. As Staff, I want the storefront to record the Claimer, hold and Claimer-unavailable facts the Customer actions depend on, so that status and deadlines stay correct from either app.
57. As Staff, I want a Customer's reopening to return the Ticket to its Claimer, or to Unclaimed if the Claimer is unavailable, so that someone is responsible.
58. As a Manager, I want to be alerted when a Customer reopens a Ticket that returned to Unclaimed, so that it is assigned.
59. As an Admin, I want the old daily auto-complete disabled before the new sweep starts, so that the retired rules never run.
60. As an Admin, I want each Ticket email's sent or failed outcome recorded once, so that I can trust the trail.
61. As an operator, I want a failed email never to block or reverse a saved change, so that a mail outage cannot break Tickets.
62. As an operator, I want the migration safe to run twice, so that a retry never resets deadlines or sends duplicates.

## Implementation Decisions

- **Ownership.** This app owns the schema and its migrations, the Customer actions, read-marker storage, per-resolution ratings, the attachment structure, the inactivity sweep and the four emails. CREOMS never closes a Ticket and never writes a Customer-side event.
- **Status.** Five stored statuses: Open, Awaiting Staff Reply, Awaiting Customer Reply, Resolved, Closed. Open stays through any Customer Messages until the first customer-visible Staff response; internal notes, AI drafts and a Staff-opened Ticket's intake description are not responses. After that the two Awaiting statuses follow the Messages. On hold, Escalated and Claimer unavailable are overlays that never replace the status. Assignment is the single existing Claimer field.
- **Closure reason.** Closed carries a Closure reason: Customer inactivity or Legacy completion. Legacy resolution (an old Staff-marked Resolved) is kept as an origin on Resolved Tickets and never produces a Customer resolution event.
- **Deadline.** A stored 72-hour deadline starts with the first Staff response while Awaiting Customer Reply, is never extended, is cleared by a Customer Message, and is paused (with remaining time saved) by On hold or Claimer unavailable. It resumes only if the Ticket is still Awaiting Customer Reply and no pause applies; release alone never creates one. A Customer Message ends a hold, clears the deadline and discards the saved time. A Staff response during a hold leaves the hold and, if it is the first response, sets up a paused cycle. Warnings are once per cycle; a resume with 24 hours or less left and no warning sent sends it then.
- **Sweep.** A server job every 15 minutes (so up to 15 minutes late is accepted) locks each eligible Ticket, rechecks status, deadline, holds, Claimer eligibility and warning state, records the closure or warning with its notification work in one transaction, then sends outside the lock with per-occurrence deduplication. A Claimer who is unavailable blocks closing. The old daily auto-complete job is disabled before the new sweep is enabled. No browser timers, polling or fetching effects anywhere.
- **Customer actions.** Mark as Resolved (after first Staff response; optional rating and comment, once per resolution, never edited) and Reopen (new Message required; works for Resolved and Closed; no time limit; same Ticket and Conversation; becomes Awaiting Staff Reply; keeps an eligible Claimer, otherwise Unclaimed; alerts the Claimer or Managers). "Not fixed" and "Start a follow-up" are removed; any old entry point routes through the same validated reopen and cannot skip the Message. Reopening is refused once the Customer has begun deleting their account. Account deletion is blocked by any Ticket that is not Resolved or Closed.
- **Messages and images.** A Message has text, images or both, never neither; up to three JPG or PNG images of 5 MB each, validated by real content on the server with the same refusal wording as CREOMS, and on the client. Saved only after every image has uploaded and passed; any failure shows "Message not sent", keeps the draft, publishes nothing and cleans up orphaned uploads. Existing single-image Messages are untouched. Images are Private in File Storage, opened through short-lived links minted after an ownership check on every request, never stored or audited, and hidden (not purged) for a deleted Customer.
- **Read markers.** Two per Ticket (Customer and Claimer). The Customer's advances only through Messages actually displayed. The Claimer's marker is written only by the Claimer's CREOMS session and cannot be moved from here or by other viewers. Seen under a Customer Message once the Claimer has read it. A reassignment resets the new Claimer's baseline but keeps Seen marks the Customer already saw. Live updates arrive over the existing relay and reconnect refetch; reading changes no status, deadline or alert and is not audited.
- **Ratings.** One per resolution; a reopened Ticket keeps earlier ratings and can be rated again. Stored with the resolution event so Reports can use it without inference.
- **Emails.** Four, through Notification, in the established email design: the 24-hour warning, Resolved, Closed (Customer inactivity) and Reopened; each also an in-app notice on the storefront. Staff replies are in-app only (no "Support replies" email; unread-reply email is a separate follow-up). Claimed once per event occurrence; resolving or reopening again is a new occurrence. The warning is rechecked just before sending. A failed send never blocks or reverses the saved change. The caller records only a failure before Notification accepted the request; Notification records outcomes, so there is no duplicate event.
- **Audit.** This app writes Customer creation, replies, resolution and reopening with the authenticated Customer as Actor, and the sweep writes automatic closure and warning as a system process. The event is saved with the business change and delivered through the gateway with a per-occurrence idempotency key. Events hold Ticket number, Message id and image count; never message bodies, emails, phone numbers, image contents or signed links; the Customer by id and display name only. Reads and read-marker updates are not events.
- **Migration.** Additive and defaulted so existing Tickets keep working, rerunnable without resetting deadlines, duplicating warnings or overwriting later activity. Open with no customer-visible Staff response stays Open; Open whose last Message is the Customer's after a Staff response becomes Awaiting Staff Reply; Open whose last Message is Staff's becomes Awaiting Customer Reply with a fresh 72 hours from a recorded cutover time (never backdated); On hold or Claimer unavailable keep the overlay with a paused 72-hour allowance; old Resolved stays Resolved as a Legacy resolution with no deadline; old Completed becomes Closed with Legacy completion and its dates; Tickets whose history cannot decide are flagged for review. Follow-up links and old ratings are kept.
- **Database role.** The `creoms_tickets` role keeps its restrictions; grant only what the CREOMS spec explicitly needs (read of the new columns and events, the claim, hold, escalate and assign writes, the Claimer's read marker, and Staff Message and attachment inserts).
- **Deployment order.** (1) Migration and role grants, with the old job disabled; (2) Customer actions, sweep and emails behind the migration; (3) storefront UI. The CREOMS spec depends on step 1 and ships after it. The migration must keep the live CREOMS working until its PRs land.
- **Missing screens in scope, built from existing components and styles, no Figma edits:** Mark as Resolved with optional rating, Reopen Ticket with its Message field, the 24-hour warning banner, the "Closed — Customer inactivity" banner, unread and Seen marks, and the up-to-three-image composer.

## Testing Decisions

- A good test checks behaviour a person can see (what status a Ticket ends in, who is emailed or notified, what a Customer can open), never how it is built. Time is controlled with the injected clock and explicit sweep calls; no test waits in real time.
- **Seam 1, the Ticket store** against PGlite with real migrations and injected clock, email sender, relay, gateway audit port and file storage. Prior art: the existing Ticket store, schema, auto-complete route and attachment tests. Covers status rules, the full deadline matrix (start, never extended, cleared, held, Claimer unavailable, release, resume, once-per-cycle warning, stale-warning drop), Mark as Resolved and ratings, Reopen on both Resolved and Closed and for repeats, refusals once deletion has begun, atomic Messages and orphan cleanup, read markers, audit events and privacy, the four emails and their failure handling, and the migration mapping including reruns and the review flag.
- **PGlite limits.** PGlite is single-connection and cannot prove concurrent row locking. Concurrency of the sweep and of competing claims is verified against a real Postgres (a Neon branch or a test container) in a separate, clearly named test; PGlite tests must not claim that coverage.
- **Ownership and access.** Tests at the existing server boundary check that a Customer cannot resolve, reopen, read images of, or send to another Customer's Ticket, and that the Actor comes from the session.
- **Live behaviour.** Tests drive the relay fake for live delivery, reconnect refetch and read-marker updates, and assert there is no polling or fetching effect (extending the existing no-polling and live-update tests).
- **Compatibility.** A test runs the migration against a database in the old shape, then runs the old CREOMS read paths to prove the ecommerce-first deployment does not break them, and reruns it.

## Out of Scope

- The unread-reply email (needs presence and delayed delivery); a separate follow-up.
- PDFs or other attachment types; more than three images.
- Customer data retention and deletion policy: the repo's current rule (hide, keep, no purge) is unchanged here, and the conflict with the earlier 7-day idea is tracked separately.
- The Order assistant, Feedback, Returns and any change to the Service level targets.
- Staff-side screens and actions (see the CREOMS spec).
- Editing Figma.

## Further Notes

- The old daily auto-complete and its two emails (completed, auto-completed) stop applying; the thank-you flow tied to Completed is retired with it.
- Staff-resolved Tickets from before the change are never re-labelled as Customer resolutions.
- Not published to the issue tracker, at the owner's request.
