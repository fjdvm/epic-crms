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
A feature area of CREOMS that the Portal grants or revokes per Staff member, such as Customer Profiles. Each CREOMS page belongs to exactly one Module. The Customer Profiles Module is the permission to open the Customer Profiles pages; it is not the Customer Profile itself. The Tickets Module covers both the Tickets and the Conversations pages, since they show the same Tickets. The Feedback Module covers the Feedback page and is separate from the Tickets Module. Orders work is split across three Modules: Orders (view Orders, quote the Delivery fee and confirm, cancel), Payments (check Payment proof and mark an Order paid) and Fulfilment (`preparing`, `dispatched`, `delivered`). The Returns Module covers Returns reads and decisions. The Orders, Payments, Fulfilment and Returns pages each belong to their own Module, but the Order detail page opens for Staff with any of the four; it is the one exception to "one page, one Module". Staff see only the actions their Modules allow. The Dashboard Module covers the Dashboard page, which opens for Staff who hold it; each widget on it shows only if Staff also hold the Module of the data it summarises. The Dashboard is where `/` lands for Staff who hold it.
_Avoid_: Permission, feature, role

**Customer**:
A person who signed up and verified their email.
_Avoid_: User, account, contact

**Lead**:
A person who signed up but has not yet verified their email. Becomes a Customer on verification. Leads belong to a separate module, not Customer Profiles.
_Avoid_: Unverified customer, prospect

**Customer Profile**:
Everything staff can see about one Customer in one place: their details, orders, cart, notes and tasks.
_Avoid_: Contact, account, user

**Customer note**:
A piece of free text a Staff member writes about a Customer on their Customer Profile, with the Staff member's name and the date. Permanent once written: never edited or deleted; a mistake is corrected with a new Customer note. Always called a Customer note, never just "note". A phone call is written up as a Customer note. Not a Message (which belongs to a Conversation and is sent to the Customer) and not a Ticket's internal note.
_Avoid_: Note, Message, comment, Profile note

**Task**:
A follow-up a Staff member must do for a Customer, written on their Customer Profile. It has an owner, a required due date and a done state, which is what separates it from a Customer note. The owner is the Staff member who created it; only a Manager can assign or reassign it to someone else. The due date is a date only, in Philippine Time. The owner or a Manager can change the due date, mark it done and reopen it. Its description is fixed and it is never deleted; a Task no longer needed is marked done. It is overdue once its due date has passed and it is not done.
_Avoid_: Reminder, to-do, follow-up

**Customer since**:
The date a Customer first signed up. It is the sign-up date, not the date they verified their email.

**Total spent**:
The sum of a Customer's Order totals (subtotal plus delivery fee) for Orders that have been paid for or fulfilled: `paid`, `preparing`, `dispatched`, `delivered` and `received`, minus Refunded Return amounts. Returns still in progress, Replaced Returns, Declined Returns and Customer-cancelled Returns do not reduce it. Cancelled and merely placed or confirmed Orders do not count.
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
Where an Order is in its life: `placed`, `confirmed`, `awaiting payment`, `paid`, `preparing`, `dispatched`, `delivered`, `received` or `cancelled`. Only the Customer marks an Order `received`; it acknowledges delivery without resetting the Refund window. Pickup and Cash on Delivery Orders skip the payment steps. These are the storefront's statuses; the design's "Pending", "Packed" and "Shipped" mean `placed`, `preparing` and `dispatched`. Payment is part of the status, not a separate field. Staff can cancel an Order up to `preparing`; cancelling a `dispatched` Order needs a Manager's approval.
_Avoid_: Order state, fulfillment status, payment status

**Delivery fee**:
The courier cost of a Delivery Order, quoted by Staff by hand after the Order is `placed`. Quoting it confirms the Order. A Pickup Order has none.
_Avoid_: Shipping fee, shipping

