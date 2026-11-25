<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## UI foundation and CREOMS reference (Figma)

- **UI foundation, always use:** [Bren Raphael's CRM - Orders Prototype, node 836:11278](https://www.figma.com/design/76nS6Pw2TXA6fWfUvTmzJ1/Bren-Raphael-s-CRM---Orders-Prototype?node-id=836-11278&p=f&t=BDZjt3iVMQxKa5U7-0). Build every UI from it: reuse its components, tokens, spacing and layout.
- **CREOMS reference:** [Bren Raphael's CRM - Orders Prototype, node 0:1](https://www.figma.com/design/76nS6Pw2TXA6fWfUvTmzJ1/Bren-Raphael-s-CRM---Orders-Prototype?node-id=0-1&p=f&t=BDZjt3iVMQxKa5U7-0). Consult it for how CREOMS screens and flows should look.

- **Additional references (refer to these for every issue, now and later):**
  - [CRM - Orders Prototype, node 0:1 (alternate link)](https://www.figma.com/design/76nS6Pw2TXA6fWfUvTmzJ1/Bren-Raphael-s-CRM---Orders-Prototype?node-id=0-1&p=f&t=U6jCdaCh8OVliOcC-0)
  - [Bren Raphael's UI/UX Redesign, node 4:2](https://www.figma.com/design/eylSWUgpECPu1EjkFHNvUN/Bren-Raphael-s-%E2%80%94-UI-UX-Redesign?node-id=4-2&p=f&t=RrP0eFROL4GpoPXz-0) (file key `eylSWUgpECPu1EjkFHNvUN`)
  - [Bren Raphael's UI/UX Redesign, node 4:5](https://www.figma.com/design/eylSWUgpECPu1EjkFHNvUN/Bren-Raphael-s-%E2%80%94-UI-UX-Redesign?node-id=4-5&p=f&t=RrP0eFROL4GpoPXz-0)

Fetch them with the Figma MCP tools (`get_design_context`, `get_screenshot`; file keys `76nS6Pw2TXA6fWfUvTmzJ1` and `eylSWUgpECPu1EjkFHNvUN`) before building or changing UI.

## Roles and permissions (rule)

Every feature, screen and ticket must follow these roles. Where a ticket or the code disagrees with this section, this section wins; raise the conflict instead of silently picking one. The roles are also in the Figma CRM prototype (page `0:1`, section "Roles & access", node `577:10412`). On 2026-11-23 the owner decided that CEO, VP, CREOMS Manager and General Manager have the same access and permissions, and removed the CEO's separate final approval over the Approval limit. The Figma "Roles & access" section and the per-screen notes still show the CEO as read-only and need the same change; until then this section wins.

### Read the Figma notes on every screen

Every screen in the CRM prototype has a dark note card beside it stating who can open it and what each role may do (for example "Access: Staff · CREOMS Manager · Admin (view) · CEO (view)", where "(view)" means read-only; a "CEO (view)" note is out of date, since the CEO now acts as a Manager, and "Staff see 'Request approval' on Manager-only actions"). Frames also carry rule text, such as the approval rules on the Payments, Fulfilment and Returns screens. Before building or changing any screen, read the notes on that screen and on the "Roles & access" section, and follow them. If a note disagrees with this section, raise it instead of silently picking one. The notes are text layers on the canvas, not Figma comments (the comments API returns nothing for them); a `get_metadata` dump of the page can be searched for them.

### Staff / Employee

Handle the shop's daily work and can do anything that is easy to undo. Dashboard shows only their own work for the day.
- **Customer Profiles:** add and edit customers; write notes and tasks.
- **Orders:** confirm orders, quote the delivery fee, check the cash-on-delivery flags. Orders are placed by Customers on the storefront; Staff never create them (the one exception is the Replacement Order, made when a Manager approves a replacement).
- **Payments:** check payment proofs (GCash, Maya or bank transfer, all manual), mark orders paid, ask a customer for a new proof. When a payment reference was already used on another Order, "Mark paid" is stopped for Staff (they see "Request approval"); a Manager can approve it anyway, with a reason.
- **Fulfilment:** pack, dispatch with the Lalamove or Grab link, mark orders delivered, record failed deliveries.
- **Returns:** inspect what came back, record whether it goes back to stock or gets written off, request a replacement or refund.
- **Tickets and Conversations:** claim, reply, put tickets on hold, escalate, resolve, write internal notes, use AI assist.
- **Feedback:** reply to customers.
- **No access** to Reports or the Portal.
- When they try something that needs a Manager, they see "Request approval" instead of the button.

### CREOMS Manager (also General Manager, CEO and VP)

**General Manager, CEO and VP** have exactly the same access and permissions as a CREOMS Manager (in code they all map to the `manager` shop Role). Tickets can be assigned only to Staff / Employee, CREOMS Manager and General Manager; never to Admin, CEO or VP, even though CEO and VP act as Managers. Staff only claim for themselves; a Manager assigns anyone.

Everything Staff can do, plus approvals and reports. Dashboard shows the whole team and the approvals waiting for them.
- **Approves** anything involving money, removing stock, overriding an AI warning, or moving someone else's work: refunds and "approve anyway" on payments, cancelling an order after dispatch, approving replacements, refunds and store credit on returns, holding a bad batch, extending the 24-hour return window. One Manager-level approval is final at any amount; there is no second CEO step. A request left waiting from the old CEO step is finished by any Manager-level person.
- **Tickets:** reassign tickets, move all of an absent teammate's tickets at once, take escalations.
- **Customers and feedback:** merge duplicate customers, send win-back offers, publish or hide reviews, open the complaint themes.
- **Reports:** view the fulfilment and ticket reports.
- **Management:** Commerce Settings: Payment accounts, free-delivery threshold, Payment window, Automatic checks and Service levels. Only Manager-level Roles (CEO and VP included) open Management; Staff and Admin cannot. The Portal is not for Managers (the CEO's Portal access is decided in the Portal repo).

### Admin

Runs the system, not the shop.
- **Portal:** full control of User management and user account requests (every account and role is created by an Admin); full control of Activity logs, System logs and System health. The Portal has no Settings screen: the Automatic checks and Service levels live in Commerce Settings under Management, with the Payment accounts.
- **CREOMS:** can view every module, including reports. Does not approve business decisions such as refunds or write-offs.

### For everyone

AI never acts on its own. Anything sent to a customer, or that changes an order, ticket or payment, needs a person, and every accepted AI suggestion is logged with that person's name.

**One exception, the Order assistant.** It may answer a signed-in Customer about their own Orders and the shop, read-only, and may show a Handoff summary that the Customer approves before it goes to the team. This is the one place AI words reach a Customer without a person reviewing them. Its limits: read-only (it never changes, cancels or refunds anything), own data only (never another Customer's Order), and no promises about refunds, discounts or replacements; those go to a person as a Ticket.

**Second exception, the Proof reader.** The owner authorized OCR that reads a payment proof (Customer upload) or a refund proof (Staff upload) by itself, because Staff need the findings ready when they open it. Its limits: it runs in the background after the proof is saved, and the Customer's submit never waits for it; it only extracts details, compares them with the Order's facts and writes findings; it never approves or rejects a payment or refund, changes an Order or payment status, or sends anything to a Customer; if it fails or times out the proof is kept and shows Needs Review; findings are visible only to Staff and Managers (Admin views, never causes a call); the model gets only the proof image and the minimum comparison facts, no other personal details; one result is stored per saved proof, so retries never run it twice, and a replacement proof gets its own check; Staff must verify the real transfer with the payment provider before marking Paid or Refunded; outcomes and the deciding Staff member's name go to the Audit Logs. Matching details are supporting evidence only, not proof of payment or of the image's authenticity.

**Third exception, the ID reader.** On 2026-11-23 the owner authorized OCR and a vision model to read an uploaded Senior/PWD ID photo by itself, so a Manager has the anomalies ready when they open the check. Its limits: it runs in the background after the storefront signals the upload, and the Customer never waits for it; it only reads the photo and writes findings and flags (photo unreadable, not an ID, possibly edited, name not matching the account, expired, a different ID type, the typed number differing from the one read off the photo, a photo like one sent from another account); it never approves or declines a verification, changes anything, or sends anything to a Customer; the model gets only the photo, never the account name or ID number, and is told not to read the number; the ID number is never stored or logged (the storefront compares the number read off the photo itself and passes only "matched", "differs" or "unread"); if it fails or the photo is gone the check shows Needs Review; findings are visible only to Staff and Managers (Admin views, never causes a call); one result is stored per verification, so retries never run it twice. Approving or declining an ID check is a Manager-level decision: Staff check the ID and see "Request approval".

**AI features have fixed defaults.** Their numbers, caps and lists are fixed in code. There are no Admin AI settings and no kill switch, and Admin views AI results but never causes a model call.

## Checks and PR completion

1. Before every push, run `npx next typegen`, `npx tsc --noEmit`, and `npm test`. Push only after all pass.
2. Open or update the ticket's PR. Until the owner enables auto-merge and the `main` ruleset requiring a PR and `ci-gate`, leave it for owner merge and stop. After both settings are verified, enable squash auto-merge with `gh pr merge <PR> --auto --squash` and stop when GitHub accepts it.
3. If waiting for PR checks is unavoidable, use one blocking `gh pr checks <PR> --watch --fail-fast` command. Never loop on status commands.
4. Never wait for production deployment. GitHub's failed-workflow notification emails the owner; Azure retains the previous revision if deployment fails.
5. Track required live-production checks in a separate verification ticket.

## Hosting: Azure, not Vercel

Production runs on Azure (Container Apps) with the database on Neon. Do not use Vercel tools, the Vercel CLI or `vercel env pull` in this repo. Environment variables and secrets live in the Azure Container App and GitHub Actions secrets. The owner pre-approves database migrations needed to complete requested work, including production migrations, using the available `.env` variables. Apply and verify those migrations without asking for command-by-command approval. Destructive data operations outside the requested migration still need explicit approval. Reading production secrets outside the authorized `.env` files needs the owner's explicit approval for that exact command.

## No polling

No app polls (ADR-0005 in the Portal repo, `docs/adr/0005-no-polling-anywhere.md`). Never repeat a data request on a timer, window focus or tab visibility; use the WebSocket, refetch on (re)connect, or refetch on a user action. A 30–60 second in-memory heartbeat is a keepalive, not polling, and timers that never touch the network (clocks, countdowns) are fine. Idle-tab check: `tests/no-polling.test.ts`, `tests/live-updates.test.tsx` and `tests/orders-live.test.tsx`.

## Instant UI: optimistic updates and instant navigation (rule)

Every screen must feel instant. This builds on `docs/adr/0002-instant-reads-and-writes.md`; where this section is silent, that decision applies.

- **Instant navigation.** A click on a link, tab, tile or period control reacts at once: show the loading skeleton or the cached page immediately, prefetch the likely next page, and never leave a blank or frozen screen while data loads. Keep the page fixed and let inner containers scroll.
- **Optimistic by default.** For a reversible action, update the screen the moment the user confirms and send the change in the background. If the server refuses, roll the screen back and say why in plain words. A Customer Message shows "sending…" until confirmed.
- **Not optimistic:** anything that moves money or has an outside effect, or that a Manager or the CEO decides. That includes approving a refund, write-off, "approve anyway" or a cancellation after dispatch, a Delivery fee quote, a Senior/PWD decision, and placing an Order. These wait for the server and show a spinner within 100 ms.
- **Confirm first still applies.** The confirm dialog on a submit comes first; the optimistic update starts after the user confirms.
- **Targets:** react in under 100 ms, confirm in under 500 ms; a flow that misses gets its own follow-up issue.
- **Tests:** cover the rollback and the refusal message for each optimistic action, and the immediate loading state for each new page.

## Desktop layout everywhere (rule)

On 2026-11-25 the owner decided CREOMS always shows the desktop site, on phones too. The root layout (`app/layout.tsx`) sets a fixed 1280 px viewport, so phones lay the page out at desktop width and zoom out to fit; the body keeps `min-w-[1280px]` for browsers that ignore the viewport tag. Design every screen for desktop width. Never set `width=device-width`, never block pinch-zoom, and never add phone-only layouts. Check: `tests/desktop-viewport.test.ts`.

## Exports (rule)

Every exported or printed document (PDF, image, anything downloaded) starts from the shared template in `lib/export/pdf-template.ts`: the Bren Raphael's Ube Jam & Halaya logo (`public/images/brand/logo-ube-jam-halaya.jpeg`), brand colours, Philippine-time footer and page numbers. Never hand-draw a header or call `window.print()` on page content. Details in `docs/exports.md`.
