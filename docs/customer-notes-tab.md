# Customer notes on the Profile (#423)

The Notes & tasks tab preloads Customer notes with the Profile. The tab component is included in the Profile bundle, so both code and data are ready before the tab is selected; selecting it needs no additional request. Undefined data shows a skeleton; a failed read shows an unavailable message instead of an empty list.

Staff and Managers get the composer. Admin get the same notes and timeline without write controls. The existing #419 server action checks permissions, validates the 2,000-character limit, stores permanent notes and audits without note text. This slice adds no schema changes or migrations; the existing `docs/db/crms-customer-notes.sql` migration is a deployment prerequisite.

Saving requires confirmation, then immediately adds an attributed Customer note marked saving… in both the list and timeline. A refusal removes it from both and displays the server's reason. The draft survives refusals and tab switches. A transport retry reuses the operation id. The mounted tab keeps an in-flight save intact when another Profile tab is selected.

The Profile stays within the viewport and the content containers scroll. No timers, focus requests or polling are added. Rendered tests fake only the server action and page boundaries; backend behavior remains covered by `tests/customer-notes.test.ts` against the test database.
