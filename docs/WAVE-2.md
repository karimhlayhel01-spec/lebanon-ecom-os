# Lebanon Ecom OS — Version 2 (Wave 2)

Product and engineering locks for Wave 2.  
**Wave 1** (multi-SKU hub, Postgres, ownership / fail-closed `skuId`, Topic A ledger, etc.) remains the live baseline — see `README.md`.

This document starts with the **Discovery agent** slice (winning product pick). Other Wave 2 surfaces (Founder Consultant, Shopify sync, ads, supplier email MCP, etc.) are out of scope here until locked separately.

**Status:** Discovery agent listing + **Path 1 product pool intake** + card **“Why this pick?”** explain (LLM optional, not scoring brain) — **LOCKED** (founder discussion). Not implemented until a Build pass says otherwise.

**Canonical doc:** this file. Do not reopen locks unless the founder explicitly changes one.

---

## 1) Wave 2 intent (Discovery slice)

**Founder pain:** pick a product that can actually win in **Lebanon**.

**UX target:**
- Research is **automated** (no manual catalog tags, no founder market homework).
- Founder mainly **accepts or rejects** shortlisted products.
- Focus is **winning products**, not brand discovery (brand text in a title is incidental).
- Paste **demand confirm** (URL / note / screenshot) is **planned for removal** after automation is trusted (dual-gate rollout first — see §7).
- **Founder Consultant / LLM chat** — **parked**; not part of this Discovery lock.

**No commercial marketplace / courier / Alibaba partner agreements required** for this slice (founder has no live Alibaba business → official Alibaba Open Platform access is **out**).

**External dependencies (expected):**
- **Web / shopping search SaaS API key(s)** for (a) Path 1 product intake and (b) demand/competition scoring
- Optional LLM key later for §6.1 “Why this pick?” explain copy only — **not** for pass/fail scoring
- Optional later: dropship-catalog SaaS API as a **backup** pool source (not required to start)

---

## 1b) Product pool source — Path 1 (**LOCKED**)

### What Path 1 is (plain English)

A scheduled/robot intake uses a **normal web/shopping search API** (API key, no Alibaba partnership) to find **winning-product candidates** on the public internet, writes them into **our Postgres product pool**, then the locked scoring stack decides which ones each founder sees.

```text
Internet (search / shopping API)
   → product pool in Postgres (names, price seeds, category, source URL…)
   → locked Lebanon win scoring (demand × competition × budget × Fit × soft margin)
   → Discovery shortlist
   → founder accept / reject
```

### Path 1 goals

| Goal | Detail |
| --- | --- |
| **Live-ish products** | Pool refreshes on a cadence (e.g. weekly add/update; scores refresh more often — see Approach A) |
| **Winning products** | Optimize for sellable product concepts — **not** a brand directory |
| **No Alibaba official API** | Unavailable without live business; do **not** block on Accio or Alibaba Open Platform |
| **Structured rows** | Every ingested item must normalize into pool fields (EN name at minimum; AR when possible; category; price/cost seeds; source URL; optional MOQ hint) before scoring |

### Path 1 is *not*

- Official Alibaba / 1688 partner API  
- Accio as a required integration  
- Inventing suppliers on the Discovery card (Supplier **3+2** remains **after accept**, Wave 1)  
- Session-time free-form “LLM invents a gadget name” without pool persistence  
- Brand-first listing  

### Seed / fallback

- Existing `src/lib/discovery/catalog.ts` may remain a **seed or fallback** until Path 1 ingest is reliable.  
- Long-term SoT for listable products = **Postgres product pool** fed by Path 1 (plus optional backup dropship API later).

### Cadence (locked intent)

| Layer | Cadence |
| --- | --- |
| **Product pool intake** | Slower — e.g. **weekly** expand/refresh candidates |
| **Demand/competition scores** on pool rows | Faster — e.g. **daily** (Approach A cache) |

---

## 2) Discovery agent — job

**Job:** Build a shortlist of **potential winning products for this founder in Lebanon**, then let them accept/reject.

A listed product must make sense on:

| Factor | Question |
| --- | --- |
| **Demand** | Will people buy in Lebanon (or is there a clear import opportunity)? |
| **Competition** | Who are they up against locally? |
| **Budget** | Can they afford **this fight** (stock + marketing when crowded)? |
| **Fit** | Can *this* founder operate it? (existing Wave 1 skill) |
| **Soft margin** | Near 70% before / 35% after — slightly under OK for listing |

Plus ordered polish: sample/first-batch affordability, shortlist diversity, confidence, “why listed” explainability.

