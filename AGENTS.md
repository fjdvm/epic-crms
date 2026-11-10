<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Checks and PR completion

1. Before every push, run `npx next typegen`, `npx tsc --noEmit`, and `npm test`. Push only after all pass.
2. Open or update the ticket's PR. Until the owner enables auto-merge and the `main` ruleset requiring a PR and `ci-gate`, leave it for owner merge and stop. After both settings are verified, enable squash auto-merge with `gh pr merge <PR> --auto --squash` and stop when GitHub accepts it.
3. If waiting for PR checks is unavoidable, use one blocking `gh pr checks <PR> --watch --fail-fast` command. Never loop on status commands.
4. Never wait for production deployment. GitHub's failed-workflow notification emails the owner; Azure retains the previous revision if deployment fails.
5. Track required live-production checks in a separate verification ticket.

## No polling

No app polls (ADR-0005 in the Portal repo, `docs/adr/0005-no-polling-anywhere.md`). Never repeat a data request on a timer, window focus or tab visibility; use the WebSocket, refetch on (re)connect, or refetch on a user action. A 30–60 second in-memory heartbeat is a keepalive, not polling, and timers that never touch the network (clocks, countdowns) are fine. Idle-tab check: `tests/no-polling.test.ts`, `tests/live-updates.test.tsx` and `tests/orders-live.test.tsx`.
