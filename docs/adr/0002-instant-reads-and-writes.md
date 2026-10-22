---
status: accepted
---

# Instant reads and writes: region first, then caching tiers and optimistic writes

Pages, creates, updates and deletes felt slow in CREOMS, the Portal and the storefront because Vercel ran all three on `iad1` (Washington, D.C.) while every database is in Singapore (`ap-southeast-1`), so each query crossed the Pacific. We decided to fix the latency at its source first by moving all three projects' functions to `sin1`, then layer caching and optimistic writes on top, rolling out CREOMS first, then the storefront (ecommerce), then the Portal, one branch and one issue each, with a baseline timing taken before each change.

## Decisions

- **Region:** functions run in `sin1`, next to the databases and close to Staff and customers in the Philippines.
- **Read freshness tiers.** The Customer Profiles list, Feedback and Announcements may be up to 3 minutes old and are cleared by any CREOMS write. Tickets and Conversations show the cached page at once and refresh in the background, never older than about 15–30 seconds, because Customers change Tickets from the storefront, where CREOMS cannot clear its cache. Notifications and unread counts are never cached.
- **Optimistic writes** only for low-risk, reversible actions: claiming or releasing a Ticket, marking a notification read, saving or deleting an Announcement Draft, and adding or editing a Walk-in Customer. A Customer Message shows as "sending…" until the server confirms. If the server refuses, the change rolls back and says why.
- **Never optimistic:** sending an Announcement, placing an Order and anything with an outside effect or payment. These wait for the server and show a spinner within 100 ms.
- **Targets, not guarantees:** reads under 100 ms from cache and 500 ms on a first visit; writes react in under 100 ms and confirm in under 500 ms. Each is tuned to what the baseline shows is achievable, and a flow that misses gets its own follow-up issue.

## Considered options

- **Optimistic everything:** rejected. A refused email send or Order would already have been shown to the user as done.
- **Long shared server cache for Tickets:** rejected. Storefront writes cannot invalidate it, so Staff would miss a new Customer Message.
- **Caching without moving the region:** rejected as the first step. It hides the latency on repeat visits but leaves every first visit and every write slow.