**Core formula (locked):**  
`demand × competition × budget × Fit` + **soft margin** (+ polish, ordered so they don’t fight the core).

---

## 3) Demand (locked)

### 3.1 Geography

| Priority | Region | Role |
| --- | --- | --- |
| **Primary abroad** | **US / EU** | “Doing well abroad” traction |
| **Secondary abroad** | Other foreign (non-Gulf) | Soft boost if US/EU is thin |
| **Not a separate abroad source** | **Gulf** | Usually already reflected in US/EU trends |
| **Local market** | **Lebanon only** | Local demand + competition |

### 3.2 Dual demand paths (do not AND everything)

A product may qualify via **either**:

1. **Whitespace path:** strong US/EU (abroad) traction **+** weak/absent Lebanon footprint (gap), **or**
2. **Local-proven path:** strong Lebanon demand even if abroad is quiet

### 3.3 Social

- **Soft signal only**, via whatever appears in **web search** results (TikTok / IG / YouTube / Facebook public pages, etc.).
- **Not** full dedicated social-listening APIs in this Discovery lock.

### 3.4 Not demand sources (this lock)

- Founder-pasted URL / note / screenshot (to be removed after dual-gate)
- Manual “abroad hot” editorial flags on catalog rows
- Shopify / Meta Ads / courier partner feeds
- Commercial Tier-1 seller APIs

---

## 4) Competition (locked)

### 4.1 Scope

**Lebanon-only:**

- Local shops / sellers that appear in Lebanon-oriented search
- Tier-1 marketplaces already in product: **Ishtari**, **EGLOW**, **Platza**

### 4.2 Listing behavior

| Competition | Listing stance |
| --- | --- |
| **Low** (gap) | Easier Strong-friendly path |
| **Medium** | Listable; later coaching optional |
| **High** (Tier-1 + many locals) | Still **show** as **Okay** → **customize / drop** — **not** auto-hide |

**Customize → LLM differentiation coach** is **parked** (Consultant later), not required for this listing lock.

### 4.3 Competition × budget (“can they fight?”)

Not only “can they buy the SKU?” — “can they afford **this fight**?”

| Competition | Budget must mainly cover |
| --- | --- |
| **Low** | Sample + **small** first batch |
| **Medium** | Sample + batch + **some** ads runway |
| **High** | Sample + batch + **meaningful ads runway** (onboarding **monthly follow-on budget**) |

- Same catalog SKU may list for a high-budget founder and downrank/hide for a thin-budget beginner.
- **First implementation shape:** competition×budget as a **ranking penalty**; promote to hard exclude only after calibration (see §7).
- Missing MOQ / sample fields → **neutral** (do not exclude solely for missing data).

Reuse existing onboarding fields: budget / max landed / monthly follow-on (already used in after-ads margin).

---

## 5) Fit & soft margin (locked)

### 5.1 Fit (existing Wave 1)

Unchanged skill order: **budget → experience → risk → time → storage → workload** (likes soft).  
Still gates ability to operate the product.

### 5.2 Soft margin (Discovery listing policy)

- Targets remain **~70% before ads / ~35% after ads**.
- For **listing**, treat as a **band**: slightly under may still appear (typically **Okay** + short “margins tight vs target” note).
- Far below → do not recommend.
- Exact band width (e.g. 65%/30% vs 68%/33%) is an implementation calibration detail — not frozen to a number in this lock.
- **Note:** Wave 1 code may still hard-gate margin on accept until a Build pass changes it; this lock is the Wave 2 Discovery **intent**.

---

## 6) Polish skills (locked, ordered)

Applied **after** core pass/rank — must not cancel core winners without priority rules:

1. **Sample / first-batch affordability** — can they *test* on this budget?  
2. **Shortlist diversity** — avoid five near-clones in the first 5  
3. **Explainability** — why listed (skills payload → founder-facing copy; see §6.1)  
4. **Confidence** — low automation confidence → Okay / fewer slots, not fake Strong  

### 6.1 Card “Why this pick?” — explain only (**LOCKED**)

Optional LLM (or deterministic template until an LLM key exists) that narrates **already computed** skill outputs. **Not** a scoring brain.