**Payment proof**:
The reference number, and optionally a screenshot, a Customer submits for an Order paid by GCash, Maya or bank transfer. All three are manual: the Customer pays outside the shop and Staff check the proof by hand. Staff with the Payments Module check it and either mark the Order `paid`, reject it with a reason, or cancel the Order. A Customer whose proof is rejected may submit another; every proof and rejection is kept. After 3 rejected proofs only a Manager can approve the Order.
_Avoid_: Receipt, payment confirmation

**Stage**:
A label derived from a Customer's Orders (Replacement Orders do not count), never set by hand: New (no Orders), First order (one Order), Repeat (two or more), At risk (no Order in 60 days), Lost (no Order in 120 days). At risk and Lost take precedence over First order and Repeat.
_Avoid_: Lifecycle, status, segment

**New Customer notification**:
An alert shown to staff the first time CREOMS sees a person has become a Customer, that is, verified their email.
_Avoid_: Sign-up alert

**Ticket notification**:
An alert shown to Staff when a Ticket needs them: a new Ticket (to every Staff member with the Tickets Module), or a new Customer Message or a Ticket the Customer says is not fixed (to the Claimer, or to every Staff member with the Tickets Module while the Ticket is Unclaimed). A Customer confirming a Ticket as Completed raises none.
_Avoid_: Ticket alert, support alert

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
A Ticket is Open, On hold, Resolved or Completed. Staff mark it Resolved when they think the problem is dealt with, and the Customer is asked to confirm. The Customer confirming makes it Completed, as does 3 days passing with no confirmation and no disagreement. A new Customer Message, or the Customer saying it is not fixed, reopens a Resolved Ticket to Open. Staff can never set Completed. A Customer can also complete their own Ticket at any time, without Staff marking it Resolved. Completed is final: nobody reopens a Completed Ticket, and a Customer who needs help again opens a new one. On hold is set only by the Claimer, who picks what they are waiting on (Courier (Lalamove or Grab), Kitchen or IMS, Supplier, Manager decision), an optional Staff-only note, and the date and time it returns to Open. Any Staff see the reason; the Customer sees "We're on it" and never the reason. It returns to Open when that time comes, when the Claimer takes it off hold, when the Claimer releases it, or at once when the Customer sends a new Message. The 3-day auto-complete ignores it. "Waiting on customer" is not a status: it is shown while the last Message came from Staff, and is never set by hand.
_Avoid_: Closed, claimed, cancelled

**Linked order**:
The Customer's Order a Ticket is about. Optional: a Ticket can have none, and must be one of that Customer's own Orders. The Ticket list shows "None yet" when there is no Linked order.
_Avoid_: Related order, attached order

**Service level**:
Two targets the Admin sets in Portal Settings: the first reply target (default 24 hours) and the resolve target (default 3 days). They are the same for every Priority and every hour counts. A Ticket takes the pair in force when it was opened and keeps it; a change affects only Tickets opened afterwards. Each Ticket shows time left, Breaching soon (under 1 hour left) or Missed. The clock stops while the Ticket is On hold, and the resolve clock also stops while it is waiting on the Customer. A missed target is stamped once and never cleared. Manager and CEO see the targets read-only; Staff do not see the screen.

**Overdue**:
An Open Ticket whose last Message came from the Customer and has gone longer than its first reply target without a Staff reply. A new Ticket nobody has answered counts. A Ticket waiting on the Customer, or On hold, is never Overdue. The Dashboard's Needs attention uses the same rule.
_Avoid_: Late, breached

**Priority**:
How urgently a Ticket needs attention: Low, Normal, High or Urgent. Defaults to Normal and is set by Staff.
_Avoid_: Severity, urgency

**Claim**:
Staff take a Ticket for themselves to answer it; Staff never assign a Ticket to someone else. A Ticket has at most one Claimer, the Staff member shown as "Assigned to" in the design. A Ticket nobody has claimed is Unclaimed. Any Staff can claim an Unclaimed Ticket; only the Claimer can chat with the Customer, so a Ticket must be claimed before it is replied to. A Ticket Staff open is claimed by the Staff member who opened it. Only the Claimer can release a Ticket back to Unclaimed; nobody can take a claimed Ticket from its Claimer, except a Manager, who can reassign it (see Reassign).
_Avoid_: Assign, owner, agent

