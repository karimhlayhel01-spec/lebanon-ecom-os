# Lebanon Ecom OS

Founder operating system for importing a small product and selling it in Lebanon — bilingual EN/AR, one founder workspace, multi-SKU shop hub + per-SKU journey pages. Guided path from Discovery → sample-first Supplier → Store (side status) → Marketing → weekly Topic A, with Shared Business Memory and human approval gates.

**Shopify is never connected.** No OAuth, no Admin write-back. Store drafts are copy/paste into Shopify Admin. `storeReady` is an OS-side checklist only — it never blocks batch or selling.

Canonical locks: [`docs/WAVE-2.md`](docs/WAVE-2.md) (Discovery), [`docs/WAVE-3.md`](docs/WAVE-3.md) (Supplier), [`docs/WAVE-4.md`](docs/WAVE-4.md) (Marketing / Store packs).

## Status

Built on Wave 1 (multi-SKU hub, Postgres, fail-closed `skuId`, Shared Margin 70%/35%, approvals, Orchestrator).

| Surface | What shipped | Default |
| --- | --- | --- |
| **Discovery (Wave 2)** | Approach A: CLI/jobs write the product pool + scores; page loads never live-search. Accept uses system Fit / margin / demand / Tier-1 gates (no founder demand paste). Why / Compare via Gemini on click. | 5-card board. `DISCOVERY_AGENT_UI` **off**. |
| **Supplier (Wave 3)** | Sample-first 3+2 Import/Local. Optional live leads (Serper). Lebanon sourcing-agent as an Import seat (unit 0 = unknown cost). Gmail **compose** (in-app send parked). | Live leads **off** → planning estimates. |
| **Store** | USD / COD / EN+AR checklist. Per-SKU and whole-shop (≥3 live SKUs) paste packs. Improve + Copy-for-Shopify. | Paste only. Connect/write **parked**. |
| **Marketing (Wave 4)** | Stage-aware kits (`intro` → `pre_launch` → `launch` → `weekly_refresh`). Gemini Intro + creatives on click (templates if no key / cap). Intro literacy: Nano, Seedance, Xpoz. Nano **Generate** in-OS (flag). Seedance = Copy prompt + Claude + Higgsfield MCP — not Generate in this OS. | `MARKETING_VISUAL_GEN` **off**. Phase 4 “this week’s one post” **parked**. |

Also shipped: auth + onboarding wizard, Shared Business Memory, Human Approvals, Topic B SKU card, Topic A / Finance ledger.

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

Flags and keys (Gemini, Serper/SerpAPI, Higgsfield) are in `.env.example`. Defaults keep Discovery on the curated catalog, Supplier on planning estimates, and Marketing on templates — a clone runs without paid APIs.

### Demo reset

Temporary control for testing and live demos. Enable with `DEMO_RESET=1` (or `true`) in `.env`. In **production** (`NODE_ENV=production`) you must also set `DEMO_RESET_ALLOW_PRODUCTION=1` (or `true`) — `DEMO_RESET` alone is ignored.

When enabled, ⚙ Settings shows **Demo: restore Discovery**. Confirm by typing `RESTORE` — atomically clears SKUs / supplier / marketing / Topic A, then **seeds invent/catalog Discovery** with **5 cards** visible and **Show more** up to **25**. No Serper/SerpAPI — catalog + scores only; `DISCOVERY_LIVE_SEARCH` can stay off. Login, workspace id, and completed onboarding stay.

In non-production only, the same panel also offers **Wipe to empty** (type `WIPE`) for a blank board without seed. Without the flags the controls are invisible and the server actions are no-ops.

### Auth notes

- Signed-out server actions that call `requireUser` / `requireOnboardedWorkspace` **redirect to login** (same as pages) — they do not throw a raw `UNAUTHORIZED` 500.
- Login is throttled in-memory: **10 failed attempts / 15 minutes** per email and per client IP (`src/lib/auth/login-rate-limit.ts`). Best-effort only (per process; not shared across instances).
- Password change invalidates all other sessions, then mints a fresh session for this browser.

### Postgres integration tests

