# CREOMS

A staff-facing CRM for an ecommerce store. Staff use it to see who their customers are and how those customers interact with the store.

## Language

**Staff**:
A person who signs in through the central portal and works in CREOMS. The portal calls the same person a User. Never a Customer. Each Staff member has one Role.
_Avoid_: User, admin

**Portal**:
The central sign-in site that Staff sign in through and are sent into CREOMS from. It decides who may open CREOMS and which of its Modules. Signing out of CREOMS signs the Staff member out of the Portal and every other Bren Raphael's system.
_Avoid_: Auth app, login site

**Module**:
A feature area of CREOMS that the Portal grants or revokes per Staff member, such as Customer Profiles. Each CREOMS page belongs to exactly one Module. The Customer Profiles Module is the permission to open the Customer Profiles pages; it is not the Customer Profile itself. The Tickets Module covers both the Tickets and the Conversations pages, since they show the same Tickets. The Feedback Module covers the Feedback page and is separate from the Tickets Module. Orders work is split across three Modules: Orders (view Orders, quote the Delivery fee and confirm, cancel), Payments (check Payment proof and mark an Order paid) and Fulfilment (`preparing`, `dispatched`, `delivered`, `ready for pickup`, `collected`). The Returns Module covers Returns reads and decisions. The Management Module covers the Payment Management and Delivery Management tabs under the Management label; only a Manager or the CEO can hold it, and Staff and Admin cannot open those pages. The Orders, Payments, Fulfilment and Returns pages each belong to their own Module, but the Order detail page opens for Staff with any of the four; it is the one exception to "one page, one Module". Staff see only the actions their Modules allow. The Dashboard Module covers the Dashboard page, which opens for Staff who hold it; each widget on it shows only if Staff also hold the Module of the data it summarises. The Dashboard is where `/` lands for Staff who hold it.
_Avoid_: Permission, feature, role

**Customer**:
A person who signed up and verified their email.
_Avoid_: User, account, contact

**Lead**:
A person who signed up but has not yet verified their email. Becomes a Customer on verification. Leads belong to a separate module, not Customer Profiles.
_Avoid_: Unverified customer, prospect

**Customer Profile**:
Everything staff can see about one Customer in one place: their details, orders, cart, notes and tasks. A Customer's own changes to their name, Contact number and Addresses are saved at once and stay after refresh and sign-out; each save records one "profile_updated" audit event listing the names of the fields changed (never the values), and a save that changes nothing records nothing.
_Avoid_: Contact, account, user

**Customer note**:
A piece of free text a Staff member writes about a Customer on their Customer Profile, with the Staff member's name and the date. Permanent once written: never edited or deleted; a mistake is corrected with a new Customer note. Always called a Customer note, never just "note". A phone call is written up as a Customer note. Not a Message (which belongs to a Conversation and is sent to the Customer) and not a Ticket's internal note.
_Avoid_: Note, Message, comment, Profile note

**Task**:
A follow-up a Staff member must do for a Customer, written on their Customer Profile. It has an owner, a required due date and a done state, which is what separates it from a Customer note. The owner is the Staff member who created it; only a Manager can assign or reassign it to someone else. The due date is a date only, in Philippine Time. The owner or a Manager can change the due date, mark it done and reopen it. Its description is fixed and it is never deleted; a Task no longer needed is marked done. It is overdue once its due date has passed and it is not done.
_Avoid_: Reminder, to-do, follow-up

**Deleted Customer**:
A Customer who deleted their account on the storefront. ("Account" here always means the sign-in login, never the Customer Profile.) Their Customer Profile is soft-deleted: login is disabled and they vanish at once from the Customer List, Customer Details and the Dashboard's Customer figures for every role, while every Order, Ticket, Return and Feedback record is kept and shown with a "Deleted customer" tag, no contact details and no profile link. Sales and Total spent are unaffected. A Customer can delete only with no Order from `placed` to `dispatched`, no Requested or Approved Return and no Ticket that is not yet Resolved or Closed. A deletion request that is refused names every blocking Order, Return and Ticket. Deleting sets the profile's deleted time, refuses the login from then on and records one "account deleted" Audit Event with no email address; no data is deleted or nulled. The Customer asks from Account settings: a confirm dialog comes first, then a spinner (deleting is not optimistic), and a refusal lists each blocking Order, Return and Ticket. The data is kept, hidden, indefinitely: there is no purge. Staff cannot delete or restore a Customer.
_Avoid_: Removed customer, purged customer

**Welcome email**:
The one email a new Customer gets when they sign up, in the shop's email design. It is claimed once per Customer id, so a retried or double-submitted sign-up never sends a second one, and a failed send never fails sign-up. Each outcome, sent or failed, is recorded once in the audit trail as a `welcome_email` event; a failure carries its reason, and no event holds an email address. A Returning Customer gets a welcome-back email instead.
_Avoid_: Greeting email, onboarding email

**Returning Customer**:
A Deleted Customer who signs up again with the same email and verifies it. ("Account" means the sign-in login.) ("Account" means the sign-in login.) The same Customer Profile and history come back, the new password replaces the old one, Customer since is unchanged, and they get a welcome-back email instead of a second welcome, sent once per return when the profile is restored (never at sign-up, never before verification) and audited as a `welcome_back_email` event, sent or failed, with no email address. Signing up again removes the old login through Neon's management API and creates a fresh one with the new password (needs `NEON_API_KEY`, `NEON_PROJECT_ID` and `NEON_BRANCH_ID` on the storefront). The profile is restored only after the email is verified, moving to the new login id with every record that pointed at the old one; the audit trail records one "Customer returned" event with no email address. Not to be confused with a Returning Buyer, a Dashboard term about Orders.
_Avoid_: Reactivated customer, new customer

**Customer since**:
The date a Customer first signed up. It is the sign-up date, not the date they verified their email. Signing up creates the login and exactly one linked Customer Profile (unique per login and per email, safe to retry) and records one "registration" audit event with no email address. Every sign-up field blocks characters it never allows (typed or pasted) and shows its message as the Customer leaves it, using the same rules as the server.

**Total spent**:
The sum of a Customer's Order totals (subtotal plus delivery fee) for Orders that have been paid for or fulfilled: `paid`, `preparing`, `dispatched`, `delivered`, `ready for pickup`, `collected` and `received`, minus Refunded Return amounts. Returns still in progress, Replaced Returns, Declined Returns and Customer-cancelled Returns do not reduce it. Cancelled and merely placed or confirmed Orders do not count.
_Avoid_: Revenue, lifetime value

**Sales**:
The Dashboard's money figure for a period: the sum of Order totals for Orders placed in that period that count toward Total spent, minus Refunded Return amounts. Uses the same rule as Total spent, but across all Customers and bucketed by the date the Order was placed, in Philippine Time.
_Avoid_: Revenue

