# Lebanon Ecom OS

Founder operating system for importing and selling **one SKU** in Lebanon — bilingual EN/AR, guided journey backed by a Shared Business Memory with human approval gates.

## Status

- **Done — M0:** App shell + UI polish (auth, onboarding wizard, dashboard, EN/AR RTL)
- **Done — M1:** Shared Business Memory (repositories, allowed-field edits) + journey FSM
- **Done — M2:** Human Approvals engine + server transition guards
- **Done — M3:** Shared Margin skill (70% / 35%) with unit tests
- **Done — M4:** Product Discovery (fit, show-more, demand confirm, Tier-1, accept flow)

## Stack

- **Next.js 16.2** (App Router) + TypeScript + Tailwind CSS
- **next-intl** — English / Arabic (RTL)
- **Drizzle ORM** + **better-sqlite3** for local zero-config DB
- Cookie **session auth** (bcryptjs) — no Clerk
- Production DB target remains **Postgres**; local dev uses a SQLite file under `data/`

## Setup

```bash
npm install
npm run db:push          # optional; app also auto-creates tables on first use
npm run dev -- -p 3005   # dev server on port 3005
```

Open [http://localhost:3005](http://localhost:3005) — you will be redirected to `/en` or `/ar`.

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev -- -p 3005` | Dev server (port 3005) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest tests |
| `npm run db:push` | Push Drizzle schema to SQLite |

## Local database

- File: `data/lebanon-ecom.sqlite` (gitignored `*.db` / `*.sqlite`)
- Schema in `src/db/schema.ts` is SQLite today but modeled for a later Postgres move
- Couriers ×5 and clearance partner are TBD placeholders in `src/lib/constants.ts`

## Onboarding flow

1. Sign up → creates user + single workspace (1 founder, 1 Shopify store slot) + journey/side status rows  
2. Complete onboarding (min budget **$2,000**, Lebanon sellability + COD notices)  
3. Land on dashboard in **discovery** and start a Product Discovery session

## Shared Business Memory (M1)

- Repositories in `src/lib/memory/` are the single source of truth per workspace
- Allowed-field policy (`src/lib/memory/allowed-fields.ts`): memory is system-written; founders may only edit an explicit allow-list of fields
- Journey FSM in `src/lib/journey/fsm.ts`: `discovery → supplier_sample → sample_approved → store_setup → batch_ordered → batch_arrived_ready → selling`, plus `paused` / `blocked` overlays

## Human Approvals (M2)

- Approval engine in `src/lib/approvals/` — first-class `ApprovalRequest` records with acknowledgement enforcement
- Server transition guards: reaching a gated state requires an approved gate. `store_setup` needs no approval; `store_ready` is a side status, never a batch/selling prerequisite
- Gate → transition map: `accept_product → supplier_sample`, `sample_decision → sample_approved`, `batch_ordered → batch_ordered`, `batch_arrived_ready → batch_arrived_ready`, `mark_selling → selling`

## Shared Margin skill (M3)

- One deterministic module in `src/lib/skills/margin.ts`, shared by Discovery and Finance
- `landed_cost = product + intl_ship + clearance_taxes + local_courier`; margin before/after ads with `est_mkt/order = min(20% × price, monthly_follow_on_budget / 30)`
- Gates: margin before ads **≥ 70%**, after ads **≥ 35%**; failures return a human-readable block reason (never an all-blocked dead end)

## Product Discovery (M4)

- Curated catalog **v1** in `src/lib/discovery/catalog.ts` with an injectable `DemandProvider` seam (MCP swaps in later, no rewrite)
- Deterministic **Fit skill** (`src/lib/skills/fit.ts`): order **budget → experience → risk → time → storage → workload**, likes soft; yields **Strong / Okay** (Okay requires a risk-read acknowledgement)
- Uses the **Shared Margin skill** (70% / 35%); blocked products show an explanation and the shortlist is never an all-blocked dead end
- Session reveal: **5** ability-matched products, **show more** up to 5× → **max 25 per session**
- **Demand confirm** before accept: founder signal (URL / note / screenshot) + AI structured summary; differentiation shown per product
- **Tier-1** conflict (Ishtari / EGLOW / Platza) → customize with supplier or drop
- **Accept** routes through Human Approvals (`accept_product`), advances `discovery → supplier_sample`, and writes Topic B basics + active SKU

## Not built yet

The supplier / marketing / finance path — later milestones.
