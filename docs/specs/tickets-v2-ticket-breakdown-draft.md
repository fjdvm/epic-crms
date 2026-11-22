# Tickets v2 breakdown: DRAFT, not published

Parents: Ecommerce spec #632, CREOMS spec #633. Nothing here is on GitHub yet.

## Dependency graph

```
E1 ─┬─> E2 ─┬─> E3 <── E5 <── E1
    │       └─> E4 ──> C6
    ├─> E5 ──> C4
    ├─> E6 ──> C5
    └─> C1 ─┬─> C2 ─┬─> C3 ──> C5
            │       ├─> C6 (also needs E4)
            │       └─> C7 (also needs E3)
            ├─> C4 (also needs E5)
            └─> C8 (also needs E2, E3, E4)
```

Blocking edges, one line each:

- E1: none
- E2: E1
- E5: E1
- E6: E1
- E3: E2, E5
- E4: E1, E2
- C1: E1
- C2: C1
- C3: C2
- C4: C1, E5
- C5: C3, E6
- C6: C2, E4
- C7: C2, E3
- C8: C1, E2, E3, E4

Publication order (blockers first): E1, E2, E5, E6, E3, E4, C1, C2, C3, C4, C5, C6, C7, C8. Native GitHub blocking dependencies plus a `Part of #632` or `Part of #633` parent line.

## Shared preamble (copied into every ticket)

**Our settled requirements override conflicting Figma behaviour.** Where the Figma still shows Staff resolving, "Not fixed", Follow-up tickets, "closes in 3 days", the old tabs, "Support replies — always on" or one-image Messages, build what the spec says. A screen marked "no frame" is in scope: build it from existing components and styles, and never edit Figma.

Figma files (read with the Figma MCP, file keys below; before building, read the dark note card beside each CREOMS screen and follow the CREOMS role rules):
- CREOMS foundation: https://www.figma.com/design/76nS6Pw2TXA6fWfUvTmzJ1/?node-id=836-11278
- CREOMS reference: https://www.figma.com/design/76nS6Pw2TXA6fWfUvTmzJ1/?node-id=0-1
- Roles & access: https://www.figma.com/design/76nS6Pw2TXA6fWfUvTmzJ1/?node-id=577-10412
- Storefront redesign: https://www.figma.com/design/eylSWUgpECPu1EjkFHNvUN/?node-id=4-5 (also 4-2)

Note cards found (CREOMS file): Tickets list, Ticket detail and Conversations carry "Who can open: Staff · Manager · Admin (view) · CEO & VP (view)"; the Escalate dialog says "Staff (claimer only) · Manager"; Reports · Tickets says "Manager · Admin (view) · CEO & VP (view)". The Staff and Manager pages mirror each other.

Frames (CREOMS file `76nS6Pw2TXA6fWfUvTmzJ1`, `?node-id=` with the colon as a dash):
- Staff page: Tickets list 1459:16976, Ticket detail 1459:17298, Hold dialog 1461:17194, Escalate dialog 1461:17552, New ticket dialog 1461:17903, Conversations inbox 1461:18281, Phone ticket 1464:18578, Open conversation button 1465:32921, New ticket alert 1449:14162.
- Manager page: Tickets list 1465:17948, Ticket detail 1465:18153, Reassign dialog 1469:18764, Escalated to you 1469:19459, Conversations inbox 1465:19097, Reports · Tickets 1469:20306.

Frames (storefront file `eylSWUgpECPu1EjkFHNvUN`, page 4:5): Support conversation 23:483, New ticket 25:342, Ticket from assistant 161:2001, Resolved → confirm & rate 175:3403, Completed → follow-up 175:3654, Reply notification 25:921, Email preferences 174:3128, Email design 172:3737 and 172:3738.

Every ticket also follows: the Roles and permissions rule, Instant UI (optimistic only for reversible actions; Customer resolve and reopen wait for the server with a spinner within 100 ms, Manager decisions and emails are never optimistic), no polling or fetching effects, a confirm dialog before any submit, and the Checks and PR completion rules. Ticket Audit Event privacy: never a Message body, email, phone, image or signed link. Each PR says "Part of #<parent>", never "Closes".

## Ecommerce tickets (label `storefront`)