**Buyer**:
A Customer with at least one Order counted in Sales in a period. A Buyer is Returning if they had an Order counted in Sales before the period began, and New if their first such Order falls inside it. A Buyer who orders twice in the period is counted once, as New or Returning by their first.
_Avoid_: Shopper, repeat customer (Stage already uses Repeat)

**Dashboard**:
The page of business figures Staff see at a glance: Sales, Orders, Average order, Returning Buyers and Average rating for a chosen period, each compared with the previous period of equal length; the last six months of Sales; a Needs attention list of work waiting on Staff; and breakdowns of products, Buyers, payment and how Orders are received, and Customers. Figures are in Philippine Time. Customers by Stage and At risk Customers are always as of today and ignore the chosen period. Staff can export what they are looking at as a PDF; it holds only what the Dashboard shows that Staff member.
_Avoid_: Analytics, report page, overview

**Order**:
A Customer's request to buy, placed on the storefront. CREOMS never creates an Order, apart from a Replacement Order a Manager approves: it shows the storefront's Orders and lets Staff move them forward. The storefront owns the Order and its rules; CREOMS asks it to make each change so the rules and the Customer's emails stay in one place.
_Avoid_: Purchase, transaction

**Order status**:
Where an Order is in its life: `placed`, `confirmed`, `awaiting payment`, `paid`, `preparing`, `dispatched`, `delivered`, `ready for pickup`, `collected`, `received` or `cancelled`. A Delivery Order goes `preparing`, `dispatched`, `delivered`, `received`; a Pickup Order goes `preparing`, `ready for pickup`, `collected`, `received`, and neither may enter the other's steps. `collected` is to Pickup what `delivered` is to Delivery: the two are the same fulfilment milestone for every rule, and `collected_at` stands in for `delivered_at`. Pickup Orders that were already `dispatched` or `delivered` before this change keep those statuses. On screen, for Customers, Staff and emails alike: `preparing` is Preparing, `dispatched` is Out for delivery, `ready for pickup` is Ready for pickup and `collected` is Picked up; Staff press Mark paid and Reject proof on a payment proof. Stored statuses keep their names. Only the Customer marks an Order `received`; it acknowledges delivery without resetting the Refund window. Pickup and Cash on Delivery Orders skip the payment steps. These are the storefront's statuses; the design's "Pending", "Packed" and "Shipped" mean `placed`, `preparing` and `dispatched`. Payment is part of the status, not a separate field. Staff can cancel an Order up to `preparing`; cancelling a `dispatched` Order needs a Manager's approval with a reason and a plan for the courier, the payment or refund and the stock; dispatched goods go back to sellable stock only once they are physically back and inspected.
_Avoid_: Order state, fulfillment status, payment status

**Delivery fee**:
The courier cost of a Delivery Order, quoted by Staff by hand after the Order is `placed`. Quoting it confirms the Order. A Pickup Order has none.
_Avoid_: Shipping fee, shipping

**Payment proof**:
The reference number and the screenshot a Customer submits for an Order paid by GCash, Maya or bank transfer. All three are manual: the Customer pays outside the shop and Staff check the proof by hand. Staff with the Payments Module check it and either mark the Order `paid`, reject it with a reason, or cancel the Order. A Customer whose proof is rejected may submit another; every proof and rejection is kept. The proof carries its own review outcome (Pending, Verified or Rejected); the Order has no separate payment-status field. On screen: **Awaiting Payment** is `awaiting payment` with no proof, or a replacement required; **Pending Verification** is `awaiting payment` with a proof submitted and not yet decided (a label only, not a status); **Verified** describes the proof decision and moves the Order to `paid`; **Rejected** keeps the Order at `awaiting payment`, records the reason and sets a new payment deadline. The third rejected proof stops Customer submissions, shows the Customer the reason and "Your payment is under Manager review", and starts a Manager payment review: every Manager with the Payments Module is alerted, one Manager takes it with an explicit Claim Review (opening the Order does not claim it; it can be reassigned and each owner is audited), and the Manager either verifies the actual transfer and marks the Order `paid`, or cancels it and releases the stock. The review has a deadline, an Admin setting, default 48 hours from the third rejection; after it the review is flagged Overdue, stays on the Managers' Needs attention list and alerts repeat until resolved. Nothing is cancelled automatically and the stock stays reserved until a Manager acts, because the Customer may really have paid. A Customer's proof now needs both a reference number and an image; proofs submitted earlier without an image stay valid. After 3 rejected proofs only a Manager can approve the Order. A reference already used on another Order stops "Mark paid" for Staff; a Manager can approve it anyway with a reason, and the approval must settle which Order the transfer pays, since one transfer never pays two Orders. Correcting what the Proof reader read needs a reason but never bypasses a Manager for a reused reference or a third rejection.
_Avoid_: Receipt, payment confirmation

**Payment proof check**:
An advisory comparison of the Customer-confirmed amount, payment date, recipient and reference against the Order and the shop Payment account. A Proof reader also reads the proof image itself (amount, date, reference, recipient, account number where visible) and adds a Match, Mismatch, Missing or Needs Review finding for each. Each check gives a pass or fail with a reason; Staff still decide whether to accept or reject the proof.
_Avoid_: AI verification, automatic payment approval

**Refund destination**:
Where a refund is sent: the refund method (GCash, Maya or bank transfer), account name, account number and, for a bank, the bank name. The Customer enters it on the storefront when requesting a Return that prefers a refund, reusing details they confirmed before (never a payment proof's recipient, which is the shop), and must confirm it before submitting. It is asked for whenever the Order can be refunded, including a Cash on Delivery Order whose cash was collected, and not for an unpaid one. It locks when the refund is approved; changing it afterwards needs a Manager, a recorded reason and the Customer's confirmation before money is sent. The Customer sees their own; Staff and Managers see the number masked, with the full number only where refund processing needs it. Staff send the refund to this record and never type a different destination. Changes and who approved them are audited with the number masked.
_Avoid_: Refund account, payout

**Proof reader**:
The OCR the owner authorized to run by itself in the background once a payment proof (from a Customer) or a refund proof (from Staff) is saved. It reads the image, compares it with the Order total, the entered reference and the shop's Payment accounts (for a refund, the approved refund amount and the Customer's Refund destination; a masked or unreadable detail is Missing or Needs Review, never an assumed Match), and flags mismatches, missing details, duplicate references and reused images. It never approves or rejects anything, changes any status, or reaches a Customer; only Staff and Managers see its findings, and Staff must verify the real transfer with the payment provider before marking Paid or Refunded. If it fails the proof is kept and shows Needs Review. One result per saved proof; a replacement proof gets its own. It is the second place AI runs without a Staff press, an exception the owner agreed, after the Order assistant.
_Avoid_: AI verification, automatic payment approval, OCR approval

**Stage**:
A label derived from a Customer's Orders (Replacement Orders do not count), never set by hand: New (no Orders), First order (one Order), Repeat (two or more), At risk (no Order in 60 days), Lost (no Order in 120 days). At risk and Lost take precedence over First order and Repeat.
_Avoid_: Lifecycle, status, segment

