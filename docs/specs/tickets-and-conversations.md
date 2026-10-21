# Tickets and Conversations

## Problem Statement

Customers can already open a Ticket and chat in the storefront, but nobody answers: CREOMS has no Tickets or Conversations pages, so a Customer's Ticket sits unanswered. Staff have no place to see which Tickets are open, which are Overdue, who is on each one, or to reply to a Customer. Customers also cannot see when Staff consider a problem dealt with, and have no way to confirm it.

## Solution

Add a Tickets Module to CREOMS with two pages, built exactly to the Figma design inside the existing sidebar and header (only the two tabs are added):

- **Tickets**: a list with Open, Waiting on customer and Resolved tabs, and a Ticket page with the Conversation, a Linked order card and a Customer card.
- **Conversations**: Staff's inbox of Ticket chats, in three columns: the list, the chat, and the Customer and Ticket cards.

Staff Claim Tickets, reply live, and mark them Resolved. The Customer confirms the Ticket as Completed from the storefront, or it completes itself after 3 days. Live delivery goes through the api-gateway and notifications service. Attachments go through file-storage. Emails go through the notifications service. Ecommerce and CREOMS share one database, with ecommerce owning the schema.

## User Stories

1. As Staff, I want a Tickets page in the sidebar, so that I can find the Tickets I need to answer.
2. As Staff, I want the Tickets and Conversations tabs to appear only if I have the Tickets Module, so that access follows the Portal.
3. As Staff without the Tickets Module, I want both pages to be blocked, so that I cannot open Tickets by typing the address.
4. As Staff, I want an Open tab listing every Open Ticket, so that I see all the work in front of me.
5. As Staff, I want a Waiting on customer tab, so that I can see Tickets where the Customer owes a reply.
6. As Staff, I want a Resolved tab listing Resolved and Completed Tickets, so that I can look back at finished work.
7. As Staff, I want a count on each tab, so that I know how much is in each.
8. As Staff, I want the page subtitle to show how many Tickets are open and how many are Overdue, so that I see urgency at a glance.
9. As Staff, I want each Ticket row to show its TKT number, subject, Customer, Linked order, Priority and status, so that I can triage from the list.
10. As Staff, I want a Ticket with no Linked order to say "None yet", so that a missing order is not mistaken for a gap in the data.
11. As Staff, I want Overdue Tickets to be clearly marked, so that I answer them first.
12. As Staff, I want a Ticket to be Overdue only when the Customer's last Message has had no Staff reply for 24 hours, so that Tickets waiting on the Customer never look late.
13. As Staff, I want a brand-new Ticket nobody has answered to count as Overdue after 24 hours, so that it cannot be forgotten.
14. As Staff, I want lists sorted by newest activity first, 25 to a page, so that the busiest Tickets are on top.
15. As Staff, I want to open a Ticket from its TKT number, so that I can read and answer it.
16. As Staff, I want the Ticket page to show the subject, status, when it was opened, who Claimed it and its Priority, so that I have the full picture.
17. As Staff, I want the Conversation on the Ticket page to show every Message with sender and time, so that I can read the whole exchange.
18. As Staff, I want to send a Message from the Ticket page, so that I can answer the Customer.
19. As Staff, I want to attach one JPG or PNG image of up to 5 MB to a Message, so that I can show the Customer something.
20. As Staff, I want to see images the Customer attached, so that I can understand their problem.
21. As Staff, I want a Message to appear for the Customer immediately if they are connected, so that the chat feels live.
22. As Staff, I want a Customer's Message to appear in my open Conversation without a refresh, so that I do not miss it.
23. As Staff, I want a sent Message to be permanent, so that the record of what we told the Customer is trustworthy.
24. As Staff, I want to Claim an Unclaimed Ticket, so that the Customer knows who is looking after them.
25. As Staff, I want to be unable to chat on a Ticket until I Claim it, so that only the Claimer talks to the Customer.
26. As Staff, I want to release a Ticket I Claimed, so that someone else can take it if I cannot continue.
27. As Staff, I want no one to be able to take a Ticket from its Claimer, so that two people do not work on one Ticket.
28. As Staff, I want to mark a Ticket Resolved when I think the problem is dealt with, so that the Customer is asked to confirm.
29. As Staff, I want to be unable to mark a Ticket Completed, so that only the Customer closes it.
30. As Staff, I want a Ticket the Customer says is not fixed to return to Open, so that I pick it up again.
31. As Staff, I want a new Customer Message on a Resolved Ticket to reopen it, so that a late reply is not lost.
32. As Staff, I want a Linked order card with a link to the Order, so that I can check the Order without searching.
33. As Staff, I want the Linked order card hidden when there is no Linked order, so that the page is not cluttered.
34. As Staff, I want a Customer card showing the Stage, order count, total spent and a link to the Customer Profile, so that I know who I am talking to.
35. As Staff, I want to open a Ticket on a Customer's behalf, so that I can record a problem that came in by phone or in person.
36. As Staff, I want the New ticket dialog to take a subject, a Customer, an optional Linked order, a Priority, a description and one optional image, so that the Ticket is complete from the start.
37. As Staff, I want the Customer search in the New ticket dialog to find only real Customers, so that I cannot open a Ticket for a Walk-in Customer.
38. As Staff, I want the Linked order list to show only the chosen Customer's Orders, so that I cannot link someone else's Order.
39. As Staff, I want the description I write to become the first Message the Customer reads, so that I write it for them.
40. As Staff, I want a Ticket I open to be Claimed by me, so that I do not have to Claim it afterwards.
41. As Staff, I want a Priority of Low, Normal, High or Urgent, defaulting to Normal, so that I can flag what matters.
42. As Staff, I want the Conversations page to list Ticket chats with Customer name, last Message preview, time and TKT number, so that I can pick one quickly.
43. As Staff, I want to select a chat and read and reply in the middle column, so that I can work through several chats from one place.
44. As Staff, I want the Conversations page's right column to show the Customer and Ticket cards, so that I have context without leaving the page.
45. As Staff, I want Claim, Release and Mark resolved on the Ticket card of the Conversations page, so that I can manage the Ticket without switching pages.
46. As Staff, I want a Ticket notification in the bell when a Customer raises a new Ticket, so that Unclaimed Tickets get seen.
47. As Staff, I want the Claimer alerted when the Customer sends a Message, so that I notice replies on my Tickets.
48. As Staff, I want every Staff member with the Tickets Module alerted about a Message on an Unclaimed Ticket, so that someone picks it up.
49. As Staff, I want the Claimer alerted when the Customer says a Ticket is not fixed, so that I reopen it promptly.
50. As Staff, I want no alert when a Customer confirms a Ticket Completed, so that I am not interrupted for something needing no action.
51. As Staff, I want the sidebar and header to stay as they are, so that the experience matches the other Modules and the Portal.
52. As a Customer, I want to open a Ticket and chat with Staff live, so that I get an answer without waiting for email.
53. As a Customer, I want Staff replies to appear in my open chat immediately, so that I do not have to refresh.
54. As a Customer, I want a Notification in the storefront when Staff reply and I am not connected, so that I know to come back.
55. As a Customer, I want an email when Staff open a Ticket for me, so that I know a record exists and can follow it.
56. As a Customer, I want an email asking me to confirm when Staff mark my Ticket Resolved, so that I can say whether it is fixed.
57. As a Customer, I want that email's button to take me to my Ticket, where I can choose "Yes, it's fixed" or "Not fixed", so that I decide.
58. As a Customer, I want confirming to make the Ticket Completed and send me a thank-you, so that it feels finished.
59. As a Customer, I want "Not fixed" to reopen the Ticket for Staff, so that my problem is not closed over my head.
60. As a Customer, I want to send a Message on a Resolved Ticket to reopen it, so that I can add something I forgot.
61. As a Customer, I want a Resolved Ticket I ignore to complete itself after 3 days, so that old Tickets do not stay open forever.
62. As a Customer, I want to be told in the thank-you email when a Ticket completed by itself, so that it is not a surprise.
63. As a Customer, I want to complete my own Ticket at any time, even if Staff have not marked it Resolved, so that I can close what I no longer need.
64. As a Customer, I want a Completed Ticket to stay Completed and be told to open a new Ticket if I need help again, so that history stays clear.
65. As a Customer, I want to attach one image to a Message, so that I can show a problem.
66. As a Customer, I want my Tickets to show Priority-independent status (Open, Resolved, Completed), so that I can tell where each stands.
67. As the store owner, I want Staff identity to stay out of the storefront database beyond an id and a name snapshot, so that the separation of staff and Customers holds.
68. As the store owner, I want CREOMS to be able to write only Tickets and Messages in the shared database, so that a bug cannot touch Orders or Customers.

