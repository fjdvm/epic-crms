# Ticket summaries (#473)

Part of #471. Apply `docs/db/crms-ticket-summaries.sql` as `creoms_writer` before deployment.
The migration is additive and safe to repeat. No storefront table or grant changes.

Apply with the available environment files (task migrations are pre-approved in AGENTS.md):

```sh
node --env-file=.env --env-file=.env.local scripts/deploy/migrate-ticket-summaries.mjs
```

The Ticket's mounted Summary card calls an authenticated Tickets Module POST route once per open, outside the manual Server Action queue.
Prefetches, live Message updates, focus and visibility do not generate summaries. The page and manual
work remain available while the card shows its loading skeleton.

Staff and Managers make a summary on first open. Later opens reuse it until a public Message has a
newer ID. Internal notes do not invalidate it. Admin read the stored result and never configure
or call a model. A transaction-scoped advisory lock prevents concurrent calls for the same Ticket
across app replicas; another opener sees unavailable and can continue working.

The shared `lib/ai/structured.ts` uses the AI SDK's `generateText` and `Output.object` with a Zod schema,
through the direct Groq and Google providers. It preserves `GROQ_API_KEY` / `GROQ_MODEL`, then
`GOOGLE_GENERATIVE_AI_API_KEY` / `GEMINI_MODEL`. Each gets one attempt, a 20-second timeout and no retries.
Missing keys, invalid output and provider/database failures leave the Ticket usable with an unavailable
message. If a refresh fails, the previous summary is retained and labelled as earlier.

Only the subject and public Message text are sent, using the Category/Priority suggestion's shared
4,000-character masking helper, keeping the newest text. Names from the Customer, Claimer and public Message
authors, and any pasted Linked order delivery address values, are redacted locally. These record values
are never added to the prompt. No attachment, Internal note or Order record is sent. Both the masked
text and system instructions are stored and shown under “What the AI saw”. AI-written output stays
inside CREOMS; it is never sent, accepted as a decision or applied to the Ticket, so no acceptance Audit
Event is created. Existing Category/Priority, Sentiment and Top product calls remain on their existing
completer seam; their SDK migration belongs to a later ticket.

Read the installed SDK docs before changing calls:
`node_modules/ai/docs/03-ai-sdk-core/10-generating-structured-data.mdx`,
`node_modules/ai/docs/03-ai-sdk-core/55-testing.mdx`, and the direct-provider sections of
`node_modules/@ai-sdk/{groq,google}/docs/`.

Tests exercise the server function with in-memory Postgres and SDK fake models, provider fallback and
schema validation, Role restrictions, stale summaries, harmless failures, and the card's immediate
loading and input disclosure. Production verification is tracked separately, per AGENTS.md.