**New Customer notification**:
An alert shown to staff the first time CREOMS sees a person has become a Customer, that is, verified their email.
_Avoid_: Sign-up alert

**Ticket notification**:
An alert shown to Staff when a Ticket needs them: a new Ticket (to every Staff member with the Tickets Module), or a new Customer Message (to the Claimer, or to every Staff member with the Tickets Module while the Ticket is Unclaimed). A Customer marking a Ticket Resolved raises none. A Customer reopening a Resolved or Closed Ticket, by whatever path, alerts its Claimer, or every Manager with the Tickets Module while it is Unclaimed. An Assign or Reassign alerts the new Claimer.
_Avoid_: Ticket alert, support alert

**Ticket email**:
One of four emails a Customer gets about a Ticket, each in the shop's email design: the 24-hour warning before the Customer inactivity deadline, Resolved, Closed (Customer inactivity), and Reopened. Each is also shown as an alert on the storefront. A Staff reply reaches the Customer on the storefront only, with no email. Each is claimed once per event occurrence, so a retry never sends twice, while resolving or reopening a Ticket again is a new occurrence and sends again. The 24-hour warning is checked just before it goes: it is dropped unless the deadline is still active and the Ticket is Awaiting Customer Reply, so a Ticket that is On hold, Resolved, Closed or answered gets none. A failed send never blocks or reverses the saved change, and each outcome, sent or failed, is recorded once in the audit trail, with no email address in the event.
_Avoid_: Ticket reminder, auto-reply

**Order notification**:
An alert shown to every Staff member with the Orders Module when any new Order is placed, including Pickup and Cash on Delivery. A Delivery Order waiting for a quote says a Delivery fee is needed. A GCash Order whose Payment proof was just submitted separately alerts every Staff member with the Payments Module. Nothing alerts Fulfilment Staff.
_Avoid_: New order alert, payment alert

**Feedback notification**:
An alert shown to every Staff member with the Feedback Module when a Customer gives Feedback of 1 to 3 stars. Feedback of 4 or 5 stars raises none.
_Avoid_: Review alert, low-rating alert

**Ticket**:
A support request raised by a Customer, or opened by Staff on a Customer's behalf. A separate module from Customer Profiles. A Ticket has no Channel: where a request came from is not recorded.
_Avoid_: Case, email

**Ticket status**:
A Ticket is Open, Awaiting Staff Reply, Awaiting Customer Reply, Resolved or Closed. All five are stored. Open is a Ticket Staff have not yet answered: it stays Open through any number of Customer Messages until the first Staff response. A Ticket Staff open on a Customer's behalf also starts Open and Claimed by its creator; the concern they record is intake, not a response, so it neither starts the Customer inactivity deadline nor allows Mark as Resolved. The first Message Staff send the Customer (a Staff response) makes it Awaiting Customer Reply, starts the deadline and allows Mark as Resolved. After that the Awaiting statuses follow the Messages: a Customer Message makes it Awaiting Staff Reply, a Staff response makes it Awaiting Customer Reply, and nobody sets them by hand. Only the Customer can mark a Ticket Resolved, and only after the first Staff reply; Staff have no Resolve button. Resolved stays Resolved until it is reopened. Closed has a Closure reason (see Customer inactivity deadline and Legacy completion). Resolved and Closed Conversations are read-only until the Customer reopens the Ticket (see Reopen). Assignment is not a status: it is tracked separately as Unclaimed or Assigned through the Claim. On hold and Escalated are Staff-side overlays on top of the status and never replace it. On hold is set only by the Claimer, who picks what they are waiting on (Courier (Lalamove or Grab), Kitchen or IMS, Supplier, Manager decision), an optional Staff-only note, and the date and time it ends. Any Staff see the reason; the Customer sees "We're on it" and never the reason. It ends when that time comes, when the Claimer takes it off hold, when the Claimer releases it, or at once when the Customer sends a new Message. While it lasts it pauses the Customer inactivity deadline. The former Completed status is retired.
_Avoid_: Completed, claimed, cancelled, Waiting on customer (use Awaiting Customer Reply)

**Customer inactivity deadline**:
72 wall-clock hours that start with the first Staff reply while a Ticket is Awaiting Customer Reply. Further Staff Messages, viewing, assignment and reassignment never extend it, and Escalation alone does not pause it. A Customer Message clears it and makes the Ticket Awaiting Staff Reply; the next Staff reply starts a new one. A Ticket Awaiting Staff Reply never has one, so a Ticket the Customer is waiting on is never closed. When it passes with no Customer Message, the Ticket is Closed with the Closure reason Customer inactivity. The Customer is warned once per deadline when 24 hours remain. On hold pauses it and keeps the time left. A hold that ends by its return time, by the Claimer or by release resumes the saved time only if the Ticket is still Awaiting Customer Reply, and release alone never creates a deadline. A Customer Message ends a hold, clears the deadline and discards the saved time, and the next Staff response starts a fresh 72 hours. A Staff response during a hold leaves the hold in place and never extends a paused deadline; if it is the first Staff response, it sets up a paused 72-hour cycle. The warning goes once per cycle, and if a resume leaves 24 hours or less and none was sent, it goes then. A hold's return time only ends the hold and drives Staff filtering; it never resolves or closes a Ticket. A Claimer who is deactivated or loses the Tickets Module is unavailable (see Claimer unavailable), which pauses it the same way and blocks closing until the Ticket has an eligible Claimer; the closing job checks the Claimer's eligibility before it acts. It is a stored deadline closed by a scheduled server job, never a page timer or a fetch on a timer. It is separate from the Service level, which is unchanged.

**Closure reason**:
Why a Ticket is Closed: Customer inactivity (the deadline passed) or Legacy completion. Shown to Staff and Customer as "Closed — Customer inactivity" and "Closed". Never guessed: a Ticket is only labelled Customer inactivity if the deadline closed it.

**Legacy completion**:
A Ticket that was Completed before the Completed status was retired. It is now Closed with the Closure reason Legacy completion, keeping its original completion date and history, and is never labelled Customer inactivity. It can be reopened like any Closed Ticket.

**Legacy resolution**:
A Ticket that Staff marked Resolved before only the Customer could. It stays Resolved with no Customer inactivity deadline and keeps its Staff-resolution origin; no Customer resolution is invented for it. A Ticket that was Awaiting the Customer when the new rules began got a fresh 72-hour deadline from a recorded cutover time, never one dated back to an old Staff message. Only customer-visible Staff responses count: intake descriptions, internal notes and AI drafts do not. A Ticket whose history cannot say who owes the next reply is flagged for review, with no deadline invented.