### E1: Migration, five statuses and legacy mapping
**Blocked by:** none. **Figma:** 23:483, 175:3403.
**What to build:** Existing Tickets move to the five statuses through an additive, rerunnable migration, and the storefront and live CREOMS keep working. Customers see the status of each Ticket and "We're on it" for On hold, never the reason.
- [ ] Open with no customer-visible Staff response stays Open; Open whose last Message is the Customer's after a Staff response becomes Awaiting Staff Reply; Open whose last Message is Staff's becomes Awaiting Customer Reply with a fresh 72 hours from a recorded cutover time, never backdated.
- [ ] Intake descriptions, internal notes and AI drafts never count as Staff responses.
- [ ] On hold or unavailable Claimer keep their overlay with a paused 72-hour allowance.
- [ ] Old Resolved stays Resolved as a Legacy resolution, no deadline, no invented Customer resolution; old Completed becomes Closed with Legacy completion and its dates; Follow-up links and ratings kept; Tickets whose history cannot decide are flagged for review.
- [ ] The old daily auto-complete job and its completed emails are disabled (safe on its own: nothing closes in the gap).
- [ ] Rerunning the migration never resets a deadline, duplicates a warning or overwrites later activity.
- [ ] The `creoms_tickets` role gets only the grants the CREOMS spec needs, nothing broader.
- [ ] Test: migration on a database in the old shape, rerun, and live CREOMS reads still pass (ecommerce-first compatibility).

### E2: Customer Mark as Resolved with a rating
**Blocked by:** E1. **Figma:** 175:3403, 25:921, emails 172:3737 and 172:3738.
**What to build:** After Staff's first customer-visible response a Customer can mark their Ticket Resolved, with an optional once-per-resolution rating, and get a confirmation.
- [ ] Button appears only after a real Staff response; absent before.
- [ ] Optional 1 to 5 stars and comment, never blocks resolving, never edited, one per resolution.
- [ ] Resolved stays Resolved indefinitely; Resolved and Closed chats are read-only.
- [ ] Resolved email through Notification in the established design, plus an in-app notice; failed send never reverses the change; outcome audited once by Notification.
- [ ] The Customer's Ticket Audit Event is written here with the signed-in Customer as Actor.
- [ ] No Staff alert is raised; "closes in 3 days" wording removed.
- [ ] Only the Customer's own Ticket can be resolved (other Customer's id is refused at the server).

### E5: Up to three images and atomic Messages (storefront)
**Blocked by:** E1. **Figma:** 25:342, 23:483.
**What to build:** The storefront composer and server accept up to three JPG or PNG images (5 MB each) per Message, saved whole or not at all, with private images.
- [ ] Real-content checks server-side; same refusal wording as CREOMS; clear client messages.
- [ ] Text, images or both, never neither; old single-image Messages unchanged.
- [ ] Message saved only after every upload passes; failure shows "Message not sent", keeps the draft, publishes no text, link, alert or reply event, and cleans up orphan uploads.
- [ ] Images are Private; opened by short-lived links after an ownership check on every request; link never stored or audited; hidden, not purged, for a deleted Customer.
- [ ] Shared attachment contract documented for CREOMS (C4).

### E6: Customer read marker, unread and Seen
**Blocked by:** E1. **Figma:** 23:483.
**What to build:** Customers see unread Staff replies and "Seen" under their Messages.
- [ ] Customer marker advances only through Messages actually displayed, never from a background update; later arrivals stay unread.
- [ ] A Claimer marker exists per Ticket and can be written only by the Claimer's CREOMS session; a reset on reassignment keeps Seen marks the Customer already saw.
- [ ] Live over the existing relay with refetch on reconnect; no polling or fetching effects.
- [ ] Reading changes no status, deadline or alert and creates no Audit Event.

