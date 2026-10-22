# CREOMS

A staff-facing CRM for an ecommerce store. Staff use it to see who their customers are and how those customers interact with the store.

## Language

**Staff**:
A person who signs in through the central portal and works in CREOMS. The portal calls the same person a User. Never a Customer.
_Avoid_: User, admin

**Portal**:
The central sign-in site that Staff sign in through and are sent into CREOMS from. It decides who may open CREOMS and which of its Modules. Signing out of CREOMS signs the Staff member out of the Portal and every other Bren Raphael's system.
_Avoid_: Auth app, login site

**Module**:
A feature area of CREOMS that the Portal grants or revokes per Staff member, such as Customer Profiles. Each CREOMS page belongs to exactly one Module. The Customer Profiles Module is the permission to open the Customer Profiles pages; it is not the Customer Profile itself. The Tickets Module covers both the Tickets and the Conversations pages, since they show the same Tickets. The Feedback Module covers the Feedback page and is separate from the Tickets Module. The Marketing Module covers composing and sending Announcements; the Portal used to call it Campaigns. Orders work is split across three Modules: Orders (view Orders, quote the Delivery fee and confirm, cancel), Payments (check Payment proof and mark an Order paid) and Fulfilment (`preparing`, `dispatched`, `delivered`). The Orders, Payments and Fulfilment pages each belong to their own Module, but the Order detail page opens for Staff with any of the three; it is the one exception to "one page, one Module". Staff see only the actions their Modules allow. The Portal also lists Returns and Dashboard Modules, which are not part of this work.
_Avoid_: Permission, feature, role

**Customer**:
A person who signed up and verified their email.
_Avoid_: User, account, contact

**Lead**:
A person who signed up but has not yet verified their email. Becomes a Customer on verification. Leads belong to a separate module, not Customer Profiles.
_Avoid_: Unverified customer, prospect

**Walk-in Customer**:
A person Staff add by hand in CREOMS, for people who order by chat, phone or in person and have no storefront account. They are not a Customer: they never signed up or verified an email, and have no storefront Orders or Cart, and no Tickets: Staff cannot open one for them. They appear in the Customer Profiles list marked "Walk-in". If the same email later becomes a Customer, the two merge into that Customer's Customer Profile.
_Avoid_: Manual customer, offline customer, Lead

**Customer Profile**:
Everything staff can see about one Customer in one place: their details, orders, cart, and marketing emails received.
_Avoid_: Contact, account, user

**Customer since**:
The date a Customer first signed up. It is the sign-up date, not the date they verified their email.

**Total spent**:
The sum of a Customer's Order totals (subtotal plus delivery fee) for Orders that have been paid for or fulfilled: `paid`, `preparing`, `dispatched` and `delivered`. Cancelled and merely placed or confirmed Orders do not count.
_Avoid_: Revenue, lifetime value

**Order**:
A Customer's request to buy, placed on the storefront. CREOMS never creates an Order: it shows the storefront's Orders and lets Staff move them forward. The storefront owns the Order and its rules; CREOMS asks it to make each change so the rules and the Customer's emails stay in one place.
_Avoid_: Purchase, transaction

**Order status**:
Where an Order is in its life: `placed`, `confirmed`, `awaiting payment`, `paid`, `preparing`, `dispatched`, `delivered` or `cancelled`. Pickup and Cash on Delivery Orders skip the payment steps. These are the storefront's statuses; the design's "Pending", "Packed" and "Shipped" mean `placed`, `preparing` and `dispatched`. Payment is part of the status, not a separate field. Staff can cancel an Order up to `preparing`; nobody can cancel a `dispatched` Order yet.
_Avoid_: Order state, fulfillment status, payment status

**Delivery fee**:
The courier cost of a Delivery Order, quoted by Staff by hand after the Order is `placed`. Quoting it confirms the Order. A Pickup Order has none.
_Avoid_: Shipping fee, shipping

**Payment proof**:
The GCash reference number, and optionally a screenshot, a Customer submits for an Order. Staff with the Payments Module check it and either mark the Order `paid` or cancel it. There is no rejecting a proof and asking for another: a Customer submits proof once.
_Avoid_: Receipt, payment confirmation

**Stage**:
A label derived from a Customer's Orders, never set by hand: New (no Orders), First order (one Order), Repeat (two or more), At risk (no Order in 60 days), Lost (no Order in 120 days). At risk and Lost take precedence over First order and Repeat.
_Avoid_: Lifecycle, status, segment

**New Customer notification**:
An alert shown to staff the first time CREOMS sees a person has become a Customer, that is, verified their email.
_Avoid_: Sign-up alert

**Ticket notification**:
An alert shown to Staff when a Ticket needs them: a new Ticket (to every Staff member with the Tickets Module), or a new Customer Message or a Ticket the Customer says is not fixed (to the Claimer, or to every Staff member with the Tickets Module while the Ticket is Unclaimed). A Customer confirming a Ticket as Completed raises none.
_Avoid_: Ticket alert, support alert