**Reopen**:
A Customer reopens their own Resolved or Closed Ticket from the storefront by sending a new Message; the same Ticket and Conversation return, with every earlier Message, image and event kept. The Ticket becomes Awaiting Staff Reply and any old Customer inactivity deadline is cleared. There is no time limit. The Claimer stays if still available; a Claimer who is deactivated or no longer holds the Tickets Module is unavailable, and then the Ticket returns to Unclaimed for a Claim or a Manager's assignment. A Ticket cannot be reopened once its Customer has begun deleting their account. Reopening is logged on the Ticket's activity and in the audit trail. The Customer must write a Message to reopen; there is no reopen without one. This is the only way back from Resolved or Closed: the former "Not fixed" action is retired, and its past alerts and audit records are kept. Every reopen is its own occurrence with its own alert, email and audit event, including a Ticket that was closed by Customer inactivity and reopened more than once.

**Linked order**:
The Customer's Order a Ticket is about. Optional: a Ticket can have none, and must be one of that Customer's own Orders. The Ticket list shows "None yet" when there is no Linked order.
_Avoid_: Related order, attached order

**Service level**:
Two targets the Admin sets in Portal Settings: the first reply target (default 24 hours) and the resolve target (default 3 days). They are the same for every Priority and every hour counts. A Ticket takes the pair in force when it was opened and keeps it; a change affects only Tickets opened afterwards. Each Ticket shows time left, Breaching soon (under 1 hour left) or Missed. The clock stops while the Ticket is On hold, and the resolve clock also stops while it is Awaiting Customer Reply. It does not change with the Customer inactivity deadline: the resolve target measures Staff's work, the deadline closes a Ticket the Customer has stopped answering. A missed target is stamped once and never cleared. Manager and CEO see the targets read-only; Staff do not see the screen.

**Overdue**:
A Ticket that is Open or Awaiting Staff Reply, whose last Message came from the Customer (or that has none), and has gone longer than its first reply target without a Staff reply. A new Ticket nobody has answered counts. A Ticket that is Awaiting Customer Reply, Resolved, Closed or On hold is never Overdue. The Dashboard's Needs attention uses the same rule.
_Avoid_: Late, breached

**Priority**:
How urgently a Ticket needs attention: Low, Normal, High or Urgent. Defaults to Normal and is set by Staff.
_Avoid_: Severity, urgency

**Claim**:
Staff take a Ticket for themselves to answer it; Staff never assign a Ticket to someone else. A Manager can assign an Unclaimed Ticket to a named Staff member directly (see Assign). A Ticket has at most one Claimer, the Staff member shown as "Assigned to" in the design; Claim and assignment are the same single ownership, so a Claimed Ticket is Assigned. A Ticket nobody has claimed is Unclaimed. Any Staff can claim an Unclaimed Ticket; only the Claimer can chat with the Customer, a Manager included, so a Ticket must be claimed before it is replied to. Other Staff cannot Claim a Ticket that is already Assigned. A Ticket Staff open is claimed by the Staff member who opened it. Only the Claimer can release a Ticket back to Unclaimed; nobody can take a claimed Ticket from its Claimer, except a Manager, who can reassign it (see Reassign).
_Avoid_: owner, agent

**Assign**:
A Manager gives an Unclaimed Ticket to a named Staff member who holds the Tickets Module, with an optional note and no required reason. The Ticket leaves Unclaimed for that Staff member's My Tickets list, the Staff member gets an alert, and it is logged on the Ticket's activity and in the audit trail. Staff see no button; Admin and CEO only read the history. Moving an already Claimed Ticket is Reassign, which needs a reason.
_Avoid_: Claim (that is Staff taking it themselves), Reassign

**Claimer unavailable**:
A flag on a Ticket whose Claimer's account is deactivated or no longer holds the Tickets Module. It is separate from On hold: the Ticket keeps its Claimer, shows "Claimer unavailable", and every Manager with the Tickets Module is alerted once per incident, which is also audited. It pauses a running Customer inactivity deadline and keeps the time left, and automatic closure is blocked meanwhile. A Manager's Assign or Reassign to an eligible Staff member ends it, and the saved time resumes only if the Ticket is still Awaiting Customer Reply and nothing else pauses it. A Customer Message clears the deadline and makes the Ticket Awaiting Staff Reply but does not clear the flag; the next response from an eligible Claimer starts a fresh 72 hours. Checked on the server, never by a page timer.

**Reassign**:
A Manager moves a claimed Ticket to a named Staff member with a required reason, or moves all of an absent teammate's open Tickets (everything not Closed) to one Staff member after seeing them. Both the previous and the new Claimer get an alert with the reason; each move is logged on the Ticket's activity and in the audit trail. Only a Manager can do it; Staff see no button, and Admin and CEO only read the history. There is no AI split, no move back, no followers and no Priority change with it. The move only happens if the Ticket is still held by the Claimer the Manager saw; otherwise it says someone else changed it first. A Closed or Unclaimed Ticket is not reassigned. Conversation and history are kept across a move.
_Avoid_: transfer, pass

**Escalation**:
The Claimer asks the Managers for help with one reason (Service level about to be or was missed, Money decision, Food safety or possible illness, Customer upset) and a short note. Every Manager who holds the Tickets Module gets an in-app alert; no email. The Ticket shows Escalated until a Manager takes it (becoming the Claimer, through Reassign, so the previous Claimer is told) or sends it back with a note (the Claimer is told). The Claimer stays on the Ticket meanwhile and cannot release it. Only the Claimer escalates, nothing escalates automatically, and each step is logged on the Ticket's activity and in the audit trail. Staff see no Take or Send back button.
_Avoid_: Request approval (that is for actions Staff may not do at all)

**Tickets list**:
The Tickets page's tabs, each with a count that follows the same visibility as its list: Unclaimed (active Unclaimed Tickets, oldest first, for everyone with the Tickets Module), My Tickets (active Tickets I Claimed, for Staff and Managers), All open (every active Ticket, with a Claimed by filter, for Manager, Admin and CEO) and Resolved & Closed (every Resolved and Closed Ticket, Legacy completions included). "Active" means not Resolved and not Closed. Awaiting Staff Reply, Awaiting Customer Reply, On hold and Escalated are filters or pills, never tabs. Any Staff can open another Staff member's Ticket read-only; only the Claimer replies, and Staff cannot release, resolve or reassign it. A Manager keeps their actions (Assign, Reassign) on All open but replies only after becoming the Claimer; Admin and CEO are read-only. The Conversations page has three tabs: Mine (my Claimed active Tickets with unread counts, for Staff and Manager), Unclaimed (active Tickets with no Claimer, for everyone with the Tickets Module) and All (every Conversation, Resolved and Closed included, for Manager, Admin and CEO). Staff and Managers can Claim from an Unclaimed chat's header, and a Manager can also Assign; Admin and CEO only read. Only the current Claimer can reply, and only on an active Ticket. Resolved and Closed Conversations are read-only with a note that the Customer can reopen on the storefront. Browsing an Unclaimed chat or someone else's never marks anything read. Tab access and every action are checked on the server.