Critical-path suites live in `src/**/*.integration.test.ts` (IDOR, Topic A week count txn, reorder arrive ledger, demo reset, fail-closed `skuId` / `advanceJourney`). They **skip when `DATABASE_URL` is unset**. Default `npm test` excludes them (keeps unit CI fast). Run with:

```bash
npm run test:integration
```

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev -- -p 3005` | Dev server (port 3005) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest unit tests (excludes `*.integration.test.ts`) |
| `npm run test:integration` | Postgres critical-path tests (skips without `DATABASE_URL`) |
| `npm run db:generate` | Generate SQL migrations from `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations to `DATABASE_URL` |
| `npm run db:push` | Push schema directly (handy early-stage; prefer migrate for shared DBs) |
| `npm run discovery:intake` | Wave 2 Path 1 intake job (CLI only — not page load) |
| `npm run discovery:score` | Wave 2 Approach A score-refresh job (CLI only) |
| `npm run discovery:refresh` | Run intake then score |
| `npm run discovery:metrics` | Wave 2 §7 funnel rates over a window (read-only; `-- --days=N`, `-- --json`) |

## Wave 2 Discovery (Approach A)

Canonical locks: `docs/WAVE-2.md`. Page loads **never** live-search — scheduled/CLI jobs write the pool + score cache; Discovery **reads DB**.

```bash
npm run db:migrate
# In .env (example): DISCOVERY_POOL_V2=1 DISCOVERY_LIVE_SEARCH=1 SERPAPI_API_KEY=…
# Required for card explain: GEMINI_API_KEY=… (or DISCOVERY_EXPLAIN_GEMINI_API_KEY)
npm run discovery:intake    # seed + Path 1 upserts when live search + key
npm run discovery:score     # write discovery_product_scores (optional: -- --limit=25)
npm run discovery:refresh   # intake then score
npm run dev -- -p 3005      # shortlist ranks from score cache; system demand gate + Gemini explain when flagged
```

With a large Path 1 pool, prefer `npm run discovery:score -- --limit=50` (or cron batches) so SerpAPI caps stay manageable. Discovery **GET** still never live-searches.

Each card states how fresh its market read is (`DISCOVERY_SCORE_STALE_AFTER_DAYS`, default 30). A product with no successful read yet says **estimate only**. Freshness is display only — it never changes rank, strength, or an accept gate.

### Measuring the funnel (WAVE-2 §7)

```bash
npm run discovery:metrics              # last 30 days
npm run discovery:metrics -- --days=7  # shorter window; add --json for raw output
```

Reports empty rate, accept rate, and edit-onboarding rate. Counters are **append-only**, deduped so re-renders and retries count once, and are never read back into scoring, rank, or gates — a human tunes thresholds from them.

With flags **off**, Discovery stays on the in-memory catalog (`src/lib/discovery/catalog.ts`); accept uses Fit / margins / Tier-1 / oversized — **no founder demand paste**.

### Session resync (POOL_V2)

**Default board (`DISCOVERY_AGENT_UI` off):** active Discovery sessions freeze a shortlist at start. Path 1 intake / score jobs do **not** rewrite an open session. When `DISCOVERY_POOL_V2=1`, **Refresh suggestions** closes the session, re-ranks from pool + score cache, and opens a new session. Workspace-seen keys stay excluded. Refresh does **not** increment the exhausted-round ladder.

**Agent UI (`DISCOVERY_AGENT_UI=1`, WAVE-2 §14):** **Explore more** pulls **new** products in the **same** session (does not freeze the visible grid; does not clear the basket). **Refresh** is still start-over (new session). **Show more** is hidden. See `docs/WAVE-2.md` §14.1.

## Database

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

Shipped migrations include `drizzle/0000_solid_legion.sql` (base schema) through Wave 2–4 additive tables (discovery pool/scores, supplier live/contacts, store packs, marketing weekly + visual usage). Inventory received for units-left lives on each SKU’s `importBatch` JSON (`totalUnitsReceived`).

Legacy SQLite files under `data/*.sqlite` are unused and can be deleted.

## Onboarding & landing

