# M1 Gaming PCs — Website (Version 1)

Marketing/e-Commerce-licence website for **M One Computer and Accessories
Retail** (trading as **M1 Gaming PCs**), Qatar. Built with Next.js App
Router, TypeScript and Tailwind CSS.

Version 1 has **no database, accounts, admin panel or payments** by design —
the primary action is a WhatsApp-based PC quote request.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in real values
npm run dev
```

Open http://localhost:3000.

## Before deploying

Fill in `.env.local` (or your Vercel project's Environment Variables) with:

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | **Yes** | Full international format, digits only (e.g. `974XXXXXXXX`). Every "quote" and "contact" flow uses this single value. |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Yes | Shown in footer, Contact page and used by the complaint form's `mailto:` link. |
| `NEXT_PUBLIC_CONTACT_PHONE` | Yes | Display-only phone string. |
| `NEXT_PUBLIC_ECOMMERCE_LICENCE_NUMBER` | No | Leave empty until the licence is issued — the site only renders this field when it's set. |
| `NEXT_PUBLIC_SITE_URL` | Yes | Canonical production URL, no trailing slash (used by metadata/sitemap/robots). |

## Deploying to Vercel

This is a zero-config Next.js app (no custom build output, no server
runtime beyond what Next.js provides) — Vercel's Next.js framework preset
handles install, build and serve automatically.

### Option A — GitHub → Vercel (recommended)

1. Push this project to a new GitHub repository (e.g. `m1pcs-website`).
2. In the [Vercel dashboard](https://vercel.com/new), click **Add New → Project**
   and import that repository.
3. Vercel auto-detects **Next.js** as the framework — leave Build Command
   (`next build`), Output Directory, and Install Command on their defaults.
4. Under **Environment Variables**, add the variables listed below, then
   click **Deploy**.
5. Every future push to the connected branch redeploys automatically.

### Option B — Direct upload/import (no GitHub)

1. Install the Vercel CLI once: `npm i -g vercel`.
2. From the project root, run `vercel` (or `vercel --prod` to deploy
   straight to production) and follow the prompts to log in and create the
   project.
3. When asked, either paste the environment variables at the prompts or
   add them afterwards from the project's **Settings → Environment
   Variables** page, then redeploy with `vercel --prod`.

(Vercel also supports dragging a project folder into vercel.com/new — for
a Next.js app with API-less, zero-config output like this one, the CLI path
above is the more reliable equivalent of that flow.)

### Environment variables to enter in Vercel

All four are safe to expose publicly (`NEXT_PUBLIC_*`) — none are secrets:

| Variable | Required before going live | Purpose |
|---|---|---|
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | **Yes** | Digits only, international format (e.g. `974XXXXXXXX`). Drives every WhatsApp CTA and the quote form. |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Yes | Footer, Contact page, complaint form `mailto:`. |
| `NEXT_PUBLIC_CONTACT_PHONE` | Yes | Display-only phone string. |
| `NEXT_PUBLIC_SITE_URL` | Yes | Set to your real domain, e.g. `https://m1pcs.qa` — used for metadata, Open Graph, sitemap.xml, robots.txt. |
| `NEXT_PUBLIC_ECOMMERCE_LICENCE_NUMBER` | No | Leave unset until the licence is issued; the field only renders once it has a real value. |

No other environment variables, secrets, or API keys are required — this
version has no database and no third-party services beyond WhatsApp deep
links and `mailto:` links.

## Project structure

```
src/
  app/                    # Routes (App Router)
    page.tsx              # Home
    build-my-pc/          # Quote request form
    products/             # Category grid
    completed-builds/     # Portfolio
    how-it-works/         # 6-step process
    contact/              # Contact + business info + complaints
    policies/             # Legal pages
    layout.tsx            # Root layout, fonts, global <head>
    globals.css           # Design tokens (CSS variables)
    sitemap.ts / robots.ts
  components/
    layout/               # Header, Footer, WhatsApp floating button
    ui/                   # Button, Container, SectionHeading, Badge
    cards/                # CategoryCard, BuildCard
    forms/                # Form controls + QuoteForm + ComplaintForm
    cta/                  # CTABlock
  lib/
    site-config.ts        # ALL centralized business/contact/legal info
    whatsapp.ts           # WhatsApp link + message builders
    categories.ts         # Product category data
    builds.ts             # Placeholder completed-builds data
  types/index.ts           # Shared TypeScript types
```

Everything editable (contact details, categories, completed builds,
legal text) is centralized in `src/lib/` — no need to hunt through
components to update copy or data.

## Verification status

The environment this project was built in has no npm registry access, so
`npm install`, `next build`, `next lint`/`eslint`, and `next dev` could not
actually be executed here. What *was* verified without those tools:

- Full TypeScript syntax parse of every `.ts`/`.tsx` file (0 errors).
- Every internal `@/...` import cross-checked against the file it points to
  and the symbol it expects to find there (all resolved).
- Manual review of Server/Client Component boundaries, `"use client"`
  placement, and Tailwind config wiring.

What was **not** and **cannot** be verified without a real `npm install`:
full TypeScript type-checking (as opposed to syntax parsing), ESLint rule
violations, and an actual production build. Run `npm install && npm run
build` (or let Vercel do it) as the real proof — the setup above gives
strong confidence but is not a substitute for that.

## Known limitations / what's next (by design, per Version 1 scope)

- No database — the quote form and complaint form hand off to WhatsApp /
  email respectively; nothing is persisted.
- `src/lib/builds.ts` has 4 placeholder completed builds with "Photo coming
  soon" cards — replace with real builds + photos under `public/builds/`.
- `src/app/policies/page.tsx` uses neutral, non-committal legal language
  everywhere an exact figure (return window, warranty period, cancellation
  fee, delivery timeframe) hasn't been provided. Search the file for
  `BUSINESS OWNER REVIEW REQUIRED` (source comments only, not visible on the
  live page) to find every spot that needs a final decision before this
  goes live.
- Arabic/RTL: not implemented, but nothing in the architecture (routing,
  layout, components) blocks adding it later.