**Ticket rating**:
The Customer's optional 1 to 5 stars and comment, offered when they click Mark as Resolved. It is given once per resolution and never edited; skipping never blocks resolving. A Ticket that is reopened keeps every earlier rating, shown read-only, and can be rated again after its next resolution. Staff see ratings on the Ticket page, read-only for every role. It is not Feedback, which belongs to an Order.
_Avoid_: Review, Feedback

**Follow-up Ticket** (retired):
A new Ticket a Customer opened from a Completed Ticket, linked to it. No longer offered: a Customer who needs more help uses Reopen on the same Ticket. Existing links stay readable as "Follow-up of" and "Follow-up:" on old Tickets, and Reports count a historical Follow-up Ticket once, as a reopen, and never also as a Reopen event.
_Avoid_: Reopen (that is the same Ticket)

**Unread**:
A Message the reader has not yet seen in a displayed Conversation. Each Ticket has two read markers, one for the Customer and one for the Claimer; nobody else has one, and other viewers cannot move the Claimer's. A marker advances only through the Messages actually displayed in the Conversation, never when only the Ticket page opens or a live update arrives in the background, so a Message that comes in afterwards stays unread. The Customer sees unread for Staff replies; Staff and Managers see an unread count only on Tickets they Claimed. Under a Customer's Message the Customer sees "Seen" once the Claimer has read it; internal notes and AI drafts are never tracked. A new Claimer starts with every Customer Message unread, while Seen marks the Customer already saw stay. Reading never changes the status, the Customer inactivity deadline or any alert, and is not an Audit Event.

**Ticket Audit Event**:
An Audit Event about a Ticket, written by the service that did the action: the storefront writes the Customer's creation, replies, resolution and reopening with the signed-in Customer as Actor; CREOMS writes every Staff and Manager action (create on behalf, claim, release, assign, reassign, reply, hold, escalate) with that person as Actor; the scheduled job writes automatic closure as a system process; Notification writes each Ticket email's sent or failed outcome, and the caller records separately only a failure before Notification accepted the request. The change and its event are saved together and then delivered with one key per occurrence, so a retry never duplicates it. The Actor always comes from the signed-in server session, never from anything the Customer submits. An event holds the Ticket number, the Message id and an image count where relevant, never a Message body, email address, phone number, image or signed link; a Customer is named by id and display name only. Events are never rebuilt from reading the shared records. Reading is not an event.

**Ticket report figures**:
Resolved counts the Customer's resolution events in the period; a Customer inactivity closure never counts as one. Resolve time runs from creation to the first Customer resolution, and from each Reopen to the next, with the Service level's pause rules. Reopen rate is the Ticket episodes (a resolution or a closure) in the period that were later reopened, over all such episodes, each counted once; a historical Follow-up Ticket counts once and never beside a matching Reopen. Closed by inactivity is reported on its own, excludes Legacy completions, and its share is inactivity closures over all resolution and closure outcomes in the period. Resolved is credited to the Claimer at the moment of resolution; an inactivity closure is shown separately as assigned at closure and is never resolution credit. The average rating uses only submitted ratings, with none made up for closures. Old resolved dates, ratings and attributions are kept as they were, and no Customer resolution is invented for a Legacy completion.

**Ticket number**:
The Ticket's visible reference, written TKT- followed by its number, such as TKT-208.
_Avoid_: Ticket ID, case number

**Message**:
One entry in a Conversation, sent by the Customer or by Staff. Permanent once sent: never edited or deleted. It may carry up to three images (JPG or PNG, each up to 5 MB, content checked on the server); the Ticket's first Message counts too. Older Messages with one image stay as they are. Staff and Customer see each Message's sender and time, and unread Messages are marked. A Message is saved whole or not at all: it needs text, images or both, never neither, and it is saved only after every image has uploaded and passed the checks. If any image fails, the Customer or Staff member sees "Message not sent", keeps the draft to retry, and nothing is published: no text, image link, alert or reply event. Images from a failed attempt are cleaned up. An image can be opened by anyone who may open its Ticket, Resolved and Closed Tickets included, through a short-lived link made after an access check on every request; the link is never stored or audited. Images are kept permanently, but a deleted Customer's Tickets are hidden with the rest of their data and cannot be reopened.
_Avoid_: Reply, comment, note

**Feedback**:
A Customer's rating (1 to 5 stars) and comment about one delivered Order, given once and never edited. It belongs to the Order, not to a product: a product's Feedback is the Feedback of every Order that contained it. Seen only by the Customer in their Order history and by Staff in CREOMS, never public. It never opens a Ticket by itself: a Ticket is raised only by a Customer or Staff. Staff do not reply to it; the Customer is thanked by email.
_Avoid_: Review, testimonial, rating (alone)

**Sentiment**:
A label of positive, neutral or negative that an AI gives one Feedback from its comment. Staff-facing only and never shown to the Customer. Feedback has none until it has been analysed.
_Avoid_: Mood, score, tone

**Top product**:
The product the AI judges best liked, from the Feedback of the Orders that contained it, shown with its Feedback count and a one-line reason. Only products with at least 5 Feedbacks can be chosen. A product has no rating of its own.
_Avoid_: Best seller, best rated

**AI suggestion**:
Anything an AI offers Staff to look at: a Ticket's suggested Category and Priority, a Ticket summary, a Drafted reply, or Complaint themes. It is only ever shown to Staff, and only runs because a Staff member asked for it, by pressing a button or by opening the page that shows it (a Ticket summary, an alert's explanation, Complaint themes); the result is kept and shown again on later visits, and nothing runs by itself or on a timer. It never reaches a Customer and never changes a Ticket, Order or payment until a Staff member acts on it. The AI sees only the text the feature needs, with emails and phone numbers masked, and exactly what it saw is kept and shown. When Staff use a suggestion, the Audit Event names that Staff member.
_Avoid_: AI decision, auto-reply, automation

**Ticket summary**:
A few lines an AI writes about one Ticket's thread, so Staff or a Manager who opens it can catch up quickly. It is made when a Staff member or Manager opens the Ticket and is then kept; it is made again only when a new Message has arrived since and a Staff member opens the Ticket. Admin and CEO see the kept summary and never cause one to be made. Claimer or not, anyone who can open the Ticket sees it. It is read-only and is never sent to the Customer.
_Avoid_: Recap, digest

**Drafted reply**:
A reply an AI writes for the Claimer, the only Staff who can reply, from the Ticket's last Messages and the status, courier, dates and payment kind of its Linked order; never the address, phone or email. The Claimer picks English or Taglish, and can make it shorter, discard it, or use it in the Conversation. Facts such as the tracking link and dates are put in from the Order's record, and a draft that contradicts the record is not shown. It promises no refund or replacement, and says a teammate will confirm when unsure. It never overwrites what the Claimer has already typed without a confirm. Nothing is sent until the Claimer presses Send; the Audit Event records whether it was sent as drafted or edited.
_Avoid_: Auto-reply, canned reply

