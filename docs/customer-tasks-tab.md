# Tasks on the Customer Profile

The **Notes & tasks** tab shows a Customer's Tasks above the Customer notes (`features/customer-profiles/tasks-tab.tsx`). Open Tasks come first (soonest due), then done Tasks. Open Tasks also appear at the top of the Profile, and Task created / Task done appear in the Activity timeline with the Staff member's name.

- **Staff and Managers** add a Task, mark it done, reopen it and change its due date. Each shows a confirm dialog first, then updates at once ("saving…") and rolls back with the server's plain reason if refused. Staff can only change their own Tasks (the server enforces this); Managers can change any.
- **Reassign** is Manager-only (confirm dialog, owner list from `listTaskOwners`). Staff see a disabled **Request approval** button; the approval flow is not built yet.
- **Admin** see Tasks with no controls.
- A Task is overdue when it is not done and its due date is before today in Philippine Time; the screen recomputes this on every optimistic change.
- No schema change: the tables came with the Task backend (#424). No polling.
