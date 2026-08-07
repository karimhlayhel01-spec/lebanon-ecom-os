# Lebanon Ecom OS — Version 2 (Wave 2)

Product and engineering locks for Wave 2.  
**Wave 1** (multi-SKU hub, Postgres, ownership / fail-closed `skuId`, Topic A ledger, etc.) remains the live baseline — see `README.md`.

This document starts with the **Discovery agent** slice (winning product pick). Other Wave 2 surfaces (Founder Consultant, Shopify sync, ads, supplier email MCP, etc.) are out of scope here until locked separately.

**Status:** Discovery agent listing + **Path 1 product pool intake** + card **“Why we suggested this”** explain + **worth-considering compare (max 3)** (**required Gemini** narrates; skills pick winner) — **LOCKED** (founder discussion).

**Canonical doc:** this file. Do not reopen locks unless the founder explicitly changes one.

---

## 1) Wave 2 intent (Discovery slice)

**Founder pain:** pick a product that can actually win in **Lebanon**.

**UX target:**
- Research is **automated** (no manual catalog tags, no founder market homework).
- Founder mainly **accepts or rejects** shortlisted products.
- Focus is **winning products**, not brand discovery (brand text in a title is incidental).
- Paste **demand confirm** (URL / note / screenshot) is **REMOVED** — accept uses **system skill gates only** (see §6.1 / §7).
- **Founder Consultant / LLM chat** — **parked**; not part of this Discovery lock.

**No commercial marketplace / courier / Alibaba partner agreements required** for this slice (founder has no live Alibaba business → official Alibaba Open Platform access is **out**).

**External dependencies (expected):**
- **Web / shopping search SaaS API key(s)** for (a) Path 1 product intake and (b) demand/competition scoring
- **Required Gemini (Google AI) API key** for card “Why we suggested this” explain copy only — **not** for pass/fail scoring
- Optional later: dropship-catalog SaaS API as a **backup** pool source (not required to start)

---

## 1b) Product pool source — Path 1 (**LOCKED**)

### What Path 1 is (plain English)

A scheduled/robot intake uses a **normal web/shopping search API** (API key, no Alibaba partnership) to find **winning-product candidates** on the public internet, writes them into **our Postgres product pool**, then the locked scoring stack decides which ones each founder sees.

