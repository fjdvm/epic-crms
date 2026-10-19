This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Signing in through the Portal

CREOMS has no login of its own. A request without a session is sent to the Portal and returns to the page asked for. Copy `.env.example` to `.env.local` and set:

- `PORTAL_URL`: base address of the Portal.
- `PORTAL_SYSTEM_NAME` / `PORTAL_SYSTEM_SECRET`: the System credential the Portal registered for CREOMS (its `SYSTEM_SECRET_CRMS`). Never commit a real value.
- `CREOMS_APP_URL`: this app's public origin. `<origin>/api/portal/callback` must be a callback registered at the Portal.

Route tests run against a shared fake Portal (`tests/fake-portal.ts`) that follows the Portal's handoff contract (`docs/integrations/system-handoff.md` in the Portal repo). The Portal's positive validate response is extended with a `staff` profile (`name`, `username`, `email`, `role`); that addition is proposed to the Portal.

Sign out posts to `/api/portal/logout`, which forgets the session cookie and sends the browser to `<PORTAL_URL>/logout`. That address is proposed, not yet part of the Portal's handoff contract: it must end the one central session (so every System's handle is denied on its next validation) and land on the Portal login.

## Running locally

Two ways, both on `http://localhost:3000`:

1. **Real Portal (default).** Set the variables above and run `npm run dev`. Sign-in goes through the deployed Portal via the registered `localhost` callback.
2. **Dev bypass (offline work and automated tests).** Set `CREOMS_DEV_BYPASS=true` in `.env.local`. Every page opens as a fully-permitted Staff member ("Dev Staff"); no Portal, session or `PORTAL_*` variables are needed, and sign out just returns to `/`.

The bypass is for development and tests only. CREOMS refuses to start (`instrumentation.ts`) if `CREOMS_DEV_BYPASS=true` is set when `NODE_ENV=production` on Vercel, or when `CREOMS_APP_URL` is not a `localhost` address, so it cannot open a deployed CREOMS to the public. Never set it in a deployment's environment.
