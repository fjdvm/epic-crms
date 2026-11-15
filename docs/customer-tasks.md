# Customer Tasks backend (#420)

Tasks belong to verified Customers and live in `crms.customer_tasks`, with no foreign key into storefront tables. The five server actions in `features/customer-profiles/task-actions.ts` require the Customer Profiles Module and a stable caller-generated operation id. Staff create their own Tasks and can mark done, reopen or change due dates only while they own them. Managers may do those actions for any owner and may assign at creation or reassign. Assignment resolves the canonical name from the Portal and requires an active Staff or Manager with Customer Profiles access. Admin and CEO writes are refused. There is no edit-description or delete action.

The Profile loader includes Tasks open first, sorted by due date within each state. `tasks: null` means the Task store is unavailable. Due dates are `YYYY-MM-DD` strings; overdue means open with a due date earlier than today's date in Asia/Manila. Dates are not interpreted in the database session's timezone.

Operation receipts are committed atomically with changes, retaining the original result and audit payload. Actor-scoped operation ids cannot be reused for a different request. Concurrent duplicate requests serialize and return the original receipt, even after later changes. Audit delivery uses the existing gateway boundary and its stable idempotency key; due-date and reassignment metadata retain old and new values. Task receipts use acknowledged gateway delivery; failures leave the audit payload pending for a retry of the same action. The gateway deduplicates uncertain deliveries. Other modules retain their existing best-effort audit policy. No polling or automatic Task actions are added.

## Migration

`docs/db/crms-customer-tasks.sql` is additive and rerunnable, and is also included in the full schema document. Apply it as `creoms_writer` before deployment. The runner converts Neon pooled endpoint hostnames to their direct equivalents and uses a direct connection and wraps the migration in a transaction:

```sh
node --env-file=.env.migration.azure-writer scripts/deploy/migrate-customer-tasks.mjs
```

The environment file must supply `CREOMS_WRITER_DATABASE_URL`. Production execution and reading production secrets require the owner's approval of this exact command. Production execution is recorded in the verification issue linked from the implementation PR.

## Verification

`tests/customer-tasks.test.ts` calls the server actions against PostgreSQL through PGlite and a real postgres.js connection, loading the migration twice. It covers all four Roles, ownership, fixed description and input limits, all five actions, replay and concurrent retries, old/new audit metadata, failed audit-adapter delivery, Profile integration and Task-store failure, and the Philippine midnight boundary. Production migration and live checks are tracked separately.

## My tasks read (#424)

`loadMyTasks()` in `features/customer-profiles/my-tasks.ts` proves the Customer Profiles Module and derives the owner from the signed-in viewer. All four Roles can read their own list, including Managers; there is no owner argument or team view. It returns open Tasks across Customers, ordered by due date, creation time and id, with Customer id/name and an overdue flag. Customer names are loaded through the storefront read-only connection. A missing Customer retains the Task with `Customer unavailable`; a failed read returns an unavailable result rather than zero counts.

The list and three counts share one SQL snapshot and one captured clock value. Due today and overdue use the Asia/Manila calendar date. Done this week counts currently completed Tasks owned by the viewer (regardless of who marked them done), within the Monday 00:00 inclusive to following Monday 00:00 exclusive Manila week. Reopening removes the Task from that count and restores it to the open list. Existing Task actions revalidate `/my-tasks`; no timer or polling is introduced.

`tests/my-tasks.test.ts` exercises the public read and existing actions against the real PostgreSQL test engine and postgres.js connection, including every viewing Role, Customer identity, ownership, done/reopen/reassign, database timezone independence, Manila midnight, Monday/year boundaries, authorization and store failure. This slice reuses #420's schema and migration; it adds no migration or production command.

## My tasks screen (#426)

`/my-tasks` (sidebar link under CUSTOMERS, shown with the Customer Profiles Module) renders `loadMyTasks()` as the Due today, Overdue and Done this week counts plus a Task, Customer and Due table, with each Customer linking to their Profile. Staff and Managers get **Mark done**: a confirm dialog, then the row leaves and the counts move at once; a refusal or lost connection restores the row and shows the plain reason. Admin and CEO see the list without the button. `loading.tsx` shows the header and a skeleton immediately; the page is fixed with the list scrolling inside. No polling; the action revalidates `/my-tasks`. Not built: the From column, Log call, Write message, Add task and team view. No migration.