**Complaint themes**:
Up to five groups of similar complaints an AI finds in a chosen period, each with a short label and a count and links to the Tickets, Returns and Feedback (1 to 3 stars) behind it, such as "leaking pouch on the 500 g". They sit on the Feedback page for Managers and are made when a Manager opens it for a period that has none yet; a Refresh button makes new ones. The counts and links come from the records, not from the AI; a group needs at least 3 items, each item is in one group, and one Customer counts once per group. The last result is kept with the period, the time and how many Tickets, Returns and Feedback were read, and Admin and CEO can read it. Staff do not see it.
_Avoid_: Trends, insights, alerts

**Order assistant**:
A chat on the storefront's Support page and My orders where a signed-in Customer asks about their own Orders (status, payment, pickup, courier link, delivery fee estimates) and about the shop (product details, hours, rules). The Customer's questions are answered by an AI from the live records, with the facts shown by the system itself; it never changes, cancels or refunds anything, never promises a refund, discount or replacement, and never reads another Customer's Order. It hands over to a person, as a Ticket with the Order as its Linked order, when the Customer asks for one, the question is about damaged, spoiled or wrong items, food safety, refunds, discounts or replacements, or it cannot answer from the records. Staff can mark an answer wrong, with a reason; a Manager sees those and the counts. It is the one place an AI writes words a Customer reads without a person reviewing them, an exception the owner agreed.
_Avoid_: Chatbot, bot

**Handoff summary**:
The short account of the Order assistant's chat that the Customer sees and sends to the team when they ask for a person, so they do not repeat themselves. It states facts from their own chat and the Order's record and promises nothing. It is attached to the Ticket it opens, separate from the Staff-facing Ticket summary.
_Avoid_: Chat summary

**Unusual activity**:
Up to five cards on the Dashboard, each shown to Staff who hold the Module of its data: Unverified payments over a limit, a spike of Returns on one product, Failed deliveries piling up, or a Customer at or near 3 rejected Payment proofs. Fixed rules in the system decide that something is unusual and give its numbers and links; an AI only writes the "why" and "what to do", made the first time a Staff member opens the Dashboard while it exists and kept, and made again only if the numbers get worse. Staff can dismiss one for themselves, and it comes back only if it gets worse. It is never sent to a Customer and changes nothing.
_Avoid_: Anomaly, alert (a Notification word)

**Feedback request**:
The one email and in-app Notification sent to a Customer 2 days after an Order is marked Delivered (or Picked up, for Pickup), linking to that Order's Feedback form. Sent once per Order, with no reminder, and not sent if the Customer has already given Feedback.
_Avoid_: Survey, review request

**Conversation**:
The live two-way chat inside one Ticket, between its Customer and Staff. Every Conversation belongs to exactly one Ticket; there is no chat without a Ticket. The Conversations page is Staff's inbox of these chats, and the Ticket page shows the same chat.
_Avoid_: Chat thread, inbox message, Messenger or Instagram chat


**Return**:
A Customer's request to have one or more whole Order line items refunded or replaced. The storefront owns it; CREOMS reads it and asks the storefront to make Staff decisions. It has a Return number (`RMA-` followed by its number) and is Requested, Approved, Goods received, Refunded, Replaced, Declined or cancelled by the Customer while Requested. Refunded, Replaced and Declined are final. A Return never changes its Order's status. On screen, **Pending Review** is `Requested`, **Rejected** is `Declined` (the Customer sees the reason), **Awaiting Return** is `Approved` once every required approval is in, and **Returned** is `Goods received`; these are labels only, and APIs and stored records keep the existing status names. Return instructions and the final approval email go out only after the Manager and, over the Approval limit, the CEO have signed off. Only whole line items are requested; the quantities recorded when goods arrive document what came back and do not make a part-quantity request. Unsellable goods go through the existing write-off process and its approvals.

**Resolution**:
What a Return ends in: a refund or a replacement. The Customer states a preference; Staff record the final Resolution on approval, and may differ from the preference. A refund goes to the Customer's Refund destination, and Staff upload proof of it; an unpaid Cash on Delivery Order has nothing to refund, but one whose cash was collected can be refunded. A replacement ends at Replaced once sent, and is sent as a Replacement Order. A refund is the amount actually paid for the approved whole line items after discounts, including a Senior/PWD discount. The Delivery fee is not refunded in an ordinary return; for a wrong or defective item a Manager may include it, with a reason, at most once per Order and never more than was charged (free delivery adds ₱0). The Delivery fee never counts toward the Approval limit. The shop absorbs any payment channel fee, so nothing is deducted. Refunds for an Order never add up to more than was paid, and a second refund for the same Return or the same items is blocked. Items and Delivery fee are shown separately in CREOMS, on the storefront, in the refund email and in the Audit Logs. Only whole line items and a replacement of the same item are handled; part-quantity returns, exchanges for another size and store credit are not.
_Avoid_: Outcome, remedy

**Replacement Order**:
A new ₱0 Order, linked to the original Order, that sends a Customer the same item again after an approved replacement. It reserves its own stock and is packed, dispatched with a Lalamove or Grab link and tracked like any Order. It leaves Total spent unchanged and does not count in the Customer's order count, their Stage, Buyers or Sales. The shop pays the courier fee; it is never quoted to the Customer.
_Avoid_: Free order, resend

**Refund window**:
The 24 hours starting at the storefront's `delivered_at` (`collected_at` for a Pickup Order), during which the Customer may request a Return. It limits the request, not Staff handling: an in-time Return remains valid. A Customer marking the Order `received` (from `delivered` or `collected`) ends the window and gives up the right to a Return. A Manager may extend the window once per Order by another 24 hours, with a reason; Staff see "Request approval".

**Role**:
What a Staff member is in CREOMS: Staff / Employee, Manager, Admin or CEO. The Admin assigns it in the Portal, and it ticks that Role's usual Modules; the Modules remain the gate to each page. Only the Role decides who approves, and a Manager still needs the Module (Payments, Fulfilment, Returns or Orders) for the page they act on; Admin and CEO view everything and change nothing except the CEO's final approval and the Management pages. Staff do daily work that is easy to undo; a Manager also approves; the Admin runs the system and views every module; the CEO views everything and gives final approval above the Approval limit. The one other thing the CEO may change is the Management pages (Payment accounts and the Free delivery threshold), together with Managers.
_Avoid_: Permission, level

**Request approval**:
What Staff see in place of a button for an action that needs a Manager: money, removing stock, overriding an AI warning, or moving someone else's work.
_Avoid_: Escalate (a Ticket word)

**Approval limit**:
₱5,000, set by the Admin. A refund or write-off of more than the limit, measured by the selling price of the Return's items, also needs the CEO's final approval; exactly ₱5,000 or less stops at the Manager.
_Avoid_: Threshold, cap