## Implementation Decisions

**Domain**
- Vocabulary follows CONTEXT.md: Ticket, Ticket status, Conversation, Message, Claim, Priority, Overdue, Linked order, Ticket number, Ticket notification.
- Ticket status is Open, Resolved or Completed. "Waiting on customer" is derived from the last Message coming from Staff and is never stored.
- Staff mark Resolved; the Customer's confirmation, or 3 days of silence, makes Completed. A Customer can complete at any time. Completed is final.
- A new Customer Message, or "Not fixed", returns a Resolved Ticket to Open. Staff can never set Completed.
- A Ticket has no Channel. The Figma's Channel column and labels are removed.
- A Conversation is the chat inside one Ticket. There is no chat without a Ticket, so the Conversations page is an inbox of Ticket chats only. "Not matched", Convert to ticket, Compose, Create order, Add to segment and the whole "Resolve with" card are out of v1.
- Claim replaces assign. Customer-raised Tickets start Unclaimed. Only the Claimer replies, so a Ticket is Claimed before it is answered. A Ticket Staff open is Claimed by its opener. Only the Claimer releases; nobody takes a Claimed Ticket. The Figma's "Assign to" pickers are removed.
- Overdue: an Open Ticket whose last Message is from the Customer and unanswered by Staff for more than 24 hours, the same for every Priority.
- Walk-in Customers cannot have Tickets.
- Staff's description when opening a Ticket becomes the first Message and is visible to the Customer.