| Rule | Detail |
| --- | --- |
| **Control** | Per Discovery product card button (e.g. **“Why this pick?”**) |
| **Output** | One **small paragraph** — same visual footprint as today’s **confirm-demand** summary block (title + ~2–3 sentence `text-sm` body + short honesty note). Not an essay. |
| **Grounding** | Skill payloads only (Fit, soft margin, demand/competition/budget when those scores exist). **Must not invent** demand, competition, or abroad facts missing from the payload. |
| **Never changes** | Strong / Okay, shortlist rank, accept / reject gates, Human Approvals |
| **Distinct from demand confirm** | Different title from the demand-summary callout; honesty line makes clear this is **explanation, not a score** |
| **Optional key** | Hide or no-op without LLM key; cache per candidate/session; rate-limit spam |
| **Build timing** | Prefer with or after Wave 2 scoring skills so copy can cite real Path 1 evidence; until then Fit/margin-only explanations are OK — do **not** fake “US traction + Lebanon gap” |
| **Non-goal** | Not Founder Consultant chat, not Tier-1 customize coach, not pass/fail |

---

## 7) Risk controls & efficiency tricks (locked)

These are part of the engineering contract, not optional nice-to-haves:

| Trick | Rule |
| --- | --- |
| **Cache-first (Approach A)** | Score catalog on a **schedule**; Discovery **reads DB**; do not live-search every page load |
| **Last-known score** | On search API failure, keep previous scores — don’t empty Discovery |
| **Query caps** | Limit queries per product per refresh (abroad + Lebanon + Tier-1 family) |
| **Downrank before hard hide** | Weak scores sink; hard hide only worst tail / Fit fail / far-below margin / oversized |
| **Shadow / feature flags** | Log “would exclude” before enforcing hard filters; flag soft vs hard competition×budget |
| **Dual demand paths** | Whitespace OR local-proven — never require every AND at once |
| **Missing data = neutral** | Incomplete MOQ/sample → don’t exclude |
| **Competition×budget** | Rank penalty first; harden later using empty/accept metrics |
| **Fallback shortlist** | If &lt;5 passers → best Fit + soft-margin + clear message |
| **Edit onboarding** | When profile/budget/Fit starves the list (see §8) |
| **Paste demand confirm** | Dual-gate with system score until trusted → then remove |
| **No LLM/MCP in pass/fail** | Skills score; LLM optional only for §6.1 “Why this pick?” explain copy; MCP optional wrapper later |
| **Measure** | Empty rate, accept rate, edit-onboarding rate — tune thresholds from data |

**Never-all-blocked spirit:** Discovery must not strand the founder with a dead end when the catalog still has Fit-plausible items; use fallback + edit onboarding.

---

## 8) Edit onboarding — when to show (locked)

Keep Wave 1 ladder behavior; extend gently for Wave 2 scores:

| Show Edit onboarding | Why |
| --- | --- |
| Discovery empty ladder **why_pass** | After repeated rejects — suggestions from pass reasons |
| Discovery **catalog_exhausted** | Nothing left for this profile |
| Soft banner when Wave 2 scores leave **too few** products and blocker is **budget/Fit** | Profile is filtering out fights they can’t fund |
| ⚙ Settings — always | Escape hatch |

| Do **not** hard-nag | Why |
| --- | --- |
| Normal shortlist of ~5 good products | Don’t interrupt browsing |
| Low search confidence alone | Data issue, not onboarding |
| Every Okay / Tier-1 customize | Product strategy, not profile edit |

---

## 9) Web search API — sources (locked)

The search API queries the **public web index** (not a private crawl contract). Control is via **query templates** and **which result types we trust**.

**Two uses of the same class of API:**

1. **Path 1 intake** — discover product candidates (US/EU trending / category winners, etc.) → write pool rows  
2. **Scoring** — for each pool row, assess abroad demand, Lebanon demand, Tier-1/local competition  

### 9.1 Abroad demand / intake sources

- **US / EU** marketplaces and large retail product pages (Amazon-class and major EU shops)
- US/EU review / “best of” / roundup / editorial product pages
- Shopping-style search results for category bestsellers / trending queries aligned to onboarding industries
- Other foreign results only as **secondary** boost
- **Gulf sites are not a primary abroad source**

### 9.2 Lebanon demand sources

- Lebanon / Beirut / “Lebanon” / Arabic–English queries for product or category
- Local e-commerce, brand, and shop sites that appear for Lebanon
- Local classifieds / small sellers when they appear in search
- Public social mentions **only when they appear in search** (soft)

### 9.3 Competition sources

- **Ishtari**
- **EGLOW**
- **Platza**
- Other local sellers cluttering Lebanon search results  

Typical pattern: product/category queries and `site:`-style Tier-1 checks (prefer search snippets over brittle full-page HTML scrapers in v1 of this slice).

### 9.4 Explicitly out of scope as sources

