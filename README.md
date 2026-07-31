# Lebanon Ecom OS

Founder operating system for importing and selling **one SKU** in Lebanon — bilingual EN/AR, guided journey backed by a Shared Business Memory with human approval gates.

## Status

- **Done — M0:** App shell + UI polish (auth, onboarding wizard, dashboard, EN/AR RTL)
- **Done — M1:** Shared Business Memory (repositories, allowed-field edits) + journey FSM
- **Done — M2:** Human Approvals engine + server transition guards
- **Done — M3:** Shared Margin skill (70% / 35%) with unit tests
- **Done — M4:** Product Discovery (fit, show-more, demand confirm, Tier-1, accept flow)
- **Done — M5:** Full guided path — Topic B SKU card → Supplier/Import (sample-first + batch) → Store side-status → stage-aware Marketing → Topic A/Finance panel → Orchestrator (CTAs + coaching)

## Stack

- **Next.js 16.2** (App Router) + TypeScript + Tailwind CSS
- **next-intl** — English / Arabic (RTL)
- **Drizzle ORM** + **Postgres** (`postgres.js` driver) via `DATABASE_URL`
- Cookie **session auth** (bcryptjs) — no Clerk
- Production and local/dev both target **Postgres** (Neon-compatible connection strings work)

## Setup

```bash
cp .env.example .env
# Edit DATABASE_URL (local Postgres or Neon — see Database below)

npm install
npm run db:migrate       # apply Drizzle migrations (or db:push while iterating on schema)
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
| `npm run db:generate` | Generate SQL migrations from `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations to `DATABASE_URL` |
| `npm run db:push` | Push schema directly (handy early-stage; prefer migrate for shared DBs) |

## Database (Postgres)

The app requires **`DATABASE_URL`** — a standard Postgres connection string (Neon, local Docker, RDS, etc.).

```bash
# .env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require
```

### Local Postgres (Docker example)

```bash
docker run --name lebanon-ecom-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=lebanon_ecom -p 5432:5432 -d postgres:16

# .env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/lebanon_ecom
```

### Neon (free tier)

1. Create a project at [neon.tech](https://neon.tech)
2. Copy the connection string into `DATABASE_URL` (pooled URL is fine; the app uses `prepare: false`)
3. `npm run db:migrate`

### Schema changes

1. Edit `src/db/schema.ts`
2. `npm run db:generate` → SQL under `drizzle/`
3. `npm run db:migrate` (or rely on first-request `ensureMigrated()` in the app process)

Legacy SQLite files under `data/*.sqlite` are unused and can be deleted.
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
- Session reveal: **5** ability-matched products, **show more** up to 4× → **max 25 per session**
- **Demand confirm** before accept: founder signal (URL / note / screenshot) + AI structured summary; differentiation shown per product
- **Tier-1** conflict (Ishtari / EGLOW / Platza) → customize with supplier or drop
- **Accept** routes through Human Approvals (`accept_product`), advances `discovery → supplier_sample`, and writes Topic B basics + active SKU

## Guided path after accept (M5)

Once a product is accepted the dashboard composes the full operator journey. Every panel is bilingual (EN/AR), edits stay inside the allowed-field policy, and generated data (suppliers, creatives) is deterministic per SKU.

### Topic B — SKU card (`src/lib/sku/`)

- Built from the accepted product; sections: **basics, ship fitness, storage, handling, import/batch, money snapshot, marketing hooks**
- Founder **notes are editable** (`saveSkuNotesAction`); everything else is system-written
- Translatable note keys use an `@` sentinel prefix so raw data (with periods) never collides with i18n keys

### Supplier / Import (`src/lib/supplier/`)

- **3 primaries + 2 backups each = 9 options**, with years/rating/red-flag signals
- **Sample-first** flow: request → received → decide (`sample_decision` approval)
- Per-option **email draft**, **payment map**, quality checklist, and a **clearance-partner TBD** placeholder
- **>$10k MOQ** shows a soft warning and a stuck ladder; high-MOQ alternatives surfaced where possible
- Approvals: `sample_decision`, `batch_ordered`, `batch_arrived_ready` — **`batch_ordered` never requires `store_ready`**

### Store setup — side status (`src/lib/store/`)

- Shopify checklist: **USD**, EN/AR drafts, **COD primary**, optional local payment, **5 courier placeholders**, policies, WhatsApp
- `store_ready` is a **side status only** — it never blocks batch or selling

### Marketing — stage-aware (`src/lib/marketing/`)

- Stages: sample approved → **intro**, batch ordered → **pre-launch** (organic + max $5/day paid), batch arrived → **launch**, plus **weekly refresh** (stage id `monthly_refresh`)
- Editable **creatives + shot lists**, EN/AR, scaled **6 / 10 / 14 by capacity**, WhatsApp required
- Marketing kits are separate from Topic A money advice; `start_launch_marketing` gates launch/refresh

### Topic A + Finance panel (`src/lib/finance/`)

- Weekly inputs: sales, orders, Meta/TikTok spend, COD collected/outstanding, courier fees, per-SKU sold/left
- **Preview advice before selling**; real advice only after the founder marks **selling** (`mark_selling`)
- Uses the **Shared Margin skill**; **invest-next** recommendation appears after **4 weeks** of Topic A entries

### Orchestrator (`src/lib/orchestrator/`)

- Computes the **next CTA(s)** and **coaching cards** from journey + side statuses
- **Parallel CTAs after `sample_approved`** (store setup vs. batch order)
- Coaching respects priority: **safety → margins → budget/experience → risk → likes**