```text
Internet (search / shopping API)
   → product pool in Postgres (names, price seeds, category, source URL…)
   → locked Lebanon win scoring (demand × competition × budget × Fit × soft margin scoring)
   → Discovery shortlist (accept-ready only)
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
| **Soft margin** | Hard **≥70% before / ≥35% after** for shortlist listing (same as accept) |

Plus ordered polish: sample/first-batch affordability, shortlist diversity, confidence, “why listed” explainability.

**Core formula (locked):**  
`demand × competition × budget × Fit` + **soft margin scoring** (+ polish, ordered so they don’t fight the core).  
**Shortlist listing** = accept-ready only (hard margins + demand gate + !oversized) — see §5.2 / §7.

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

#### Qualified path requires real evidence (**LOCKED**)

A **qualified** path label (`whitespace` / `local_proven`) requires **real measured evidence on every leg the label claims**. Neutral fill can **never** earn a path label.

| Rule | Detail |
| --- | --- |
| **Whitespace** | Needs a real **abroad** score **and** a real **Lebanon** score (the label claims traction *and* a gap — both are measurements) |
| **Local-proven** | Needs a real **Lebanon** score **strictly above** the neutral fill value — a score sitting *at* neutral is not proof, even when a calibration threshold happens to equal it |
| **Neither qualifies** | Rank on the stronger leg (never excluded), and label a soft path **only** when that leg is real evidence; otherwise `demandPath = null` (unproven) |
| **A search that returned nothing** | **Is** real evidence (measured absence) — distinct from a leg that was never measured |
| **Founder copy** | An unproven path is shown as **estimate only**, never as abroad traction or Lebanon demand |

“Missing data = neutral” (§7) means **do not exclude**. It never means **counts as proven**.

### 3.3 Social

- **Soft signal only**, via whatever appears in **web search** results (TikTok / IG / YouTube / Facebook public pages, etc.).
- **Not** full dedicated social-listening APIs in this Discovery lock.

### 3.4 Not demand sources (this lock)

- Founder-pasted URL / note / screenshot (**removed** — not used for accept or scoring)
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

- Targets remain **≥70% before ads / ≥35% after ads** — **same hard bar as accept**.
- **Shortlist = accept-ready only.** A card appears iff Accept would not return `blocked` / `needs_system_demand_missing` / `needs_system_demand_weak` (hard margins pass, not oversized, system demand gate pass when `DISCOVERY_POOL_V2` is on).
- Do **not** list soft_ok / soft-margin-only / hard-margin-fail / oversized / weak-demand cards “for browsing.”
- Soft-margin bands (`pass` / `soft_ok` / `far_below`) may still exist for **scoring / explain** — they do **not** unlock listing for under-target margins.
- Tier-1 customize/drop and Okay risk-ack remain on otherwise accept-ready cards.

---

## 6) Polish skills (locked, ordered)

Applied **after** core pass/rank — must not cancel core winners without priority rules:

1. **Sample / first-batch affordability** — can they *test* on this budget?  
2. **Shortlist diversity** — avoid five near-clones in the first 5  
3. **Explainability** — why listed (skills payload → founder-facing copy; see §6.1)  
4. **Confidence** — low automation confidence → Okay / fewer slots, not fake Strong

**Confidence floors (LOCKED).** A product we could not measure never reads **Strong**:

| Rule | Detail |
| --- | --- |
| **Unknown confidence** | Absent / non-numeric confidence is treated as **heuristic-grade** (`HEURISTIC_SEED_CONFIDENCE`), never as mid-confidence. A never-scored pool product cannot render Strong. |
| **Boundary is inclusive** | Confidence **at or below** `CONFIDENCE_OKAY_CAP` caps strength to Okay — the cap value itself is not “confident enough”. |
| **Neutral evidence caps too** | A neutral-filled demand leg caps strength to Okay independently of the confidence number, with reason `low_evidence_confidence` (§3.2). |
| **One source of truth** | Shortlist ranking scores a card with the **same** confidence the demand gate resolved for it, so displayed strength and gate logic never disagree. |  

### 6.1 Card “Why we suggested this” — explain only (**LOCKED**)

**Required Gemini** (Google AI / Generative Language) narrates **already computed** skill outputs — market demand + competition + why listed. **Not** a scoring brain. No template-only product UX for this paragraph.

| Rule | Detail |
| --- | --- |
| **Control** | Always-visible (or clearly placed / toggleable) callout on each Discovery card where paste demand used to live |
| **Output** | One modal paragraph — title + **4–6 complete sentences**, targeting **~900–1100 characters** (validator tolerance starts at 800; hard max 1100), plus a short honesty note. Longer than the prior demand-summary footprint, but still not chat or an essay. |
| **Grounding** | Fit, hard-margin planning, and curated differentiation may always be narrated. **Concrete market specifics** (counts, domains/titles, seller or Tier-1 names, abroad/Lebanon footprint) require bounded `rawEvidenceJson` facts from `source: "live_search"` with the relevant count &gt;0. `heuristic_seed` / neutral never cite market specifics. |
| **Okay alignment** | Typed reason is exactly `fit_risk`, `low_evidence_confidence`, or `high_competition`. The yellow note and Gemini paragraph must state the same real reason; Strong Fit must never be described as moderate because confidence or competition capped the recommendation. |
| **Mitigation** | An Okay paragraph ends with a concrete mitigation for that reason (small sample / modest ads / curated differentiation / do not scale on an estimate alone), then a clear accept-to-sample vs skip choice. Strong recommendations do not receive an Okay scare sentence. |
| **Never changes** | Strong / Okay, shortlist rank, accept / reject gates, Human Approvals |
| **One reason, one source** | The typed reason is resolved **once** (`resolveOkayReasonForDisplay`) and shared by the card note and the Gemini payload — including legacy rows, where a stored `fit_risk` label on a strong operational Fit heals to the real cap reason. The note key always matches the typed reason. |
| **Validate the finalized body** | Length, footprint, grounding, and Okay alignment run on the **finalized** paragraph, never the raw draft: a trimmed 7th sentence must not fail a valid answer. Only a hard blocklist (jargon, stock lines, estimate-mode market phrases, un-found Tier-1 names) short-circuits before finalize. |
| **One bounded retry** | A validation / grounding / alignment failure earns **exactly one** retry with a tightened instruction (restated length window, plus “no market specifics” when estimate-only). **Never** retry a missing key or a quota / rate-limit response. |
| **Failure copy** | Each failure kind reads distinctly for the founder: wording we could not verify, a paragraph that came back unfinished, the service being unreachable, a missing key, rate limit, or feature off. |
| **Honesty** | Explanation, **not** a score; distinct from any accept-gate messaging. Note says whether copy uses saved live-search evidence or is estimate-only. Honesty rules stay strict — estimate-only copy never cites counts, domains, sellers, or Tier-1 names. |
| **Approach A evidence** | Score-refresh jobs persist capped evidence only (up to 5 short domain/title/seller facts per leg + actual Tier-1 names); Discovery GET reads it and **never live-searches**. No snippets/full HTML. |
| **Required key** | `GEMINI_API_KEY` or `DISCOVERY_EXPLAIN_GEMINI_API_KEY` via `.env` only. Missing key → fail-closed UI (“configure key”), never silent invent |
| **No paste** | Founder paste demand confirm is **removed**; accept does **not** require paste |
| **Non-goal** | Not Founder Consultant chat, not Tier-1 customize coach, not pass/fail |

### 6.2 Worth considering compare (max 3) — skills pick, Gemini explains (**LOCKED**)

Founder marks shown Discovery cards as **worth considering**. Skills pick the advised test among the marks; Gemini only narrates that advice.

| Rule | Detail |
| --- | --- |
| **Marks** | Per-card checkbox; **max 3** marks per active session. Clear copy when a 4th mark is blocked. |
| **Compare box** | Sticky/compare tray shows selected names. **Compare** enabled only with **2–3** marks. |
| **Session scope** | Marks are session-scoped. Refresh suggestions / new session clears them. Rejected or no-longer-visible cards are dropped from the selection (no stale compare). |
| **Winner** | Deterministic skills ranking **among selected only** (Wave 2 composite when present, else Fit; stable ties by session rank / id). Expose advised `candidateId` + `catalogKey`. **Gemini does not override.** |
| **Output** | Modal brief: why the advised product wins vs the other 1–2; short opportunity thesis per product; Fit/budget/margins; differentiation; main uncertainty; recommended sample-first test. Live vs Estimate honesty. Advice only — **Accept remains free choice on any card**. Never “you must accept X.” |
| **Grounding** | Same as §6.1 — no invented market facts; live specifics only from saved `live_search` evidence. |
| **Rate / fail-closed** | Shares explain rate-limit patterns with §6.1; missing Gemini key → fail-closed UI. |
| **Never changes** | Accept gates, shortlist rank, Human Approvals, Consultant chat |

---

## 7) Risk controls & efficiency tricks (locked)

These are part of the engineering contract, not optional nice-to-haves:

| Trick | Rule |
| --- | --- |
| **Cache-first (Approach A)** | Score catalog on a **schedule**; Discovery **reads DB**; do not live-search every page load |
| **Last-known score** | On search API failure, keep previous scores — don’t empty Discovery |
| **Query caps** | Limit queries per product per refresh (abroad + Lebanon + Tier-1 family) |
| **Downrank before hard hide** | Weak scores sink in ranking; **shortlist never includes** non-accept-ready (hard margin fail / soft_ok / far-below / oversized / demand-fail) |
| **Shadow / feature flags** | Log “would exclude” before enforcing hard filters; flag soft vs hard competition×budget |
| **Dual demand paths** | Whitespace OR local-proven — never require every AND at once |
| **Missing data = neutral** | Incomplete MOQ/sample → don’t exclude. Neutral means **do not exclude**, never **counts as proven** (§3.2) |
| **Neutral demand leg at the gate** | A scored row whose deciding demand leg was neutral-filled **still passes** the system demand gate on score alone (missing data never excludes) — **but** it earns **no** `demandPath`, reports `usedNeutral`, and the card is capped to **Okay** with `low_evidence_confidence` and labelled **estimate-only**. A row with **no usable score at all** stays fail-closed `missing` (unchanged) |
| **Competition×budget** | Rank penalty first; harden later using empty/accept metrics |
| **Accept-ready shortlist** | List **only** products Accept would not block on margins / oversized / system demand. **No** soft-margin fill of non-accept cards |
| **Edit onboarding** | When 0 (or below usable threshold) accept-ready products for this profile — empty shortlist + Edit onboarding note (see §8). Never strand on a page of blocked cards |
| **Paste demand confirm** | **REMOVED** — accept uses system skill gates only (demand/competition/Fit/hard-margin/Tier-1/oversized); no founder paste |
| **No LLM/MCP in pass/fail** | Skills score; **required Gemini** only for §6.1 “Why we suggested this” and §6.2 compare briefs — never the shortlist / compare winner brain; MCP optional wrapper later |
| **Measure** | Empty rate, accept rate, edit-onboarding rate — tune thresholds from data |

**Never strand the founder:** when the pool has only weak / non-accept-ready products, show an **empty shortlist + Edit onboarding** — not soft-listed blocked cards.

---

## 8) Edit onboarding — when to show (locked)

Keep Wave 1 ladder behavior; extend gently for Wave 2 scores:

| Show Edit onboarding | Why |
| --- | --- |
| Discovery empty ladder **why_pass** | After repeated rejects — suggestions from pass reasons |
| Discovery **catalog_exhausted** | Nothing accept-ready left for this profile |
| **0 accept-ready** (or below usable threshold) — soft banner / note | Profile budget/Fit/demand gates leave no (or too few) accept-ready products — never fill with blocked cards |
| Soft banner when Wave 2 scores leave **too few** accept-ready products and blocker is **budget/Fit** | Profile is filtering out fights they can’t fund |
| ⚙ Settings — always | Escape hatch |

| Do **not** hard-nag | Why |
| --- | --- |
| Normal shortlist of ~5 accept-ready products | Don’t interrupt browsing |
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
| **LLM** | **Required** §6.1 “Why we suggested this” + §6.2 compare briefs via **Gemini** — **not** the shortlist / compare-winner pass/fail brain |
| **Cursor MCP / Browser** | Builder/ops aids only — **not** the production catalog for founders |

### 10.1 Interface evolution note

Wave 1 `DemandProvider` / paste confirm is **retired** for Discovery accept.  
Wave 2 needs:
- **Pool intake** (Path 1) replacing static-only `catalog.ts` as SoT  
- **Catalog-level assessment** (e.g. `assessLebanonDemand` / abroad / competition scores) feeding Discovery **before** shortlist  
- **Gemini explain** narrating those skill payloads on the card  

Extend seams without requiring founder paste.

### 10.2 Env (expected when implementing)

- `DATABASE_URL` (existing)
- Search / shopping provider key(s) (e.g. SerpAPI) — document in `.env.example` as commented placeholders
- **Required for suggestion copy:** `GEMINI_API_KEY` or `DISCOVERY_EXPLAIN_GEMINI_API_KEY` (never commit secrets)
- Optional later: dropship catalog API key as backup intake

### 10.3 Session vs pool resync (implementation)

Approach A jobs update the **global** pool/score tables. An **active** Discovery session still shows the shortlist frozen at session start (reject / show-more / seen-key rules unchanged).

When `DISCOVERY_POOL_V2` is on, the UI exposes **Refresh suggestions**: close the active session → re-rank from current pool + scores → open a new session. Workspace-seen catalog keys remain excluded (same as Continue). Refresh does not bump exhausted rounds.

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
- Using LLM as Fit / demand / competition / pass-fail scorer (explain + compare briefs only — §6.1 / §6.2)  
- Treating “Why we suggested this” or compare as Founder Consultant chat or Tier-1 customize coach  
- Letting Gemini override the skills-picked compare winner (§6.2)  
- Requiring founder paste demand confirm for Discovery accept  

---

## 12) Lock changelog

| Date | Change |
| --- | --- |
| 2026-08-02 | Initial Wave 2 doc: Discovery agent listing + sources + engineering + risk tricks **LOCKED** |
| 2026-08-03 | **Path 1** product pool intake **LOCKED** (search/shopping API; no Alibaba official; winning products not brands; catalog.ts seed/fallback; Supplier remains post-accept) |
| 2026-08-03 | Card **“Why this pick?”** explain **LOCKED** (§6.1): demand-summary-sized paragraph from skill payloads only; optional LLM; never pass/fail |
| 2026-08-04 | **Paste demand confirm REMOVED**; accept = system skill gates only; §6.1 **required Gemini** “Why we suggested this” (market + competition); no LLM in pass/fail |
| 2026-08-04 | **Shortlist = accept-ready only** — supersedes soft-margin listing band + soft-margin fallback fill; 0 accept-ready → empty + Edit onboarding (§5.2 / §7 / §8) |
| 2026-08-05 | §6.1 **grounded market evidence** — jobs persist bounded live-search facts; Gemini may cite concrete market specifics only from those facts; heuristic/neutral copy is explicitly estimate-only |
| 2026-08-05 | §6.1 body expanded to **4–6 complete sentences (~900–1100 chars; 800-char validator tolerance / 1100 hard max)**; yellow Okay note and Gemini now share one typed reason and reason-matched mitigation; opportunity thesis follows grounded evidence → Fit/budget → economics → differentiation → uncertainty → test; cache bumped to `v7-confidence-thesis-900-1100` |
| 2026-08-05 | §6.2 **Worth considering compare (max 3)** **LOCKED** — skills pick among marks; Gemini explains advice only; Accept remains free choice; compare cache `v1-worth-considering-compare` |
| 2026-08-07 | §6.1 **Explain reliability + single-source Okay reason** **LOCKED** — validators run on the **finalized** body (a trimmed 7th sentence no longer fails a valid answer; only a hard blocklist pre-checks the raw draft); paragraph is packed from **whole sentences** inside 800–1100 and abbreviations like “U.S.” no longer split into fake sentences; **exactly one** tightened retry on validation / grounding / alignment failure and **never** on missing key or rate limit; card note and Gemini payload share one resolver so they can never state two reasons; runtime guard keeps Okay scare wording off **Strong**; distinct EN + AR copy per failure kind; cache bumped to `v8-single-reason-retry` |
| 2026-08-07 | **Truthful demand + confidence floors** **LOCKED** (§3.2 / §6 / §7): “missing data = neutral” means *do not exclude*, never *counts as proven*; a qualified `whitespace` / `local_proven` label requires real evidence on every leg it claims (local-proven strictly above neutral), else `demandPath = null` and founder copy reads **estimate only**; unknown confidence floors to `HEURISTIC_SEED_CONFIDENCE` and the Okay cap boundary is inclusive, so never-scored products cannot read **Strong**; neutral deciding leg **passes** the demand gate but is capped Okay with `low_evidence_confidence` |

---

## 13) Related Wave 1 references

- Fit: `src/lib/skills/fit.ts`
- Margin: `src/lib/skills/margin.ts`
- Catalog seed + `DemandProvider` seam: `src/lib/discovery/catalog.ts` (seed/fallback until Path 1 pool is SoT)
- Discovery ladder / edit-onboarding suggestions: `src/lib/discovery/ladder.ts`
- Product overview: `README.md`
- Early v1 plan (historical; Wave 1 multi-SKU superseded single-active UX): `.cursor/plans/lebanon_ecom_os_v1_4977ab1a.plan.md`
