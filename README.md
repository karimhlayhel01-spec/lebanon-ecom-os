# Lebanon Ecom OS

Founder operating system for importing a small product and selling it in Lebanon. Bilingual EN/AR. One founder workspace. Multi-SKU shop hub and per-SKU journey pages.

Guided path: **Discovery → sample-first Supplier → Store (side status) → Marketing → weekly Topic A**, with Shared Business Memory and human approval gates.

**Shopify is never connected.** No OAuth, no Admin write-back. Store drafts are copy/paste into Shopify Admin. `storeReady` is an OS-side checklist only — it never blocks batch or selling.

Product locks: [`docs/WAVE-2.md`](docs/WAVE-2.md) (Discovery), [`docs/WAVE-3.md`](docs/WAVE-3.md) (Supplier), [`docs/WAVE-4.md`](docs/WAVE-4.md) (Marketing / Store packs).

## Status

Built on Wave 1 (multi-SKU hub, Postgres, Shared Margin 70%/35%, approvals, Orchestrator).

| Surface | Shipped | Default |
| --- | --- | --- |
| **Discovery** | Suggested products with Fit / margin / demand / Tier-1 gates. No founder demand paste. Page loads never live-search. Why / Compare on click (Gemini). | 5-card board. Agent UI off. |
| **Supplier** | Sample-first Import + Local shortlist. Optional live leads. Lebanon sourcing-agent as an Import seat (unknown unit until quoted). Gmail compose. | Live leads off → planning estimates. In-app Gmail send parked. |
| **Store** | USD / COD / EN+AR checklist. Per-SKU paste packs (whole-shop when ≥3 live SKUs). Improve + copy into Shopify Admin. | Paste only. Connect/write parked. |
| **Marketing** | Stage-aware kits: intro → pre-launch → launch → weekly refresh. Gemini fill on click (templates if no key). Intro literacy: Nano, Seedance, Xpoz. Nano Generate in-OS (flag). Seedance = Copy prompt + Claude — not Generate in this OS. | Visual Generate off. “This week’s one post” parked. |

Also shipped: auth, onboarding, Topic B SKU card, Topic A / Finance ledger.

## Stack

- **Next.js 16.2** (App Router) + TypeScript + Tailwind CSS
- **next-intl** — English / Arabic (RTL)
- **Drizzle ORM** + **Postgres** via `DATABASE_URL`
- Cookie session auth (bcryptjs)

## Setup

```bash
cp .env.example .env
# Set DATABASE_URL (local Postgres or Neon)

npm install
npm run db:migrate
npm run dev -- -p 3005
```

Open [http://localhost:3005](http://localhost:3005). You are redirected to `/en` or `/ar`.

A clone runs without paid APIs: curated Discovery catalog, Supplier planning estimates, Marketing templates. Optional keys (Gemini, Serper/SerpAPI, Higgsfield) are documented in `.env.example`.

Full flags and jobs: `.env.example` + `docs/WAVE-*.md`.

```bash
npm run test          # unit tests
npm run typecheck
npm run lint
```

Postgres critical-path tests: `npm run test:integration` (skips if `DATABASE_URL` is unset).

Live Discovery search is **CLI jobs only** (`npm run discovery:intake` / `score` / `refresh`) — never on page load. See `docs/WAVE-2.md`.

## Journey (short)

1. Sign up → one workspace. Onboarding (min budget **$2,000**, Lebanon + COD notices).
2. **0** live SKUs → shop hub. **1** → that product page. **2+** → hub.
3. Accept a product → sample-first Supplier. Store setup runs in parallel and never blocks the first batch.
4. Marketing kits unlock by stage. Topic A is weekly shop money; units left = received − sold; unknown received stays unknown.

Margins: **≥ 70%** before ads, **≥ 35%** after. Sample-first. `skuId` writes are ownership-checked.
