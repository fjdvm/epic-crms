# Module switcher shows only granted Systems — design

Small change. Repos: CREOMS, HRMS, IMS (`brenraphaels-smart-inventory-system`), POS (`web-pos`).

## Intent

The "Select Enterprise Module" switcher in each System must list exactly what the signed-in person can open:
the Enterprise Portal, plus every System an Admin granted them on the Portal. Examples from the owner:

- Fitz Martin (CREOMS + IMS) sees: Enterprise Portal, CREOMS, IMS.
- Someone with POS only sees: Enterprise Portal, POS.

Why: offering a System that will refuse the person is confusing, and the Portal home already shows the true list.

## Goals / non-goals

- Goal: same rule and same result in all four Systems.
- Non-goal: changing who has access (that stays with Admins on the Portal).
- Anti-goal: offering a System the person lacks, even briefly, or polling the Portal.

## Approaches

1. **Ask the Portal once per page load (picked).** Each System's server asks the Portal's
   `/api/integrations/systems` (merged, auth #314) for the person's granted Systems; the switcher filters to those.
   Already live in CREOMS (#763).
2. Read the grant list from the sign-in session. Rejected: a grant changed by an Admin would not show until the
   next sign-in, and every System's session format would need changing.
3. Hard-code the list per Role. Rejected: access is granted per person, not per Role.

## Design

- **Portal fix first (root cause in production).** The Portal's sign-in guard (`proxy.ts` matcher) lets
  `/api/integrations/validate` through but not the new `/api/integrations/systems`, so every System's server call
  is redirected to `/login` (verified: `POST https://portal.buildwrite.me/api/integrations/systems` → `307 /login`,
  while `/validate` → `401`). Every System therefore falls back to "Portal + open System". Add
  `api/integrations/systems$` to the matcher's exclusions, with a case in `proxy.test.ts`.
- Rule: show the Enterprise Portal, and each System whose Portal name (CRMS, HRMS, POS, IMS) is in the person's
  granted list. The open System is always granted (you could not be in it otherwise).
- If the Portal cannot answer, show only the Enterprise Portal and the open System.
- IMS: remove "E-Commerce Storefront" from the switcher. It is not a Portal System, so nobody can be granted it,
  and today it shows for everyone.
- HRMS, IMS, POS: finish and commit the uncommitted switcher work already on their branches.
- Label CREOMS as "CREOMS" in every switcher, matching the Portal home. Drop "& marketing" from its description
  (that Module is retired).
- Tests in each repo: Fitz's case (CREOMS + IMS → Portal, CREOMS, IMS), the POS-only case (→ Portal, POS),
  and the Portal-unreachable fallback. IMS also asserts there is no storefront entry.
- Per repo: run that repo's checks, then open one PR.

## Left to the builder

The wording of each description line, and whether each repo's switcher shares a helper file or keeps its own copy.