**Schema (owned by the ecommerce app; additive, defaulted, so existing Tickets keep working)**
- New Ticket columns: Priority (default Normal), the Claimer's opaque id plus a display-name snapshot, the time it was marked Resolved, and the new status values.
- New Message column for the file-storage file id of an attachment. Old attachments stay in Vercel Blob and show only on the storefront.
- The Ticket number is the existing integer id, formatted as TKT-.
- CREOMS runs no migrations against Ticket tables.

**Database access**
- A new `creoms_tickets` database role with write access to only the Ticket and Message tables, in addition to the existing read-only role. The existing `crms`-only writer role stays limited to `crms`. The role SQL is written for the owner to run; nothing creates roles on production.
- Staff Messages record the Staff member's opaque id and a name snapshot.

**Live delivery and files**
- Live Conversations use the api-gateway's Live ticket and the notifications service's conversation relay. Each app saves a Message to the shared database first, then relays it. The relay stores nothing.
- The storefront's Redis tab sync is retired once it is on the gateway.
- Attachments are Private Files in file-storage, reached through the gateway and Linked to the Message: JPG or PNG, up to 5 MB, one per Message.
- The gateway needs a Caller key for CREOMS.

**Access**
- One Portal Module, "Tickets", covers both pages. It must be registered in the Portal and granted to Staff there. Both sidebar tabs show only with the Module. The dev bypass behaves as for Customer Profiles.

**Notifications and email**
- Ticket notifications go through the existing bell and toast: a new Ticket alerts everyone with the Module; a Customer Message or "Not fixed" alerts the Claimer, or everyone with the Module while Unclaimed; a Customer completing raises none.
- Customer emails are sent as App emails (title, body, one optional button): Staff opened a Ticket for you; please confirm (button to the storefront Ticket page); thank-you on Completed, worded differently for auto-complete. An offline Customer gets a storefront Notification for Staff replies, not an email.

**Auto-complete**
- A daily scheduled job in the ecommerce app completes Tickets Resolved 3 or more days ago and sends the thank-you. A Ticket therefore completes between 3 and 4 days after Resolved.

**UI**
- Built exactly to the Figma frames for Tickets list, Ticket detail, Conversations and New ticket. Sidebar and header are untouched apart from adding the two tabs. The Customer card and Linked order card link to existing CREOMS pages.
- The storefront's Reopen button is removed. New storefront controls: confirm, "Not fixed", complete.

**Delivery order (thin vertical slices)**
1. Ecommerce: migration and `creoms_tickets` role SQL.
2. CREOMS: Tickets list, tabs, counts, Overdue, Tickets Module and the two tabs (read-only).
3. CREOMS: Ticket page with Claim, Release, reply, attachments, Mark resolved.
4. Live chat on both sides through the gateway.
5. CREOMS: New ticket dialog.
6. CREOMS: Conversations inbox.
7. Ticket notifications in the bell.
8. Ecommerce: Customer confirm and "Not fixed", the three emails, the daily job, Reopen removal.

## Testing Decisions

- A good test checks behaviour a person can see, such as which Tickets a tab lists, what status a Ticket ends in, who gets notified or emailed, never how it is built.
- **Seam 1, ecommerce Ticket store**, against PGlite with real migrations and injected email and relay dependencies. Covers status rules, reopen on a Customer Message, the confirm and "Not fixed" actions, complete-at-any-time, auto-complete after 3 days, and the three emails. Prior art: the existing Ticket store tests.
- **Seam 2, CREOMS Tickets data layer**, against PGlite. Covers tabs and counts, Overdue, Claim and Release, reply requiring the Claim, Mark resolved, opening a Ticket as Staff, the Customer search excluding Walk-ins, the Linked order list limited to the Customer, the Conversations inbox, and Ticket notification recipients. Prior art: the Walk-in and notification data tests.
- **Seam 3, CREOMS pages through the fake Portal**, covering Module gating of both pages and both sidebar tabs. Prior art: the sidebar access and access tests.
- The live relay is replaced by a fake at the Live ticket boundary. No test needs a real gateway, notifications service or file-storage.

## Out of Scope

- Messenger, Instagram and email channels, and any Channel field.
- Compose, Convert to ticket, Create order (bulk quote), Add to segment, and the "Resolve with" actions (replacement order, refund, return).
- Tickets for Walk-in Customers.
- Reassigning or taking over a Claimed Ticket, and releasing a stuck Ticket after inactivity.
- Search on the lists, per-Priority Overdue limits, and manager roles.
- Migrating old Vercel Blob attachments to file-storage.
- Several images per Message.

## Further Notes

- Two steps live outside this repo: registering and granting the Tickets Module in the Portal, and getting a gateway Caller key for CREOMS.
- Ecommerce changes ship as separate PRs from CREOMS ones, with the ecommerce migration first because CREOMS depends on the new columns.
- This spec was not published to the issue tracker, at the owner's request.
