# Lebanon Ecom OS

Founder operating system for importing and selling **one SKU** in Lebanon — bilingual EN/AR, guided journey, Shared Memory (coming next).

## Stack (M0)

- **Next.js 16** (App Router) + TypeScript + Tailwind CSS
- **next-intl** — English / Arabic (RTL)
- **Drizzle ORM** + **better-sqlite3** for local zero-config DB
- Cookie **session auth** (bcryptjs) — no Clerk
- Production DB target remains **Postgres**; local M0 uses a SQLite file under `data/`

## Setup

```bash
npm install
npm run db:push   # optional; app also auto-creates tables on first use
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you will be redirected to `/en` or `/ar`.

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest smoke tests |
| `npm run db:push` | Push Drizzle schema to SQLite |

## Local database

- File: `data/lebanon-ecom.sqlite` (gitignored `*.db` / `*.sqlite`)
- Schema in `src/db/schema.ts` is SQLite today but modeled for a later Postgres move
- Couriers ×5 and clearance partner are TBD placeholders in `src/lib/constants.ts`

## M0 flow

1. Sign up → creates user + single workspace (1 founder, 1 Shopify store slot) + journey/side status rows  
2. Complete onboarding (min budget **$2,000**, Lebanon sellability + COD notices)  
3. Land on dashboard in **discovery** with empty shortlist slot (no agents yet)

## Not in M0

Product Discovery agent, full Shared Memory repos, approvals engine, margin skill, supplier/marketing/finance path — later milestones.