**Reassign**:
A Manager moves a claimed Ticket to a named Staff member with a required reason, or moves all of an absent teammate's open Tickets (everything not Completed) to one Staff member after seeing them. Both the previous and the new Claimer get an alert with the reason; each move is logged on the Ticket's activity and in the audit trail. Only a Manager can do it; Staff see no button, and Admin and CEO only read the history. There is no AI split, no move back, no followers and no Priority change with it. The move only happens if the Ticket is still held by the Claimer the Manager saw; otherwise it says someone else changed it first. A Completed or Unclaimed Ticket is not reassigned.
_Avoid_: Assign, transfer, pass

**Escalation**:
The Claimer asks the Managers for help with one reason (Service level about to be or was missed, Money decision, Food safety or possible illness, Customer upset) and a short note. Every Manager who holds the Tickets Module gets an in-app alert; no email. The Ticket shows Escalated until a Manager takes it (becoming the Claimer, through Reassign, so the previous Claimer is told) or sends it back with a note (the Claimer is told). The Claimer stays on the Ticket meanwhile and cannot release it. Only the Claimer escalates, nothing escalates automatically, and each step is logged on the Ticket's activity and in the audit trail. Staff see no Take or Send back button.
_Avoid_: Request approval (that is for actions Staff may not do at all)

**Ticket number**:
The Ticket's visible reference, written TKT- followed by its number, such as TKT-208.
_Avoid_: Ticket ID, case number

**Message**:
One entry in a Conversation, sent by the Customer or by Staff. Permanent once sent: never edited or deleted. It may carry one image (JPG or PNG, up to 5 MB).
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
Anything an AI offers Staff to look at: a Ticket's suggested Category and Priority, a Ticket summary, a Drafted reply, or Complaint themes. It is only ever shown to Staff, who press the button that asks for it; nothing runs by itself, on a timer, or when a page opens. It never reaches a Customer and never changes a Ticket, Order or payment until a Staff member acts on it. The AI sees only the text the feature needs, with emails and phone numbers masked, and exactly what it saw is kept and shown. When Staff use a suggestion, the Audit Event names that Staff member.
_Avoid_: AI decision, auto-reply, automation

**Ticket summary**:
A few lines an AI writes about one Ticket's thread, so Staff or a Manager who opens it can catch up quickly. Anyone who can open the Ticket can ask for one, Claimer or not. It is read-only and is never sent to the Customer.
_Avoid_: Recap, digest

**Drafted reply**:
A reply an AI writes to the Customer's latest Message, in the Customer's own language (English or Taglish), placed in the reply box of the Claimer, the only Staff who can reply. It promises no refund, replacement or date, and says a teammate will confirm when unsure. Nothing is sent until the Claimer edits it as they wish and presses Send; the Audit Event records whether it was sent as drafted or edited.
_Avoid_: Auto-reply, canned reply

**Complaint themes**:
Up to five groups of similar complaints an AI finds in a chosen period, each with a short label and a count and links to the Tickets, Returns and Feedback (1 to 3 stars) behind it, such as "leaking pouch on the 500 g". Managers ask for them with a button on the Dashboard; the counts and links come from the records, not from the AI. The last result is kept with the period and time it was made, and Admin and CEO can read it. Staff do not see it.
_Avoid_: Trends, insights, alerts

**Feedback request**:
The one email and in-app Notification sent to a Customer 2 days after an Order is marked Delivered, linking to that Order's Feedback form. Sent once per Order, with no reminder, and not sent if the Customer has already given Feedback.
_Avoid_: Survey, review request

**Conversation**:
The live two-way chat inside one Ticket, between its Customer and Staff. Every Conversation belongs to exactly one Ticket; there is no chat without a Ticket. The Conversations page is Staff's inbox of these chats, and the Ticket page shows the same chat.
_Avoid_: Chat thread, inbox message, Messenger or Instagram chat