**Warehouse**:
The one place online Orders are reserved from, packed at and dispatched from; the IMS holds its stock. Commissary, factory and kitchen are the same place. Stock already distributed to POS branches is not sold online.
_Avoid_: Commissary, factory, branch, location

**Available stock**:
What a Customer can still order of one Size: the Warehouse's physical stock minus the Reservations held against it. Releasing a Reservation raises it without adding physical stock; only the IMS changes physical stock. The Ecommerce storefront and CREOMS show this same number, never physical stock alone.
_Avoid_: In stock (as the number a Customer can order), quantity on hand

**Products & Stocks**:
The CREOMS sidebar screen, open to every role with the Orders Module, listing every Size the IMS holds with the product's image before its name (a click zooms it; a product with no image shows a plain tile that does nothing), its physical, reserved and available stock, and how many Orders hold the Reservations ("12 reserved · 5 Orders"; a click lists those Orders by status: Placed, Awaiting payment, Paid and waiting to dispatch). Stock, name, Size label (its Variant) and price are read-only for every role: the IMS owns them, and "Open IMS" is the only way to change them. The one thing Staff and Managers edit here is the shop image and description: a pencil button on each row opens a drawer where they upload an image (JPG or PNG, kept in CREOMS and shown instead of the IMS image) and write a description, behind a "Publish to store" confirmation; the title and stock figures show locked. Admin and CEO see no pencil. CREOMS keeps a copy of what the IMS last reported (name, Variant, image, price, physical, reserved and available stock), saved on every successful IMS read. When the IMS or the storefront cannot be reached, the page shows that copy with a note giving its time, instead of an empty list; with no copy yet it says the IMS could not be reached. The copy is only ever written from an IMS read, and CREOMS never sends quantities to the IMS: reservations and the deduction at dispatch or collection are sent by the storefront (see Deduction pending). The copy is as fresh as the last time someone opened the page, since nothing refreshes it on a timer. It updates live for Staff when available stock, a product's image, name or price, or a new product changes; the storefront is not live and reads on a Customer's action. Its consistency indicators ("Checking…", "Reservations don't match", "Unable to verify", with both numbers) are shown only to a Manager, Admin or CEO with the Orders Module; Staff never see mismatch findings, though they still see Reservations, stock activity and Deduction pending. A "Needs intervention" notification goes to Managers only.
_Avoid_: Inventory, stock page

**Not on shop**:
A product the IMS holds that Customers cannot yet see because its name, image or price is missing; the missing items are listed. It goes live by itself once all three exist. Its category (Ube Powder, Jam or Halaya) is read from its name, and its description stays empty until Staff publish one from Products & Stocks. An image published there counts as the product's image.

**Discontinued**:
A product removed or deactivated in the IMS. It leaves the storefront at once and cannot be reserved; CREOMS keeps showing it with its image and last known numbers. Open Orders keep their Reservations and finish normally, and Order history keeps the name and price from when the Order was placed. Bringing it back in the IMS makes it live again.

**Pickup (retired)**:
The Pickup Order type is retired; the shop delivers only. Existing Pickup Orders are deleted and the Pickup statuses, tabs and instructions removed. Cash on Delivery Orders remain Delivery Orders and never expire.

**Deduction pending**:
A dispatched or collected Order line whose stock the IMS has not yet confirmed taking out, because the IMS was unavailable or timed out. The handover is saved only after this is durably recorded, and the storefront keeps retrying with the same reference until the IMS confirms. Until then the quantity stays unavailable to other Customers and is never counted as both reserved and deducted. If the IMS later refuses it, the line is flagged **Needs intervention** and Managers are alerted; the completed handover is never silently reversed. An explicit IMS refusal at the moment of dispatch or collection blocks it instead, with the reason shown, and leaves the Order and Reservation unchanged. Products & Stocks only displays this state.
_Avoid_: Failed deduction, stock error

**Expired**:
Not an Order status. An Online payment Order that stays unpaid past its payment window is `cancelled` with the reason "Payment window expired", and the storefront and CREOMS show that reason as "Expired". The Customer's email says "Your order was cancelled because the payment window expired", the Customer can no longer submit a proof and must place a new Order, and the stock activity records an Expired event linked to the Reservation's release. The release is one return of stock, not two. Order Details still shows the underlying cancellation.
_Avoid_: `expired` as a status, timed out

**Reservation**:
Stock the IMS sets aside for an Order the moment it is placed, so no one else can buy it. It is released if the Order is cancelled, or if an Online payment Order stays unpaid past its payment window (the Customer is emailed and the Order is cancelled). The payment window is a Commerce Settings value (Management, below Payment accounts, beside the Approval limit; Manager and CEO edit it, Admin and Staff cannot; each change is audited and affects only Orders confirmed afterwards), default 24 hours counted from the moment Staff's confirmation is saved (the confirmation time and the deadline are saved together, and email delays, failures, retries and Resend never pause or restart the clock; the deadline is shown on the payment page and in the confirmation email); each rejected Payment proof starts a fresh window, default 24 hours from the rejection, and the Customer sees the deadline and reason. A proof submitted in time pauses the expiry while it is Pending Verification, so Staff review time never uses up the Customer's window. The third rejected proof stops further Customer submissions and goes to a Manager. This automatic cancellation is the one exception to the rule that a confirmed Order cannot be cancelled by anyone but Staff. An Order of any kind still not confirmed 48 hours after placement (an Admin setting) is flagged Overdue on the Dashboard and alerts the Managers; a person decides, nothing is cancelled automatically. The IMS takes it out of stock, and consumes the Reservation in the same step, when the Order is dispatched (Delivery) or collected (Pickup); packing and Preparing change no stock. Cancelling before that only releases the Reservation. A dispatched Order that is cancelled keeps its stock deducted until the goods are physically back and inspected, and only then does the IMS add them back. Checkout blocks when none is left.
_Avoid_: Hold (a batch Hold is different)

**Free delivery**:
A Delivery Order whose Delivery fee is ₱0. It happens in two ways: the Order's subtotal after discounts is over the Free delivery threshold, so the fee is ₱0 automatically, shown as "Free Delivery" and Staff cannot enter a fee on it; or the subtotal is not over the threshold and Staff or a Manager entered ₱0 by hand, which is allowed. Every other Delivery Order waits for a Delivery fee entered by Staff or a Manager. The rule is judged and saved on the Order when it is placed, so the Customer sees "Delivery: Free" at checkout and a later change to the threshold never changes an existing Order. A free-delivery Order is still not confirmed until Staff confirm it, with the fee locked at ₱0; the Customer can cancel only before that.