### E3: Reopen Ticket; retire "Not fixed" and Follow-up
**Blocked by:** E2, E5. **Figma:** 175:3654 (replaced by Reopen), 23:483; the Reopen composer has no frame.
**What to build:** A Customer reopens a Resolved or Closed Ticket by sending a Message (text, up to three images, or both) and the same Ticket comes back.
- [ ] Message required and subject to the atomic attachment rules from E5.
- [ ] Same Ticket and Conversation, all history kept; becomes Awaiting Staff Reply; old deadline cleared; no time limit; repeat reopenings each their own occurrence.
- [ ] Eligible Claimer kept; a Claimer who is deactivated or lacks the Tickets Module sends it to Unclaimed.
- [ ] Reopened email and in-app notice to the Customer; Ticket Audit Event (Customer Actor); each occurrence deduplicated, not each resolution.
- [ ] "Not fixed" and "Start a follow-up" removed; any old route goes through the same validated reopen and cannot skip the Message; old alerts, audit records and Follow-up links stay readable.
- [ ] Refused once account deletion has begun; deletion is blocked, naming each Ticket, while any Ticket is not Resolved or Closed.
- [ ] Customer can reopen only their own Tickets.

### E4: 72-hour deadline, 15-minute sweep, warning and automatic closure
**Blocked by:** E1, E2. **Figma:** 175:3403, email 172:3737; the warning and "Closed — Customer inactivity" banners have no frame.
**What to build:** A Ticket the Customer stops answering closes after 72 hours, with a 24-hour warning, all as one working unit.
- [ ] Deadline starts only with the first customer-visible Staff response while Awaiting Customer Reply; further Staff messages never extend it; a Customer Message clears it and makes the Ticket Awaiting Staff Reply; the next Staff response starts a fresh cycle.
- [ ] Never runs for Open or Awaiting Staff Reply, so a Customer waiting on Staff is never closed; Staff-created intake stays Open until a genuine response.
- [ ] On hold and Claimer unavailable pause it with the time saved; resume only if still Awaiting Customer Reply and no pause applies; release alone creates nothing; a Customer Message ends a hold and discards the saved time; existing hold, release, escalation and Service level behaviour is preserved.
- [ ] Server sweep every 15 minutes (up to 15 minutes late accepted); locks and rechecks each Ticket before acting; persists the notification work transactionally and sends outside the lock; one warning per cycle, sent by email and in-app, dropped if stale.
- [ ] Closed — Customer inactivity with its email, notice, banner and system-process audit event; email outcomes owned by Notification.
- [ ] Deployment guard: the sweep refuses to run until the old auto-complete is confirmed off, and enabling it is a checklist step in the PR.
- [ ] Concurrency of the sweep is verified on a real Postgres in a separately named test; PGlite tests do not claim row-lock coverage.
- [ ] Tests use the injected clock and explicit sweep calls, no real waits.

## CREOMS tickets

### C1: Five statuses, pills and the four Tickets tabs
**Blocked by:** E1. **Figma:** Staff 1459:16976 and 1459:17298, Manager 1465:17948 and 1465:18153, Roles & access 577:10412.
**What to build:** The Tickets page uses the new statuses and tabs with role-correct visibility.
- [ ] Tabs Unclaimed, My Tickets, All open and Resolved & Closed with counts that follow the list's visibility; Staff and Managers see My Tickets; All open for Manager, Admin, CEO (Admin read-only), with the Claimed by filter; Legacy completions appear under Resolved & Closed.
- [ ] Awaiting Staff Reply, Awaiting Customer Reply, On hold, Escalated and Claimer unavailable are pills and filters.
- [ ] Resolve button, Completed and "Waiting on customer" removed; Overdue now means Open or Awaiting Staff Reply with the Customer's last Message unanswered past the first reply target.
- [ ] Any Staff can open any Ticket read-only; only the Claimer sees reply, hold, release and escalate; non-Claimers see no Resolve, Release or Reassign.
- [ ] Ticket detail shows Customer, subject, description, status, Claimer, Linked order, images, timestamps, ratings (read-only) and Open conversation.
- [ ] Tab and action access enforced on the server; immediate loading state on each page.

### C2: Assign, Reassign and the reply rule
**Blocked by:** C1. **Figma:** Reassign dialog 1469:18764, New ticket dialog 1461:17903; the Assign dialog has no frame.
**What to build:** A Manager can Assign an Unclaimed Ticket; only the Claimer replies.
- [ ] Assign: Manager only, eligible Staff with the Tickets Module, optional note, moves it to the assignee's My Tickets, audited with the Manager as Actor.
- [ ] Reassign keeps its required reason and stale-Claimer check and now also covers Closed Tickets (refused); Conversation and history preserved.
- [ ] Only the current Claimer can reply, only on an active Ticket; a Manager takes ownership first; other Staff cannot Claim an Assigned Ticket; Admin see no actions.
- [ ] C2 owns the Assign and Reassign notifications (assignee, and previous Claimer on Reassign); C7 only verifies them.
- [ ] A Staff-created Ticket starts Open and Claimed by its creator.