- Founder paste
- Manual editorial abroad flags / brand directories
- Official Alibaba Open Platform / Accio (no access path for this founder stage)
- Partner/seller private APIs (Ishtari/EGLOW/Platza commercial)
- Dedicated Meta/TikTok/YouTube marketing APIs (unless added in a later lock)
- HTML scraping of Accio/Alibaba as source of truth

---

## 10) Engineering architecture (locked)

```text
Path 1 intake (scheduled)
  → Web / shopping Search API (US/EU product candidates)
  → Normalize → Postgres product pool
        ↓
Scoring job (Approach A, more frequent)
  → Web Search API (US/EU + Lebanon + Tier-1/local) per pool row
  → Persist scores in Postgres (cache)
        ↓
Skills:
  Demand · Competition · BudgetFight · Fit · SoftMargin
  · SampleAffordability · Diversity · Confidence · Explain
        ↓
Discovery agent: filter/rank → shortlist UI (~5, show more → session cap)
        ↓
Founder: accept / reject (Tier-1: customize / drop)
        ↓
(After accept — Wave 1, unchanged)
Supplier agent: 3+2 options, sample-first, …
```

| Layer | Responsibility |
| --- | --- |
| **Path 1 intake API** | Find live-ish **winning product** candidates; write pool (not brand DB) |
| **Scoring API** | Fetch public web evidence for demand/competition on pool rows |
| **Skills** | Deterministic (or rule-based) scoring — unit-testable; source of pass/rank truth |
| **Discovery agent** | Orchestrates shortlist UI; does **not** bypass Human Approvals on accept |
| **MCP** | Optional later tool wrapper around the **same** API clients — not required for Approach A |
| **LLM** | Optional §6.1 “Why this pick?” paragraph only — **not** the shortlist pass/fail brain |
| **Cursor MCP / Browser** | Builder/ops aids only — **not** the production catalog for founders |

### 10.1 Interface evolution note

Wave 1 `DemandProvider` today is largely `summarize(founder signal)`.  
Wave 2 needs:
- **Pool intake** (Path 1) replacing static-only `catalog.ts` as SoT  
- **Catalog-level assessment** (e.g. `assessLebanonDemand` / abroad / competition scores) feeding Discovery **before** shortlist  

Extend seams without requiring founder paste.

### 10.2 Env (expected when implementing)

- `DATABASE_URL` (existing)
- Search / shopping provider key(s) (name TBD at Build — e.g. SerpAPI / Bing / Google PSE / Brave) — document in `.env.example` as commented placeholders
- Optional: LLM key only if §6.1 “Why this pick?” explain-copy is built
- Optional later: dropship catalog API key as backup intake

---

## 11) Explicit non-goals (this Discovery lock)

- Founder Consultant always-on chat / contextual triggers  
- Shopify Admin sync  
- Meta / TikTok ads pull into Topic A  
- Courier / COD network APIs  
- Commercial Ishtari/EGLOW/Platza partner integrations  
- Official Alibaba / Accio as required upstream  
- Brand-directory or brand-first Discovery  
- Pre-attaching full supplier shortlists on Discovery cards (Supplier stays post-accept)  
- Requiring MCP for core shortlist scoring  
- Using Gulf as primary abroad signal  
- Hard-hiding all Tier-1 collisions  
- Relying on Cursor-only MCP/browser as the live product feed for end users  
- Using LLM as Fit / demand / competition / pass-fail scorer (explain paragraph only — §6.1)  
- Treating “Why this pick?” as Founder Consultant chat or Tier-1 customize coach  

---

## 12) Lock changelog

| Date | Change |
| --- | --- |
| 2026-08-02 | Initial Wave 2 doc: Discovery agent listing + sources + engineering + risk tricks **LOCKED** |
| 2026-08-03 | **Path 1** product pool intake **LOCKED** (search/shopping API; no Alibaba official; winning products not brands; catalog.ts seed/fallback; Supplier remains post-accept) |
| 2026-08-03 | Card **“Why this pick?”** explain **LOCKED** (§6.1): demand-summary-sized paragraph from skill payloads only; optional LLM; never pass/fail; build with/after Wave 2 scores preferred |

---

## 13) Related Wave 1 references

- Fit: `src/lib/skills/fit.ts`
- Margin: `src/lib/skills/margin.ts`
- Catalog seed + `DemandProvider` seam: `src/lib/discovery/catalog.ts` (seed/fallback until Path 1 pool is SoT)
- Discovery ladder / edit-onboarding suggestions: `src/lib/discovery/ladder.ts`
- Product overview: `README.md`
- Early v1 plan (historical; Wave 1 multi-SKU superseded single-active UX): `.cursor/plans/lebanon_ecom_os_v1_4977ab1a.plan.md`