1. Sign up → creates user + single workspace (1 founder, 1 Shopify **slot** in memory — not a connected store) + journey/side status rows
2. Complete onboarding (min budget **$2,000**, Lebanon sellability + COD notices)
3. After onboarding / login, landing depends on **live** SKUs:
   - **0** → shop hub `/dashboard` (discovery)
   - **1** → that product’s `/sku/[id]`
   - **2+** → shop hub
4. Explicit Shop navigation always opens the hub: `/dashboard?hub=1`

## Product locks (shipped)

- Multi-SKU hub + per-SKU journey pages
- **Hub Next** is display-only; **attention chips** are clickable deep-links
- **Store readiness** never blocks batch order
- Margins **≥ 70%** before ads / **≥ 35%** after; **sample-first**; same-source spares; spare approve ≠ path switch; quotes stale on path switch only
- Topic A is **shop-combined** (Mode C when 2+ live); units left = **received − cumulative sold** (computed ledger, not founder-typed SoT). Unknown received stays unknown (never stored as 0)
- Finance history (older weeks) via settings gear ⚙ → `/finance/history`; recent weeks stay on the Finance / Topic A panel
- `skuId` mutations are ownership-checked / fail-closed (no `activeSkuId` soft fallback when live SKUs exist); `activeSkuId` remains a hub Tools preference pointer only (not flipped on `/sku/[id]` GET)

## Shared Business Memory (M1)

- Repositories in `src/lib/memory/` are the single source of truth per workspace
- Allowed-field policy (`src/lib/memory/allowed-fields.ts`): memory is system-written; founders may only edit an explicit allow-list of fields
- Journey FSM in `src/lib/journey/fsm.ts`: `discovery → supplier_sample → sample_approved → store_setup → batch_ordered → batch_arrived_ready → selling`, plus `paused` / `blocked` overlays (per SKU in Wave 1)

## Human Approvals (M2)

- Approval engine in `src/lib/approvals/` — first-class `ApprovalRequest` records with acknowledgement enforcement
- Server transition guards: reaching a gated state requires an approved gate. `store_setup` needs no approval; `store_ready` is a side status, never a batch/selling prerequisite
- Gate → transition map: `accept_product → supplier_sample`, `sample_decision → sample_approved`, `batch_ordered → batch_ordered`, `batch_arrived_ready → batch_arrived_ready`, `mark_selling → selling`

## Shared Margin skill (M3)

- One deterministic module in `src/lib/skills/margin.ts`, shared by Discovery and Finance
- `landed_cost = product + intl_ship + clearance_taxes + local_courier`; margin before/after ads with `est_mkt/order = min(20% × price, monthly_follow_on_budget / 30)`
- Gates: margin before ads **≥ 70%**, after ads **≥ 35%**; failures return a human-readable block reason (never an all-blocked dead end)

## Discovery (`src/lib/discovery/`)

- Default board: curated catalog in `src/lib/discovery/catalog.ts`. Deterministic **Fit skill** (`src/lib/skills/fit.ts`): order **budget → experience → risk → time → storage → workload**, likes soft; yields **Strong / Okay** (Okay requires a risk-read acknowledgement)
- Uses the **Shared Margin skill** (70% / 35%); blocked products show an explanation and the shortlist is never an all-blocked dead end
- Session reveal: **5** ability-matched products, **show more** up to 4× → **max 25 per session**
- **No founder demand paste.** Accept uses system skill gates (Fit / hard margin / demand-competition when pool+scores / Tier-1 / oversized)
- **Tier-1** conflict (Ishtari / EGLOW / Platza) → customize with supplier or drop
- **Accept** routes through Human Approvals (`accept_product`), advances `discovery → supplier_sample`, and writes Topic B basics
- With `DISCOVERY_POOL_V2=1`, retrieve reads the Postgres pool + score cache. Jobs (`npm run discovery:*`) own live search. **View listing** when a stored URL exists. Agent UI (`DISCOVERY_AGENT_UI=1`) **replaces** the 5-card board — default **off**

## Guided path after accept

After accept, work happens on the **shop hub** and **per-SKU pages** (`/sku/[id]`). Every panel is bilingual (EN/AR), edits stay inside the allowed-field policy.

### Topic B — SKU card (`src/lib/sku/`)

