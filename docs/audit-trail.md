# CREOMS Audit Events

Announcement actions and Feedback analysis use `AuditTrail` in `lib/audit-trail.ts`.
Tests replace that function with a fake. `recordAudit` contains the shared
best-effort policy, including protection against a throwing injected port.
The gateway adapter also applies it when called directly.

Producers supply an operation identity. Feedback uses its persisted run id;
Announcement forms generate a token for each submitted action and pass it as a
serialized Server Action argument. A transport replay retains that token; a new
action gets a new one even within the same millisecond. Draft creation derives
its UUID from the Staff id and request token and inserts only once, so replaying
a save also retains its Target. Scheduled sends generate
a token when they record their result; their persisted state prevents resending a
completed action. The gateway hashes the action, Target and operation identity into the
`idempotency_key` accepted by audit-logs. It adds Source `CRMS`, authenticates as
the `crms` Caller and bounds the request to five seconds. There is no retry queue.

Staff events carry Actor type `user`, the Portal User id and the display name at
the time of the action. Scheduled Feedback analysis remains a `process` Actor.

## Portal identity confirmation

The Portal's `lib/integrations/endpoints.ts`, `handleValidate`, returns
`user_id: result.userId`. Its `lib/integrations/validation.ts` gets that value
from `session.userId`; `lib/integrations/prisma-ports.server.ts` looks up the
User with `where: { id: userId }`. The profile's `username` is a different field.
CREOMS maps validation's `user_id` to `Staff.id`; it never substitutes a username
for a missing id. Announcement scheduling now persists this User id for the
scheduled send's Actor as well.

## Migration check for #257

On 2026-10-27 the configured CREOMS writer database contained zero Announcements
with `state = 'scheduled'`. There were therefore no pending schedule usernames
to convert. No schema changes are needed; earlier Audit Events are not backfilled.