**Return**:
A Customer's request to have one or more whole Order line items refunded or replaced. The storefront owns it; CREOMS reads it and asks the storefront to make Staff decisions. It has a Return number (`RMA-` followed by its number) and is Requested, Approved, Goods received, Refunded, Replaced, Declined or cancelled by the Customer while Requested. Refunded, Replaced and Declined are final. A Return never changes its Order's status.

**Resolution**:
What a Return ends in: a refund or a replacement. The Customer states a preference; Staff record the final Resolution on approval, and may differ from the preference. A refund goes back the way the Customer paid (GCash, Maya or bank transfer) and Staff upload proof of it; a Cash on Delivery Order has nothing to refund. A replacement ends at Replaced once sent, and is sent as a Replacement Order. Only whole line items and a replacement of the same item are handled; part-quantity returns, exchanges for another size and store credit are not.
_Avoid_: Outcome, remedy

**Replacement Order**:
A new ₱0 Order, linked to the original Order, that sends a Customer the same item again after an approved replacement. It reserves its own stock and is packed, dispatched with a Lalamove or Grab link and tracked like any Order. It leaves Total spent unchanged and does not count in the Customer's order count, their Stage, Buyers or Sales. The shop pays the courier fee; it is never quoted to the Customer.
_Avoid_: Free order, resend

**Refund window**:
The 24 hours starting at the storefront's `delivered_at`, during which the Customer may request a Return. It limits the request, not Staff handling: an in-time Return remains valid. A Customer marking the Order `received` ends the window and gives up the right to a Return. A Manager may extend the window once per Order by another 24 hours, with a reason; Staff see "Request approval".

**Role**:
What a Staff member is in CREOMS: Staff / Employee, Manager, Admin or CEO. The Admin assigns it in the Portal, and it ticks that Role's usual Modules; the Modules remain the gate to each page. Only the Role decides who approves. Staff do daily work that is easy to undo; a Manager also approves; the Admin runs the system and views every module; the CEO views everything and only gives final approval above the Approval limit.
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

**Reservation**:
Stock the IMS sets aside for an Order the moment it is placed, so no one else can buy it. It is released if the Order is cancelled, or if a GCash Order stays unpaid for 24 hours (the Customer is emailed and the Order is cancelled). The IMS takes it out of stock when the Order is packed. Checkout blocks when none is left.
_Avoid_: Hold (a batch Hold is different)

**Free delivery**:
A Delivery Order whose subtotal, before any Senior/PWD discount, is strictly over ₱2,500 has a Delivery fee of ₱0 and is confirmed at placement. If cancelled items bring the subtotal to ₱2,500 or less, Staff must quote a Delivery fee.

**Senior/PWD verified**:
A Customer whose Senior Citizen or PWD ID Staff have checked and approved. They get 5% off one item per ID, for personal use. The ID photo is private and is deleted right after review; if nobody reviews it within 7 days it is removed anyway and the Customer uploads it again. Only the verified mark, a hash of the ID number, the approver's name and the ID's expiry date are kept: the ID number itself is never stored in plain text, shown in an email, or written to a log. Staff check the name against the one already on the account, and the Customer is never asked for a detail the system already holds. The same ID number cannot verify a second account. The discount stops on the expiry date and the Customer verifies again. For Pickup, Staff also see the original ID at collection.
_Avoid_: Discount ID, senior account

**Courier details**:
What Staff record when a Delivery Order is dispatched: Lalamove or Grab, the booking's share link (`https`), and optionally the rider's name, plate number and phone. The Customer sees "Track your delivery". Pickup Orders have none.
_Avoid_: Tracking, tracking number

**Failed delivery**:
An attempt where the rider could not deliver, recorded with a reason on the Order. The Order stays `dispatched`; Staff rebook the courier or ask a Manager to cancel it.
_Avoid_: Returned to sender

**COD flag**:
A plain rule that marks a Cash on Delivery Order for Staff to double-check before confirming: a first order, a first order over ₱1,500 (an Admin setting), a phone number that refused an earlier Order, or an earlier failed delivery. Staff see which rule fired; nothing is blocked and no AI scores it.
_Avoid_: Fraud score, risk percentage