**Order notification**:
An alert shown to Staff when an Order is waiting on them: a new Delivery Order needing a Delivery fee (to every Staff member with the Orders Module), or a GCash Order whose Payment proof was just submitted (to every Staff member with the Payments Module). Nothing alerts Fulfilment Staff.
_Avoid_: New order alert, payment alert

**Feedback notification**:
An alert shown to every Staff member with the Feedback Module when a Customer gives Feedback of 1 to 3 stars. Feedback of 4 or 5 stars raises none.
_Avoid_: Review alert, low-rating alert

**Marketing Email**:
A promotional email the store sends to a Customer, produced by the automated email marketing module (separate from Customer Profiles). "Email received" on a Customer Profile means these.
_Avoid_: Inbox, support message

**Subscriber**:
A Customer whose Marketing opt-in is yes. Marketing Emails go only to Subscribers. Leads and Walk-in Customers are never Subscribers, even if they said yes to marketing.
_Avoid_: Recipient, mailing list member

**Unsubscribe**:
A Subscriber ends their own Marketing opt-in by clicking the link in the footer of any Marketing Email. They stop being a Subscriber at once. Staff cannot do this for them.
_Avoid_: Opt out, remove from list

**Announcement**:
One Marketing Email composed by Staff: a title, a description, and zero or more images. A text-only Announcement is valid. It always goes to every Subscriber; Staff cannot pick an audience. Before sending, Staff can send a test copy of it to themselves. Staff either send it now or schedule it for a later date and time, always in Philippine Time. Its recipients are whoever is a Subscriber at the moment it is sent, not when it was scheduled. An Announcement is a Draft (saved, not yet sent or scheduled; Staff can edit or delete it), Scheduled (waiting for its send time; Staff can edit, reschedule, or cancel it back to Draft), Sent (final; it can be viewed but never edited or unsent) or Failed (a send that could not be fully handed over; Staff can retry it, and the retry skips Subscribers it already reached so nobody gets it twice).
Announcements are shared: any Staff member with the Marketing Module can edit, schedule, cancel or send any Announcement that is not yet Sent, whoever wrote it, and there is no approval step.
The Marketing Module's page is titled "Email campaigns", following the design, and lists Announcements; it has no audience segments and shows no open, click, order or revenue figures.
_Avoid_: Campaign (except as the page title), blast, newsletter, post, pubmat

**Ticket**:
A support request raised by a Customer, or opened by Staff on a Customer's behalf. A separate module from Customer Profiles. A Ticket has no Channel: where a request came from is not recorded.
_Avoid_: Case, email

**Ticket status**:
A Ticket is Open, Resolved or Completed. Staff mark it Resolved when they think the problem is dealt with, and the Customer is asked to confirm. The Customer confirming makes it Completed, as does 3 days passing with no confirmation and no disagreement. A new Customer Message, or the Customer saying it is not fixed, reopens a Resolved Ticket to Open. Staff can never set Completed. A Customer can also complete their own Ticket at any time, without Staff marking it Resolved. Completed is final: nobody reopens a Completed Ticket, and a Customer who needs help again opens a new one. "Waiting on customer" is not a status: it is shown while the last Message came from Staff, and is never set by hand.
_Avoid_: Closed, claimed, cancelled

**Linked order**:
The Customer's Order a Ticket is about. Optional: a Ticket can have none, and must be one of that Customer's own Orders. The Ticket list shows "None yet" when there is no Linked order.
_Avoid_: Related order, attached order

**Overdue**:
An Open Ticket whose last Message came from the Customer and has gone more than 24 hours without a Staff reply. A new Ticket nobody has answered counts. A Ticket waiting on the Customer is never Overdue. The limit is the same for every Priority.
_Avoid_: Late, breached

**Priority**:
How urgently a Ticket needs attention: Low, Normal, High or Urgent. Defaults to Normal and is set by Staff.
_Avoid_: Severity, urgency

**Claim**:
Staff take a Ticket for themselves to answer it; nobody assigns a Ticket to someone else. A Ticket has at most one Claimer, the Staff member shown as "Assigned to" in the design. A Ticket nobody has claimed is Unclaimed. Any Staff can claim an Unclaimed Ticket; only the Claimer can chat with the Customer, so a Ticket must be claimed before it is replied to. A Ticket Staff open is claimed by the Staff member who opened it. Only the Claimer can release a Ticket back to Unclaimed; nobody can take a claimed Ticket from its Claimer.
_Avoid_: Assign, owner, agent

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

**Feedback request**:
The one email and in-app Notification sent to a Customer 2 days after an Order is marked Delivered, linking to that Order's Feedback form. Sent once per Order, with no reminder, and not sent if the Customer has already given Feedback.
_Avoid_: Survey, review request

**Conversation**:
The live two-way chat inside one Ticket, between its Customer and Staff. Every Conversation belongs to exactly one Ticket; there is no chat without a Ticket. The Conversations page is Staff's inbox of these chats, and the Ticket page shows the same chat.
_Avoid_: Chat thread, inbox message, Messenger or Instagram chat