### C3: Conversations tabs (Mine, Unclaimed, All)
**Blocked by:** C2. **Figma:** Staff 1461:18281, Manager 1465:19097, Phone 1464:18578, 1465:32921.
- [ ] Mine (Staff, Manager), Unclaimed (everyone with the Module), All (Manager, Admin, CEO, read-only for Admin), each enforced on the server.
- [ ] Claim, and for Managers Assign, from an Unclaimed chat's header.
- [ ] Resolved and Closed chats are read-only with a note that the Customer can reopen on the storefront; browsing never marks anything read.

### C4: Three images and atomic Messages for Staff
**Blocked by:** C1, E5. **Figma:** 1461:18281, footer 1465:32947.
- [ ] Reply composer takes up to three JPG or PNG images (5 MB), with the same wording as the storefront; saved whole or not at all with "Message not sent" and the draft kept; Customer images visible in the thread through short-lived links after an access check.

### C5: Claimer unread and Seen
**Blocked by:** C3, E6. **Figma:** 1461:18281.
- [ ] Unread counts only on the viewer's own Claimed Tickets; the marker advances only when the Conversation is displayed, only for the Claimer's own session; viewing a Ticket page, an Unclaimed chat or someone else's never marks read; new Claimer starts with every Customer Message unread while the Customer's Seen marks stay; live events and reconnect, no polling; reading is not audited.

### C6: Claimer unavailable
**Blocked by:** C2, E4. **Figma:** none (pill from list and detail components).
- [ ] Flag when the Claimer is deactivated or loses the Tickets Module, tracked separately from On hold; one alert per incident to Managers with the Tickets Module; audited.
- [ ] Uses E4's pause and resume contract and the same closure safeguards: pauses any running deadline, blocks closing, and resumes after Assign or Reassign to an eligible Staff member only if still Awaiting Customer Reply and no other pause applies; a Customer Message clears the deadline but not the flag.

### C7: Lifecycle alerts
**Blocked by:** C2, E3. **Figma:** 1449:14162.
- [ ] Reopen alerts the Claimer, or every Manager with the Tickets Module while Unclaimed; "Not fixed" alerts are retired but old ones stay; a Customer marking Resolved raises no Staff alert (the Customer still gets the email and in-app confirmation from E2).
- [ ] Verifies the Assign and Reassign alerts from C2 are delivered exactly once; no duplicate sends.
- [ ] CREOMS writes no Customer lifecycle audit events; ecommerce owns them.

### C8: Ticket reports on the new definitions
**Blocked by:** C1, E2, E3, E4. **Figma:** Reports · Tickets 1469:20306 (note: Manager · Admin (view) · CEO & VP (view)).
- [ ] Resolved counts Customer resolutions; resolve time from creation to the first resolution and from each reopen to the next, with the pause rules; Reopen rate by episode, each counted once, historical Follow-ups once and never beside a Reopen.
- [ ] Closed by inactivity shown separately, excluding Legacy completions, share = inactivity closures over all resolution and closure outcomes.
- [ ] Resolved credited to the Claimer at resolution; inactivity closures shown as assigned at closure; average rating from submitted ratings only; history, ratings and attribution preserved; no Customer resolution invented for Legacy records.

## Readiness for `ready-for-agent`

All fourteen are fully specified. Items I'd flag for your decision before publishing:
1. **E4 deployment step.** Enabling the sweep is a human checklist step (confirm the old job is off). I'd still label E4 `ready-for-agent` and make the guard part of its acceptance criteria.
2. **Real-Postgres tests** (E4, C2) need a Neon branch or container that the agent can reach; if it can't, those two tickets need `ready-for-human` for that step.
3. **E1 migration numbering.** The ecommerce branch I looked at stops at migration 0026 while CREOMS docs mention 0040; the agent must start from the current ecommerce main, not that branch.