**Payment account**:
One of the shop's receiving accounts a Customer pays into for an Online payment Order: GCash, Maya or bank transfer, with a label, an account name, an account number (kept as text, normalised before duplicates are checked, and validated for its method or bank), a bank name for bank transfer, and an optional QR image (JPG or PNG up to 5 MB, real file content checked, stored privately and shown through short-lived signed links). A Manager or the CEO adds, edits, activates and deactivates them on the Payment Management tab under Management in CREOMS, after a confirm dialog that shows the method, name and masked number and a spinner within 100 ms; Staff and Admin cannot open it. Deactivating hides an account from new choices but never deletes it, and the last active account of an enabled method cannot be deactivated (a Manager may disable the method entirely). Each Payment proof keeps the account details it was checked against, so a later edit never changes them; a Customer with an unpaid Order on a deactivated account picks an active one before paying, and a proof for a transfer made before the account was deactivated goes to Staff review, not an automatic rejection. The storefront shows the active ones, with the Order's final amount and deadline, only on an Order that is Awaiting Payment, after Staff confirm it: never at checkout and never while the Order shows Pending Confirmation (a placed Order awaiting Staff). The payment page opens the moment the confirmation is saved, even if the confirmation email fails; a Cash on Delivery Order gets the confirmation and its pay-at-pickup or pay-on-delivery instructions instead. A Customer picks the account they paid before submitting proof (a missing QR never blocks the choice), and the proof stores that account's id, method, bank name, label, name and number, so the instructions they were shown survive later edits or deactivation. The Proof reader checks against that account, the Order total and the entered reference; a different recipient is a Mismatch for Staff to judge, and any correction is audited without overwriting the original submission. If a method becomes unavailable it leaves new checkouts, and an Order awaiting payment is offered another enabled online method without resetting the deadline or changing the total, while proof for a transfer already made stays accepted. If no online method is left the Customer sees a notice and the shop's contact, never a silent switch to Cash on Delivery. Choosing an account never marks the Order paid. Every change is audited with the account number shown only as its last four digits and never a signed link. CREOMS never takes the payment itself. Not the Customer's sign-in "account".
_Avoid_: Shop wallet, payment method (a Payment method is how a Customer chooses to pay)

**COD collection**:
The record that a Cash on Delivery Order's cash was collected: its amount, the time and the Staff member who recorded it. It is not a status. Staff record it in the same confirm dialog and the same save as marking the Order `collected`, shown as Picked up (Pickup) or `delivered` (Delivery, after confirming the rider collected the cash). The amount is pre-filled with the saved total (subtotal minus discount plus Delivery fee) and any other amount is refused with the reason; if the save fails, neither the status change nor the record is kept. A failed delivery records nothing. "Payment collected" means the Customer paid, not that the courier has handed the cash to the shop (courier remittance tracking and the full Pickup check-in are not part of this). The Customer sees "Payment collected" with the amount and time, and gets the one completion email, which also confirms the payment. One Audit Event holds the transition, the amount, the time and who recorded it.
_Avoid_: Paid (an Order status), COD payment status

**Status email**:
An email the storefront sends a Customer through Notification, styled like the Ecommerce storefront (its Figma Foundations: ube palette, Libre Baskerville and DM Sans, the same buttons and badges), when one of these events happens: the Order is confirmed (#554), payment is verified, payment is rejected (reason, new deadline, resubmit link), the payment window expires and the Order is cancelled, a Manager payment review starts, the Order first enters Preparing (never for an edit or repeated save), is Dispatched (courier, and Track Your Order only when a link exists), is Ready for pickup, is Delivered or Picked up (for COD it also confirms the payment collected), or a refund is completed (with the proof image). The third rejection sends only the "Manager review started" email, which carries the reason and offers no resubmission or new deadline, never the normal rejection email too. CREOMS never sends one. A failed email never undoes the saved update: the storefront retries, CREOMS shows "Email not sent" with the reason, and Staff or a Manager can Resend once retries run out, each Resend audited. Each email has one stable id per event occurrence, so a retry or Resend of the same event never sends twice and two real rejections each get their own; a Resend of an email Notification already accepted first reconciles its delivery status. Refund emails and their Resend belong to the Returns side.
_Avoid_: Notification (the shared service that delivers it)

**Fulfilment board**:
The Fulfilment page's board, with tabs To pack (paid Online Orders and confirmed COD Orders, Delivery and Pickup, oldest first), Preparing (`preparing`), Ready for pickup (`ready for pickup`), Out for delivery (`dispatched` with no open failed delivery), Failed (`dispatched` with an open failed delivery; closing it returns the Order to Out for delivery if it is still `dispatched`), Completed (Delivered or Picked up in the last seven days by the original completion time, including Orders since marked `received`), All active and All. Legacy Pickup Orders already `dispatched` or `delivered` stay visible and can be completed. Preparing never claims packing is finished; the IMS takes stock out only when the Order is dispatched or collected. There is no Waiting for rider tab until a real rider-waiting step exists. No tab is a new status.
_Avoid_: Packed (for `preparing`)

**Free delivery threshold**:
The subtotal after discounts above which a Delivery Order gets free delivery, set by a Manager or the CEO on the Commerce Settings screen under Management in CREOMS (for example ₱2,500). The storefront uses the current value; threshold changes affect only Orders not yet placed. Each change is recorded in the Audit Logs.
_Avoid_: Minimum order, free shipping limit

**Senior/PWD verified**:
A Customer whose Senior Citizen or PWD ID Staff have checked and approved. They get 5% off one item per ID, for personal use. The ID photo is private and is deleted right after review; if nobody reviews it within 7 days it is removed anyway and the Customer uploads it again. Only the verified mark, a hash of the ID number, the approver's name and the ID's expiry date are kept: the ID number itself is never stored in plain text, shown in an email, or written to a log. Staff check the name against the one already on the account, and the Customer is never asked for a detail the system already holds. The same ID number cannot verify a second account. The discount stops on the expiry date and the Customer verifies again. For Pickup, Staff also see the original ID at collection.
_Avoid_: Discount ID, senior account

**Courier details**:
What Staff record when a Delivery Order is dispatched: the courier, Lalamove or Grab, which is always required; optionally the booking's share link, which must be `https` when given; and optionally the rider's name, plate number and phone, which only Staff and Managers see. The Customer sees the courier's name, and "Track Your Order" only when a link exists. Staff can add or correct the link while the Order is `dispatched`; the dispatch and every later change to the link are audited with the old and new values, the time and who made them. Pickup Orders have none.
_Avoid_: Tracking, tracking number

**Failed delivery**:
An attempt where the rider could not deliver, recorded with a reason on the Order. The Order stays `dispatched`; Staff rebook the courier or ask a Manager to cancel it.
_Avoid_: Returned to sender

**COD flag**:
A plain rule that marks a Cash on Delivery Order for Staff to double-check before confirming: a first order, a first order over ₱1,500 (an Admin setting), a phone number that refused an earlier Order, or an earlier failed delivery. Staff see which rule fired; nothing is blocked and no AI scores it.
_Avoid_: Fraud score, risk percentage
