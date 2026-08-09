# Lebanon Ecom OS — Wave 3 (Supplier agent)

Product and engineering locks for **Wave 3**.  
**Wave 1** (multi-SKU hub, sample-first Supplier 3+2, Postgres, fail-closed `skuId`) remains the live baseline.  
**Wave 2** (Discovery Approach A) remains locked — see `docs/WAVE-2.md`. Do not reopen Discovery locks here.

**Status:** Wave 3 **Supplier live leads + outbound email** — **LOCKED in intent** (founder discussion 2026-08-09). Implementation is **additive** on the existing Supplier panel / FSM.

**Canonical doc:** this file. Do not reopen locks unless the founder explicitly changes one.

---

## 1) Wave 3 intent

**Founder pain (after Accept):** the shortlist is useful coaching, but options are **invented** (deterministic PRNG). Founders need **reachable, real-world supplier leads** (Alibaba / AliExpress–class marketplaces and similar easy public surfaces) and a path to **email a supplier from the OS** without leaving the draft behind as “copy yourself forever.”

**UX target:**
- Keep **sample-first**, **Import | Local** tabs, **3 primaries + 2 backups** per source, batch/store locks from Wave 1.
- Prefer **live leads** when enabled; **heuristic invent remains the safe fallback** (never empty the panel because search failed).
- Email: keep the negotiation draft; add **Gmail compose / send** when connected — never silent auto-send.

**Out of scope for Wave 3 (parked):**
- Discovery photo gallery / per-card images (Wave 2 direction parked — see WAVE-2 §12)
- Founder Consultant chat
- Official Alibaba Open Platform / Accio as a **required** dependency (same founder-stage constraint as Wave 2)
- Inventing or attaching suppliers on Discovery cards (still **post-accept only**)
- Rewriting sample / batch / reorder FSM

---

## 2) Additive rule (**LOCKED**)

| Rule | Detail |
| --- | --- |
| **No rewrite** | Extend `ensureSuppliers` / `generateSuppliers*` / panel email UI. Do not replace the Supplier FSM. |
| **Post-accept only** | Live leads bind when the Supplier panel (or an explicit refresh action) runs for an owned SKU — never on Discovery accept, never on Discovery card render. |
| **Approach A for search** | Page loads must **not** re-query marketplaces every time. Persist leads on first successful fill (or explicit “Refresh supplier leads”). Failed live gather → keep / fall back to heuristic; never wipe a good shortlist. |
| **Idempotent fill** | Same Wave 2 `supplierGenerationPlan`: generate only missing sources; do not duplicate rows on every visit. |
| **Truthful provenance** | Each option records whether it came from `heuristic` or `live_search` (and platform / source URL when live). UI may show a calm “live lead” vs “planning estimate” hint — never fake “verified Alibaba Gold” without evidence. |

---

## 3) Live supplier leads (**LOCKED**)

### 3.1 Sources (easy-to-reach platforms)

| Source | Role |
| --- | --- |
| **Alibaba.com / AliExpress** (public web/shopping search) | Primary **Import** lead surface via search SaaS (`site:alibaba.com`, `site:aliexpress.com`, or shopping results) — **not** official Alibaba partner API unless later locked |
| **Other public B2B / marketplace SERP** | Allowed behind the same provider seam if they return title/url/(optional price) |
| **Local (Lebanon)** | May stay heuristic longer; live local directories are optional later (directories / SERP `gl=lb`) — do not block Import live on Local |

### 3.2 Provider seam

- Introduce `SupplierLeadProvider` (name flexible) with a single bind point (mirror Discovery’s `getDiscoverySearchProvider` idea).
- Env flag default **off**: `SUPPLIER_LIVE_LEADS=0`. When off, behavior = today’s invent shortlist.
- When on + key present: gather bounded leads → map into 3+2 shape → pad with heuristic if fewer than 9 per source → persist.
- Reuse Serper / SerpAPI keys already in `.env` when possible; **count spend** (prefer shared monthly search ledger or a supplier bucket — do not unbounded-burn Serper trial).
- Timeouts + bounded retries (same spirit as Discovery resilience).

### 3.3 Schema (additive columns)

Nullable / default-safe fields on `supplier_options` (names may vary in migration):

| Field | Purpose |
| --- | --- |
| `leadSource` | `heuristic` \| `live_search` |
| `platform` | e.g. `alibaba`, `aliexpress`, `other`, null for heuristic |
| `sourceUrl` | Public listing / company URL when known |
| `externalTitle` | Raw title from search (optional) |

Ownership: always `workspaceId` + `skuId` fail-closed.

---

## 4) Outbound email — Gmail (**LOCKED**)

### 4.1 Phases

| Phase | What ships |
| --- | --- |
| **3a (now)** | Keep draft textarea. Add **Open in Gmail** (compose URL with subject/body) + **Copy draft**. Still no silent send. Update hint copy so founders know Gmail compose is available. |
| **3b (when Zapier/Gmail MCP connected)** | Optional **Send via Gmail** server action: requires explicit founder confirm; shows to/subject/body; uses Zapier Gmail (or native Gmail MCP if preferred). Fail closed if not connected. |

### 4.2 Safety

- **Reads free / writes confirm** — never send email without an explicit click after showing the payload.
- Do not email Discovery or unowned SKUs.
- Prefer **native Gmail MCP** if both Zapier Gmail and a dedicated Gmail server exist; otherwise Zapier Gmail is fine once authenticated at mcp.zapier.com.
- Cursor/Zapier MCP is a **builder + optional runtime bridge**, not a substitute for durable drafts in Postgres.