- Built from the accepted product; sections: **basics, ship fitness, storage, handling, import/batch, money snapshot, marketing hooks**
- Founder **notes are editable** (`saveSkuNotesAction`); everything else is system-written
- Translatable note keys use an `@` sentinel prefix so raw data (with periods) never collides with i18n keys

### Supplier / Import (`src/lib/supplier/`)

- **3 primaries + 2 backups each = 9 options** per source (Import + Local), with years/rating/red-flag signals
- **Live off:** invent planning estimates. **Live on** (`SUPPLIER_LIVE_LEADS=1` + `SERPER_API_KEY`): Approach A one-shot / Refresh. Import = real seats or honest empty (AliExpress-first, max-landed + USD unit gate) — no invent pad. Local = live only, never invent Lebanese names (empty or partial). See `docs/WAVE-3.md`
- **Lebanon sourcing agent:** allow-listed directory seat on Import (`platform` `lebanon_agent`). Unit/MOQ 0 = unknown cost (quotes + first-batch estimate). Hide Assess on that seat
- **Email:** negotiation draft + **Copy** / **Open in Gmail** (compose URL). Confirmed in-app Gmail send (Phase 3b) is parked
- **Sample-first** flow: request → received → decide (`sample_decision` approval)
- Parallel **same-source spare** samples; spare approve does not switch the working path; **can’t-fulfill** prefers warm spares; cost quotes go stale on **path switch** only
- Per-option **payment map**, quality checklist, and a **clearance-partner TBD** placeholder
- **>$10k MOQ** shows a soft warning and a stuck ladder; high-MOQ alternatives surfaced where possible
- Approvals: `sample_decision`, `batch_ordered`, `batch_arrived_ready` — **`batch_ordered` never requires `store_ready`**

### Store setup — side status (`src/lib/store/`)

- Checklist: **USD**, EN/AR drafts, **COD primary**, optional local payment, **5 courier placeholders**, policies, WhatsApp
- **Make the page stronger:** Gemini improve + paste-ready attractiveness / discoverability pack (per-SKU; whole-shop when ≥3 live SKUs). Copy into Shopify Admin — no ranking / Merchant / connect promises
- `store_ready` is a **side status only** — it never blocks batch or selling

### Marketing — stage-aware (`src/lib/marketing/`)

- Stages: sample approved → **intro**, batch ordered → **pre-launch** (organic + max $5/day paid), batch arrived → **launch**, plus **weekly refresh** (stage id `weekly_refresh`)
- Editable **creatives + shot lists**, EN/AR, scaled **6 / 10 / 14 by capacity**, WhatsApp required
- Gemini fill is Approach A (click). Monthly cap `MARKETING_GEMINI_MONTHLY_CAP` (default 40). At/over cap or no key → deterministic templates
- Intro literacy (template SoT on assemble and load): **Nano** stills (Generate in this OS), **Seedance** clips (Copy prompt + Claude Higgsfield `https://mcp.higgsfield.ai` — not in this OS), **Xpoz** competitor study (Claude connector `https://mcp.xpoz.ai/mcp`). Pack picker is **Nano-only**
- Marketing kits are separate from Topic A money advice; `start_launch_marketing` gates launch/refresh
- Phase 4 “this week’s one post” remains parked. See `docs/WAVE-4.md`

### Topic A + Finance panel (`src/lib/finance/`)

- **Shop-combined** weekly Topic A: sales/orders, Meta/TikTok spend, COD collected/outstanding, courier fees; with **2+ live SKUs** (Mode C) also per-SKU sales + units sold
- **Units left** = `totalUnitsReceived − cumulative sold` (inventory ledger). Founder does not type left as source of truth; unknown received stays unknown (never invents 0)
- **Preview advice before selling**; real advice only after the founder marks **selling** (`mark_selling`)
- Uses the **Shared Margin skill**; **invest-next** recommendation appears after **4 weeks** of Topic A entries
- Recent weeks on the Finance panel; older weeks under settings gear → `/finance/history`

### Orchestrator (`src/lib/orchestrator/`)

- Computes the **next CTA(s)** and **coaching cards** from journey + side statuses (hub + per-SKU)
- **Parallel CTAs after `sample_approved`** (store setup vs. batch order)
- Coaching respects priority: **safety → margins → budget/experience → risk → likes**
