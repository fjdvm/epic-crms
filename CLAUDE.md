@AGENTS.md

Follow the Checks and PR completion rules in AGENTS.md for every implementation ticket.

Production is Azure, not Vercel: follow "Hosting: Azure, not Vercel" in AGENTS.md, and never use Vercel tools or the Vercel CLI here.

## UI foundation and CREOMS reference

Always use [this Figma node](https://www.figma.com/design/76nS6Pw2TXA6fWfUvTmzJ1/Bren-Raphael-s-CRM---Orders-Prototype?node-id=836-11278&p=f&t=BDZjt3iVMQxKa5U7-0) as the UI foundation, and [this one](https://www.figma.com/design/76nS6Pw2TXA6fWfUvTmzJ1/Bren-Raphael-s-CRM---Orders-Prototype?node-id=0-1&p=f&t=BDZjt3iVMQxKa5U7-0) as the CREOMS reference. Details in AGENTS.md, including the two extra Figma references (alternate CRM prototype link, and the UI/UX Redesign file nodes 4:2 and 4:5) to consult for every issue.

## Roles and permissions (rule)

Roles: Staff / Employee, CREOMS Manager (General Manager, CEO and VP have the same access and permissions), Admin. The full rule is in AGENTS.md under "Roles and permissions"; follow it for every feature and ticket. In short:
- **Staff** do daily work that is easy to undo; anything needing a Manager shows "Request approval" instead of the button. No Reports or Portal.
- **Manager** (also General Manager, CEO and VP) = Staff plus approvals (money, removing stock, overriding an AI warning, moving someone else's work), reports and Management (Commerce Settings). One Manager-level approval is final at any amount; there is no separate CEO step. CEO and VP are never assigned Tickets.
- **Admin** runs the system (Portal: users, logs, health, full control). In CREOMS views everything, approves no business decision.
- **Read the Figma notes.** Every CRM prototype screen has a dark note card with who can open it and what each role may do, and the "Roles & access" section (node `577:10412`) has the full guide. Read the notes on a screen before building or changing it. Details in AGENTS.md.
- **AI never acts on its own.** Anything sent to a customer, or that changes an order, ticket or payment, needs a person; accepted AI suggestions are logged with that person's name.

## Instant UI (rule)

Every UI must be optimistic and navigate instantly: show the skeleton or cached page at once, prefetch, and update reversible actions as soon as the user confirms, rolling back with a clear reason if the server refuses. Money, outside effects and Manager or CEO decisions are never optimistic (spinner within 100 ms). Full rule in AGENTS.md ("Instant UI"), building on `docs/adr/0002-instant-reads-and-writes.md`.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`fjdvm/epic-crms`) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the repo root. Do not add ADRs. See `docs/agents/domain.md`.
