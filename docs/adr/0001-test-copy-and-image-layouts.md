# Test copies and image layouts for Announcements

Status: accepted (ticket #107)

## Context

Staff need to see an Announcement in a real inbox before it goes to Subscribers, and an Announcement with several images should look like a social post's photo grid, not a column of full-width pictures. Both touch the notifications service, which is a separate project, and the `crms` schema, which is shared and live.

## Decision

**A test copy is the real Marketing Email, sent to one address.**
- `sendTestCopy` sends the saved Announcement through the same gateway route as a real send (`POST /notifications/emails/marketing`, as the `crms` Caller), so it shows what Subscribers would see. It is not a separate "preview" email.
- The address is the signed-in Staff member's, read from the Portal session in the server action. It is never a parameter the caller can set.
- The notifications service requires the sender to assert `subscriberConsent: true`. For a test copy that assertion stands for the Staff member's own consent to receive it. It does not make them a Subscriber.
- Nothing is written to `announcement_recipients`, so no Customer Profile lists it, and the Announcement's state is unchanged. A test copy works in any state.
- It is audited after the gateway accepts it, as `record.viewed`: the CRMS audit catalog has no send action, and a test send changes no record. The description says it was a test copy. A failed audit does not undo the send.
- It sends the saved Draft, not unsaved edits, and the confirmation says so. The button is disabled until the Draft is saved.
- It carries no Unsubscribe link until the storefront Unsubscribe endpoint exists.

**One image layout per Announcement, chosen from layouts that hold exactly its images.**
- The layouts are named (`single`, `two-columns`, `two-rows`, `three-feature-left`, `three-feature-top`, `three-row`, `four-grid`, `four-feature-left`, `four-feature-top`) plus `stacked`, which is every image full width. From five images only `stacked` is offered; there is no "+N" tile.
- The choice is stored in the nullable `crms.announcements.image_layout`. Null means the default for the number of images, so existing rows need no backfill.
- The layout in use is derived when an Announcement is read: Staff's choice if it still fits the images, else the default. Adding or removing an image therefore never leaves a stale layout, and the form only sends a layout Staff actually picked.
- Saving refuses a layout that does not fit the images being saved (`layout-mismatch`).
- The notifications template takes an optional `imageLayout`. Without one, or with one that does not fit the images it was given, it renders `stacked` as before, because a send is not worth failing over a layout.
- The collages are table-based email HTML with `object-fit: cover` tiles. Some Outlook versions ignore `object-fit` and will stretch the images.

## Consequences

- The layout geometry exists twice, in `features/marketing/image-layouts.ts` (the preview and picker) and in the notifications service's `src/templates/image-layouts.ts` (the email). They must be changed together, and nothing checks that they agree.
- The column must exist on the live `crms.announcements` before this code is deployed, because every Announcement query reads it. It was added on 2026-10-22 (`docs/db/crms-announcements-image-layout.sql`).
- The notifications change must be deployed before test copies of Drafts with images can succeed, because the service rejects an unknown field.
- Reusing the real send path means a test copy fails the same way a real send would when the gateway or notifications service is down, which is the point.