### 4.3 What stays

- Per-option `negotiationDraft` remains SoT for the text.
- Sample-first and “OS marks steps; founder still owns the commercial relationship” stay true even when Gmail send works.

---

## 5) Flags / env (names only)

```text
SUPPLIER_LIVE_LEADS=0          # default off — invent shortlist
SUPPLIER_LIVE_LEADS=1          # allow one-shot live fill on ensure / refresh
# Reuse SERPER_API_KEY and/or SERPAPI_API_KEY when live is on
# Optional later: SUPPLIER_GMAIL_SEND=1 when Zapier/Gmail send is wired
```

Never commit secrets.

---

## 6) Non-goals

- Official Alibaba Open Platform / Accio required
- Live search on every Supplier page load
- Auto-emailing suppliers without confirm
- Moving Supplier onto Discovery cards
- Clearing heuristic shortlists when live returns empty
- Discovery photo gallery in this wave

---

## 7) Lock changelog

| Date | Change |
| --- | --- |
| 2026-08-09 | Wave 3 **Supplier live leads + Gmail outbound** **LOCKED in intent** — additive on Wave 1 Supplier; Approach A persist; Alibaba/AliExpress via public search SaaS (not official partner API); heuristic fallback; Gmail compose (3a) then confirmed Zapier/Gmail send (3b); Discovery photos parked |
| 2026-08-09 | Provider seam + schema columns + Gmail compose URL shipped as **foundation** (live fill behind `SUPPLIER_LIVE_LEADS`, default off) |
| 2026-08-09 | **Refresh Import leads** **LOCKED** — explicit founder/action (or scoped script) may replace invent Import for an **owned** SKU with Serper Alibaba/AliExpress leads; page load still does **not** re-query (Approach A). Local stays heuristic. Chosen/sample progress requires confirm. Zero live → honest heuristic refill. Shared monthly search ledger bounds spend (2 queries). |
| 2026-08-09 | **Import live URL + contact name** **LOCKED** — Serper Import leads prefer product/company URL patterns (`/product-detail/`, `/item/`, `/company/`, …); tip/blog/article hits are dropped. Card **name** is contact-facing company/seller when extractable from title/URL/snippet; raw SERP title stays in `externalTitle`. Prefer fewer live seats over bad links; heuristic pads remaining seats. |
| 2026-08-09 | **Card honesty + Assess listing** **LOCKED** — supplier cards strip invent years/★/Verified/MOQ/$/est. batch as marketplace truth. Live merge does not force `verified: true`. On-click **Assess listing** (Serper scrape → deterministic extract → skills `worth_sampling`|`caution`|`skip` → Gemini narrates Discovery-style popup; fail-closed without keys; narration failure still shows skills badge). Example voice: lead with supplier + platform + SKU; cite years/verified/rating/certs only from page facts; sample-ask language only — never “safe for bulk.” Founder still manually requests sample. |
| 2026-08-09 | Never re-export diligence types from `src/actions/supplier.ts` (`"use server"`) — Turbopack emits runtime value exports and breaks the actions module. |
| 2026-08-09 | **Import card names** — prefer Co./Ltd. from title/snippet, then `/company/` path or `{slug}.en.alibaba.com` storefront host; keep “Alibaba listing · SKU” only when unknown. Successful Assess with `companyName` may rewrite owned `supplier_options.name` and revalidate. |
| 2026-08-09 | **Assess company identity** — never use “Alibaba listing · …” as `companyName`; extract Alibaba supplier-card chrome (`… Co., Ltd.` + yrs + Store rating); Serper scrape may merge direct HTML when chrome missing; `worth_sampling` requires page-sourced company; persist page name to card. |
| 2026-08-09 | **Assess v1 voice restored** — no longer requires/persists supplier legal name; Gemini brief cites page signals when present and always directs founder to **Open on Alibaba/AliExpress** for full supplier profile; `worth_sampling` from SKU relevance + credibility (not company-identity gate). |
| 2026-08-09 | **Card UI hides Primary/Backup** — shortlist/chosen supplier chips no longer show Primary/Backup (seat labels from 3+2 invent/live fill); internal `role` remains for sample flow, layout, and CTAs. |
| 2026-08-09 | **Card commercialTermsHint removed** — shortlist/chosen supplier cards no longer show the commercial-terms disclaimer line; Assess / Open listing / sample CTAs unchanged. |
| 2026-08-09 | **Card invent red-flag ⚠ hidden** — shortlist cards no longer show the ⚠ / invent tooltip; live merge clears invent `redFlags` on live_search seats. |

### Assess listing recommendation tiers (skills pick; Gemini narrates)

| Tier | Founder copy | When |
| --- | --- | --- |
| `worth_sampling` | Worth requesting a sample | SKU-relevant listing + ≥1 credibility signal (Verified/Gold/Trade Assurance **or** years **or** solid rating) + not a hard mismatch — founder still opens listing for full supplier profile |
| `caution` | Proceed with caution | SKU-relevant but weak/missing diligence signals, or mixed |
| `skip` | Skip for now | Scrape too thin, irrelevant to SKU, or insufficient signals for even a sample ask |

Thin scrapes prefer `caution`/`skip` — never invent a green light. Gemini must not override the skills tier.

---

## 8) Related references

- Wave 1 Supplier: `README.md`, `src/lib/supplier/service.ts`, `SupplierPanel.tsx`
- Wave 2 Discovery (do not reopen): `docs/WAVE-2.md`
- Search vendors already in tree: `src/lib/discovery/providers/serper.ts`, `serpapi.ts`
