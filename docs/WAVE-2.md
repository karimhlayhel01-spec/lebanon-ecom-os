# Lebanon Ecom OS — Version 2 (Wave 2)

Product and engineering locks for Wave 2.  
**Wave 1** (multi-SKU hub, Postgres, ownership / fail-closed `skuId`, Topic A ledger, etc.) remains the live baseline — see `README.md`.

This document starts with the **Discovery agent** slice (winning product pick). Other Wave 2 surfaces (Founder Consultant, Shopify sync, ads, supplier email MCP, etc.) are out of scope here until locked separately.

**Status:** Path 1 intake + Approach A scores + accept-ready gates + Why/Compare engines remain **LOCKED**. **Discovery agent UI** — **LOCKED 2026-08-19** in **§14**. **Frame-aware retrieve + differ required + tile receipts** — **LOCKED 2026-08-20** in **§14.11**. **Edit onboarding dry-run + return to same frame** — **LOCKED 2026-08-20** in **§14.12**. Flag `DISCOVERY_AGENT_UI` default **off**. Build only via §14.8 (three PRs) then §14.11 / §14.12. Do not ship chat, live-search on click, or a second Accept/Compare.

**Canonical doc:** this file. Do not reopen locks unless the founder explicitly changes one.

---

## 1) Wave 2 intent (Discovery slice)

**Founder pain:** pick a product that can actually win in **Lebanon**.

**UX target:**
- Research is **automated** (no manual catalog tags, no founder market homework).
- Founder mainly **accepts or proceeds** from suggested products (or Compare, then one Proceed).
- Focus is **winning products**, not brand discovery (brand text in a title is incidental).
- Paste **demand confirm** (URL / note / screenshot) is **REMOVED** — accept uses **system skill gates only** (see §6.1 / §7).
- **Founder Consultant messenger / ChatGPT thread** — still **parked**. **§14** unlocks **OS-chrome questions** (one card at a time), not a transcript.

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
   → Discovery retrieve (accept-ready only, then §14 hide-dump)
   → founder Proceed / Compare / Explore more (§14)
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
| **High** (Tier-1 + many locals) | **§14 hide-dump (LOCKED 2026-08-19):** do **not** retrieve / show on the agent grid when pool+scores exist. Supersedes “still show as Okay → customize/drop.” |

**Customize → LLM differentiation coach (chat)** stays **parked**. **§14** puts a **differentiate line** on every shown card (never “sell as-is”) instead of listing Ishtari dumps.

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
- Okay risk-ack remains on otherwise accept-ready cards that **still list**. High Tier-1 + cheap local clutter is **not listed** when §14 hide-dump applies.

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
| **Product name locale** | `productName` in the Gemini payload is the **same display name as the card** for the active UI locale: pool `nameAr` when non-empty in Arabic, otherwise `nameEn` (never invent Arabic). Gemini must quote that exact string; do not translate the name into another script. |
| **Arabic founder labels** | In Arabic UI prose, operational score is **الملاءمة** (e.g. الملاءمة 78/100) and recommendation strength is **مقبول** / **قوي** — never English “Fit” / “Okay” / “Strong” as labels. Skills still use typed `Okay`/`Strong` internally; JSON may include localized `fitLabel` / `strengthLabel` for the model to copy. English UI keeps Fit / Okay / Strong. |
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
| **Winner** | Deterministic skills ranking **among selected only** (Wave 2 composite when present, else Fit; stable ties by session rank / id). Expose advised `candidateId` + `catalogKey`. **Gemini does not override.** The advised badge always comes from `pickCompareWinner` — never parsed from the prose. |
| **Rival promotion is a rejected body** | Advice wording (“skills advise”, “start with”, “test first”, “the stronger / better choice”, plus AR equivalents) must **attach to the advised name**. A brief that nominates a non-advised product — even while merely mentioning the advised one — is **rejected, not displayed**. A rival named as a *contrast* (“advise X over Y”, “a weaker Fit than Y”) stays legal, so the check never crosses another product’s name to claim a match. |
| **One bounded retry** | Same policy as §6.1: a grounding / alignment / length failure earns **exactly one** tightened retry (which names the rivals that must not be promoted). **Never** retry a missing key or a quota / rate-limit response. After the retry, show a **clear failure** rather than a possibly-misleading brief. |
| **Failure copy** | Each failure kind reads distinctly for the founder: the wrong product narrated as advised, wording we could not verify, a brief that came back unfinished, unreachable service, missing key, rate limit, stale selection, feature off. |
| **One selection per brief** | A brief is shown **only** for the exact selection it was generated from. The body is stored with a selection fingerprint (**session + sorted candidateIds + locale**); any mark change, prune, refresh, or new session clears the brief and closes the modal, and a response that lands after the selection moved is **discarded**. |
| **Advised name footprint** | The advised product may be named up to `COMPARE_ADVISED_NAME_MAX_MENTIONS` (3) times across 2–3 cards. The Gemini instruction and the validator read the **same** constant so they cannot drift. Product / advised names follow the **UI locale** (same resolve rule as §6.1 / the card). Arabic briefs use **الملاءمة** / **مقبول** / **قوي** like §6.1 — not English Fit/Okay/Strong labels. |
| **Output** | Modal brief: why the advised product wins vs the other 1–2; short opportunity thesis per product; Fit/budget/margins; differentiation; main uncertainty; recommended sample-first test. Live vs Estimate honesty. Advice only — **Accept remains free choice on any card**. Never “you must accept X.” |
| **Validate the finalized body** | Same reliability contract as §6.1: pack **whole sentences** into the **500–1600** / **4–8 sentence** window (abbreviation-aware split — “U.S.” / “e.g.” are not fake sentence ends); run length, footprint, grounding, and advice-alignment on the **finalized** paragraph, never the raw draft. Only a hard blocklist (jargon, stock lines, estimate-mode market phrases, un-found Tier-1 names) short-circuits before finalize. A trimmed trailing sentence must not fail a valid brief. |
| **Advice survives packing** | Gemini is instructed to nominate the skills winner in the **first** sentence (not only at the end). Finalize prefers keeping an advice-nominating sentence when trimming, and when the packed body still never nominates the advised product **and** never nominates a rival, appends a short **deterministic skills footer** (skills SoT — not a Gemini winner override). Rival-promoting bodies stay rejected. |
| **Error modal shows skills pick** | Compare modal opens on click like §6.1 Why (loading → success or error). On narrate failure after skills pick, the action still returns `advisedName` / `advisedCandidateId` so the modal can show which product skills chose — never parsed from rejected prose. |
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
| **Heuristics never overwrite live** | Heuristic/seed scores are for an **intentionally OFF** live search only. Live **on** but zero queries actually ran (missing key / noop provider) is a **failure**: preserve last-known, status `failed`, error names the missing key — never a seed score written over real live data under status `ok` |
| **Empty evidence never clobbers** | A gather where every leg returned zero items is real but low-confidence: it must **not** overwrite a snapshot that previously scored `ok`. Skip the write, keep last-known, still count it in `emptyEvidenceCount` |
| **Bounded outbound requests** | Every outbound search request carries a **timeout** (`DISCOVERY_SEARCH_REQUEST_TIMEOUT_MS`, 30s) and a **bounded retry** (`DISCOVERY_SEARCH_MAX_ATTEMPTS`). Retry **only** transient 429 / 5xx and timeouts, honour `Retry-After` under a capped backoff ceiling; persistent failure surfaces via `applyFailedScoreRefresh` |
| **Query caps** | Limit queries per product per refresh (abroad + Lebanon + Tier-1 family) |
| **Monthly spend ledger** | Search spend is accounted **per month**, not just per product: a persisted UTC month bucket is checked **before each query batch**. At the cap the run **stops cleanly** — last-known scores preserved, nothing written, clear log, **exit 0**. Cap is env-configurable with a safe default; jobs report `queriesUsed` and remaining allowance |
| **Partial failure is not total failure** | One provider throw must never discard work already done: intake persists the candidates whose queries succeeded and reports the failed ones. Cron exits **non-zero** when any product failed to refresh, and **zero** on a clean quota stop |
| **Downrank before hard hide** | Weak scores sink in ranking; **shortlist never includes** non-accept-ready (hard margin fail / soft_ok / far-below / oversized / demand-fail) |
| **Shadow / feature flags** | Log “would exclude” before enforcing hard filters; flag soft vs hard competition×budget |
| **Dual demand paths** | Whitespace OR local-proven — never require every AND at once |
| **Missing data = neutral** | Incomplete MOQ/sample → don’t exclude. Neutral means **do not exclude**, never **counts as proven** (§3.2) |
| **Neutral demand leg at the gate** | A scored row whose deciding demand leg was neutral-filled **still passes** the system demand gate on score alone (missing data never excludes) — **but** it earns **no** `demandPath`, reports `usedNeutral`, and the card is capped to **Okay** with `low_evidence_confidence` and labelled **estimate-only**. A row with **no usable score at all** stays fail-closed `missing` (unchanged) |
| **Competition×budget** | Rank penalty first; harden later using empty/accept metrics |
| **Score freshness on the card** | Every card states how old its market read is, from the last **successful** read (`lastScoredAt`) — a failed refresh keeps last-known scores, so the data is as old as the read that produced it. **DISPLAY ONLY:** freshness never changes rank, strength, or an accept gate. Age **≥** `DISCOVERY_SCORE_STALE_AFTER_DAYS` (default **30** via `DISCOVERY_SCORE_STALE_AFTER_DAYS_DEFAULT`) says so plainly; a never-measured or undatable read fails closed to **estimate only**, in the same voice as §6.1. 16 days is not stale at the default window. |
| **Undo reject** | A reject is recoverable for a short window so a mis-tap does not shrink the founder's world: the last `DISCOVERY_UNDO_REJECT_MAX` rejects of the **active** session, inside `DISCOVERY_UNDO_REJECT_WINDOW_MS`, restored to the current shortlist. Undo **never** bumps the exhausted-round ladder and never counts a second round (the session's `exhaustionCounted` flag already caps it at one). Accept-readiness is re-checked against **current** scores through the same resolver the page filters with — a card the gates moved against is **explained, not silently restored**. An **accepted** product is refused with its own reason: undo may never walk back a Human Approval or a created SKU. Legacy rejects carry no stamp and are never undoable. Refresh suggestions / new session empties the affordance |
| **Accept-ready shortlist** | List **only** products Accept would not block on margins / oversized / system demand. **No** soft-margin fill of non-accept cards |
| **Edit onboarding** | When 0 (or below usable threshold) accept-ready products for this profile — empty shortlist + Edit onboarding note (see §8). Never strand on a page of blocked cards. **Unless the board is empty because scores are missing or failed**, which is a data outage and shows the market-data-not-ready state instead (§8) |
| **Paste demand confirm** | **REMOVED** — accept uses system skill gates only (demand/competition/Fit/hard-margin/Tier-1/oversized); no founder paste |
| **No LLM/MCP in pass/fail** | Skills score; Gemini **never** sets 70/35%, demand gate, Fit pass/fail, or compare winner. **§14:** Gemini may **only reorder ids inside a skills-retrieved set** (invalid id dropped). Why + Compare briefs unchanged (§6.1 / §6.2). MCP optional wrapper later |
| **Measure** | Empty rate, accept rate, edit-onboarding rate — tune thresholds from data (see §7.1) |

**Never strand the founder:** when the pool has only weak / non-accept-ready products, show an **empty shortlist + Edit onboarding** — not soft-listed blocked cards.

### 7.1 Measurement loop (**LOCKED**)

Thresholds are tuned from data, so the funnel is counted. Measuring the funnel may **never** change the funnel.

| Rule | Detail |
| --- | --- |
| **Counters** | `shortlist_shown`, `shortlist_empty`, `shortlist_empty_no_scores`, `accept`, `reject`, `edit_onboarding_shown`, `why_explain_opened`, `compare_run`, plus `explain_failed` / `compare_failed` **by typed error code** |
| **Data outage is its own empty** | `shortlist_empty_no_scores` is recorded **beside** `shortlist_empty`, never instead of it, so sessions viewed is unchanged. It carries its own per-session key and **no** `edit_onboarding_shown`, which keeps the edit-onboarding rate a measure of profile-driven nags only (§8) |
| **Append-only** | Rows are inserted, never updated. Nothing here is read by scoring, ranking, strength, or an accept gate in this pass — a human reads the numbers and changes thresholds deliberately |
| **Counted once** | Every event carries a `dedupe_key` from its natural identity (session, candidate, or compare selection) behind a unique index, so a re-render, a revalidate, or a retried request records **one** event. The two shortlist outcomes **share one key**: a session either opened with something to show or it did not, which keeps `shortlist_shown + shortlist_empty` equal to sessions viewed |
| **Rates** | `empty rate` = empty ÷ sessions viewed · `no-scores empty rate` = data-outage empties ÷ sessions viewed · `accept rate` = accepts ÷ (accepts + rejects) · `edit-onboarding rate` = banner shown ÷ sessions viewed. An empty denominator reports **no data**, never 0% |
| **Never blocks a founder** | A metrics write that fails is swallowed — measurement is not worth failing an accept, a reject, or a page render for |
| **No new PII** | Existing workspace / session / candidate identifiers and typed error codes only. Never founder text, paste, or Gemini output. Workspace-scoped, so the rows are wiped with the workspace |
| **Read path** | Ops CLI only (`npm run discovery:metrics [-- --days=N] [-- --json]`) — no founder-facing analytics UI in this pass |

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
| **Empty board because scores are missing or failed** | The founder cannot fix our pipeline by rewriting their profile. When the dominant blocker across the eligible pool is gate status `missing` (`score_cache_missing` / `score_refresh_failed`), show the **market-data-not-ready** state *instead of* the banner and the profile-edit suggestions: calm, explicitly not their fault, resolves when scores refresh, with the ops next step named and no key values or raw provider errors. A **tie** between data and profile blockers reads as **data** — under-nagging is recoverable, blaming a founder for our outage is not. Counted as `shortlist_empty_no_scores`, **never** `edit_onboarding_shown` (§7.1) |
| Every Okay / Tier-1 customize | Product strategy, not profile edit |
| A reject the founder can still undo | A mis-tap is not an exhausted profile — offer **Undo reject** (§7) beside the ladder, and never let undo bump an exhausted round |

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
Discovery agent: filter/rank → retrieve set
        ↓
§14 UI (when DISCOVERY_AGENT_UI on): ask cards → photo grid → basket → Proceed / Compare / Explore more
        ↓
Founder: Proceed = existing accept; Compare = existing §6.2 (skills pick winner)
        ↓
(After accept — Wave 1, unchanged)
Supplier agent: 3+2 options, sample-first, …
```

| Layer | Responsibility |
| --- | --- |
| **Path 1 intake API** | Find live-ish **winning product** candidates; write pool (not brand DB) |
| **Scoring API** | Fetch public web evidence for demand/competition on pool rows |
| **Skills** | Deterministic (or rule-based) scoring — unit-testable; source of pass/rank truth |
| **Discovery agent** | Orchestrates retrieve + §14 UI; does **not** bypass Human Approvals on accept |
| **MCP** | Optional later tool wrapper around the **same** API clients — not required for Approach A |
| **LLM** | **Required** §6.1 Why + §6.2 compare briefs; **§14** id-reorder inside retrieved set only — **not** pass/fail, **not** compare winner |
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
- Search / shopping provider key(s) — document in `.env.example` as commented placeholders
  - `DISCOVERY_SEARCH_VENDOR` = `serpapi` (default) | `brave` | `serper` — picks the vendor for the **scoring** legs
  - `SERPAPI_API_KEY` / `SEARCH_API_KEY` — SerpAPI
  - `BRAVE_SEARCH_API_KEY` — Brave, **scoring legs only**: Brave web search returns title/url/snippet but no shopping price/merchant, so **Path 1 intake stays on SerpAPI** whatever the vendor
  - `SERPER_API_KEY` — Serper.dev, **scoring legs only** (same Path 1 rule): Google organic title/link/snippet; free trial is one-time (~2,500 queries), not a monthly refill — keep `DISCOVERY_SEARCH_MONTHLY_QUERY_CAP` tight (suggested `400`)
  - `DISCOVERY_SEARCH_MONTHLY_QUERY_CAP` — monthly ledger cap (safe default `DISCOVERY_SEARCH_MONTHLY_QUERY_CAP_DEFAULT`)
- `DISCOVERY_SCORE_STALE_AFTER_DAYS` — days before a card's market read reads as out of date (§7; default **30** via `DISCOVERY_SCORE_STALE_AFTER_DAYS_DEFAULT`). **Display only** — never a gate. Malformed / ≤0 fall back to 30.
- **Required for suggestion copy:** `GEMINI_API_KEY` or `DISCOVERY_EXPLAIN_GEMINI_API_KEY` (never commit secrets)
- `DISCOVERY_AGENT_UI` — §14 board (default **off**). `1`/`true` **replaces** the 5-card board (never both). Hide-dump only when `DISCOVERY_POOL_V2` + usable scores.
- Optional later: dropship catalog API key as backup intake

All scoring vendors implement the same `DiscoverySearchProvider`, and `getDiscoverySearchProvider()` in `src/lib/discovery/search-provider.ts` stays the **only** production bind point — jobs receive a provider, they never construct one. Swapping vendor is an env change, not a code change.

### 10.3 Session vs pool resync (implementation)

Approach A jobs update the **global** pool/score tables. They still **must not** live-search on Discovery GET.

**When `DISCOVERY_AGENT_UI` is off:** an active session still **freezes** the shortlist at start (reject / show-more / seen-key unchanged). **Refresh suggestions** (POOL_V2): close session → re-rank → new session. Workspace-seen keys stay excluded. Refresh does not bump exhausted rounds.

**When `DISCOVERY_AGENT_UI` is on (§14):** the session **keeps** frame chips, basket, explore count, and shown-id memory. **Explore more** pulls **new** retrieve ids (not in shown/rejected/basket) **without** closing the session — this **unlocks** freeze-at-start for the **visible grid only**. **Refresh suggestions** remains **start over** (new session, clears basket/chips/count). **Show more** is **not** on this surface.

---

## 11) Explicit non-goals (this Discovery lock)

- Founder Consultant **messenger / ChatGPT thread** (OS question cards in §14 are not this)
- Shopify Admin sync  
- Meta / TikTok ads pull into Topic A  
- Courier / COD network APIs  
- Commercial Ishtari/EGLOW/Platza partner integrations  
- Official Alibaba / Accio as required upstream  
- Brand-directory or brand-first Discovery  
- Pre-attaching full supplier shortlists on Discovery cards (Supplier stays post-accept)  
- Requiring MCP for core shortlist scoring  
- Using Gulf as primary abroad signal  
- Ditching Path 1 / score jobs so the model “knows” the Lebanese market  
- Live-search or Serper on Explore more / page load  
- Inventing catalogKeys not in the retrieved set  
- Relying on Cursor-only MCP/browser as the live product feed for end users  
- Using LLM as Fit / demand / competition / pass-fail scorer or compare winner  
- Treating Why / Compare as Consultant chat  
- Requiring founder paste demand confirm for Discovery accept  
- Rewriting Marketing, Supplier, Store, Topic A/B, or journey FSM in this slice  

---

## 12) Lock changelog

| Date | Change |
| --- | --- |
| 2026-08-20 | **§14.12 Edit onboarding dry-run + min delta + preview names + return to same frame LOCKED** — name a field only when a one-knob dry-run proves ≥1 extra accept-ready id in **this** agent frame; never advise `monthlyFollowOnBudget`, `storageDescription`/`storageLimits`, or `categoryLikes`; extra ids === 0 hides the banner (nothing-fits / empty-catalog honesty instead); after save from Discovery keep the session chips / `agentFrameJson` and retrieve again, do not dump on `/dashboard`. |
| 2026-08-20 | **Score freshness default window 7 → 30 days** (§7 / §10.2) — **DISPLAY ONLY**; out-of-date note when age **≥ 30**. Env `DISCOVERY_SCORE_STALE_AFTER_DAYS` still overrides; malformed / ≤0 fall back to 30. Does not change rank, strength, accept gates, or score-job cadence. |
| 2026-08-20 | **§14.11 Frame-aware retrieve + differ required + tile receipts LOCKED** — retrieve uses the session frame (not industry-only) inside the same accept-ready set; cheap storage is a hard drop; audience / differ / unmapped Other / explore whyNote are boost-only and never empty the list; differ has no Skip on first ask (must pick demo \| bundle \| niche); Skip remains on skip/refuse and audience unless narrowing; agent tiles show compact receipts (live vs estimate, score age, Fit + margins) with Why (i) and chips above the grid; Gemini id-reorder still optional / not required; Edit onboarding dry-run is **not** this lock. Skills/jobs still own 70/35%, demand, Fit, and compare winner. |
| 2026-08-19 | **§14 Discovery agent UI LOCKED** — OS wizard + photo grid + click-basket (not ChatGPT); Explore more ≠ Refresh ≠ Show more; same-session new ids (unlock freeze for grid only); hide-dump when pool+scores; Other maps to 10 industries or none; intro card; Gemini id-reorder only; Proceed/Compare reuse accept + §6.2; Path 1/score jobs stay; Marketing/Supplier/Store/Topic A/B/hub FSM not rewritten. Flag `DISCOVERY_AGENT_UI` default off. Build: three PRs in §14.8. |
| 2026-08-02 | Initial Wave 2 doc: Discovery agent listing + sources + engineering + risk tricks **LOCKED** |
| 2026-08-03 | **Path 1** product pool intake **LOCKED** (search/shopping API; no Alibaba official; winning products not brands; catalog.ts seed/fallback; Supplier remains post-accept) |
| 2026-08-03 | Card **“Why this pick?”** explain **LOCKED** (§6.1): demand-summary-sized paragraph from skill payloads only; optional LLM; never pass/fail |
| 2026-08-04 | **Paste demand confirm REMOVED**; accept = system skill gates only; §6.1 **required Gemini** “Why we suggested this” (market + competition); no LLM in pass/fail |
| 2026-08-04 | **Shortlist = accept-ready only** — supersedes soft-margin listing band + soft-margin fallback fill; 0 accept-ready → empty + Edit onboarding (§5.2 / §7 / §8) |
| 2026-08-05 | §6.1 **grounded market evidence** — jobs persist bounded live-search facts; Gemini may cite concrete market specifics only from those facts; heuristic/neutral copy is explicitly estimate-only |
| 2026-08-05 | §6.1 body expanded to **4–6 complete sentences (~900–1100 chars; 800-char validator tolerance / 1100 hard max)**; yellow Okay note and Gemini now share one typed reason and reason-matched mitigation; opportunity thesis follows grounded evidence → Fit/budget → economics → differentiation → uncertainty → test; cache bumped to `v7-confidence-thesis-900-1100` |
| 2026-08-05 | §6.2 **Worth considering compare (max 3)** **LOCKED** — skills pick among marks; Gemini explains advice only; Accept remains free choice; compare cache `v1-worth-considering-compare` |
| 2026-08-07 | §6.1 **Explain reliability + single-source Okay reason** **LOCKED** — validators run on the **finalized** body (a trimmed 7th sentence no longer fails a valid answer; only a hard blocklist pre-checks the raw draft); paragraph is packed from **whole sentences** inside 800–1100 and abbreviations like “U.S.” no longer split into fake sentences; **exactly one** tightened retry on validation / grounding / alignment failure and **never** on missing key or rate limit; card note and Gemini payload share one resolver so they can never state two reasons; runtime guard keeps Okay scare wording off **Strong**; distinct EN + AR copy per failure kind; cache bumped to `v8-single-reason-retry` |
| 2026-08-07 | §6.2 **Compare integrity** **LOCKED** — advice wording must **attach to the skills-advised name**; prose nominating a rival (“start with X”, “test X first”, “X is the stronger choice”, AR equivalents) is a **rejected body**, while a rival named as a contrast stays legal; **exactly one** tightened retry shared with §6.1 (never on missing key or rate limit), then a clear failure instead of a possibly-misleading brief; a brief renders **only** for the selection fingerprint (session + sorted marks + locale) it was generated from, so mark changes / prune / refresh clear it and close the modal and a late response is discarded; advised-name mention cap shared by prompt and validator; distinct EN + AR copy per compare failure kind |
| 2026-08-07 | **Job / provider resilience + monthly quota ledger** **LOCKED** (§7 / §9 / §10): heuristic scores may **never** overwrite last-known live scores — live enabled with zero queries actually run is a **failure** naming the missing key, and an all-empty gather no longer clobbers a snapshot that previously scored `ok`; every outbound search request carries a **30s timeout** and a **bounded retry** on transient 429 / 5xx and timeouts honouring `Retry-After` under a capped backoff; a persisted **monthly search ledger** (UTC month bucket) is checked **before each query batch** so a run stops cleanly at the cap with last-known scores intact and **exit 0**, while jobs report `queriesUsed` and remaining allowance; Path 1 intake persists candidates from queries that succeeded instead of discarding them on one provider throw; `--limit` is **rejected** for `intake` (it only bounds score/refresh) and score exits **non-zero** whenever any product failed so cron alerts; **Brave Search** added behind the same `DiscoverySearchProvider` so the scoring vendor is swappable by `DISCOVERY_SEARCH_VENDOR` alone, with Path 1 intake staying on SerpAPI because shopping intake needs price/merchant |
| 2026-08-07 | **Score freshness + undo reject + measurement loop** **LOCKED** (§7 / §7.1 / §8 / §10.2): every card states how old its market read is, dated from the last **successful** read so a failed refresh still reports the true age of the last-known scores — **display only**, never rank / strength / accept, with a configurable staleness window (`DISCOVERY_SCORE_STALE_AFTER_DAYS`) and a never-measured read failing closed to the §6.1 **estimate-only** voice; **reject is recoverable** for a short window (last `DISCOVERY_UNDO_REJECT_MAX` rejects of the active session inside `DISCOVERY_UNDO_REJECT_WINDOW_MS`) with accept-readiness re-checked against **current** scores through the same resolver the page filters with, so a card the gates moved against is **explained rather than silently restored**, an **accepted** product is refused with its own reason (undo may never walk back a Human Approval or an SKU), legacy unstamped rejects are never undoable, and undo **never** bumps or double-counts the exhausted-round ladder; §7 **"Measure" implemented** as an **append-only** counter table (shortlist shown / empty, accept, reject, edit-onboarding shown, why-explain opened, compare run, explain + compare failures **by typed error code**) deduped by a unique natural-identity key so re-renders, revalidates, and retries count **once**, with empty / accept / edit-onboarding rates over a window read by an ops CLI (`npm run discovery:metrics`), no founder-facing analytics UI, no new PII, and **no metric feeding scoring, rank, or gates in this pass** |
| 2026-08-07 | **Tavily as a third search vendor (scoring legs)** — superseded the same day by Serper (Lebanon signup blocked on Tavily) |
| 2026-08-07 | **Serper as the third search vendor (scoring legs)** **LOCKED** (§9 / §10): `DISCOVERY_SEARCH_VENDOR=serper` with `SERPER_API_KEY` joins SerpAPI and Brave behind the same `DiscoverySearchProvider` seam — `getDiscoverySearchProvider()` remains the **only** production bind point, Approach A is unchanged (page loads / server actions never live-search), and Path 1 intake still requires shopping price/merchant so it **stays on SerpAPI** (a Serper-only setup reports `scoring: "serper"`, `intake: "noop"` rather than a broken intake call; if Serper is somehow asked for `path1_intake` it fails closed). Contract verified against Serper OpenAPI: `X-API-KEY` header, `POST https://google.serper.dev/search`, body `q` / `gl` / `hl` / `num`, `organic[].title` / `link` → url / `snippet`, site restrict via `site:` embedded in `q` (no dedicated domain field), `gl=lb` for lebanon_demand + local_competition and `gl=us` for abroad_demand + tier1_competition with `hl=en`, and `queriesUsed: 1` per successful search. Free trial is **one-time** (~2,500), not a monthly refill — keep the monthly ledger cap tight. Tavily is unwired and removed from the tree |
| 2026-08-07 | **Empty-because-no-data is not an onboarding problem** **LOCKED** (§8 / §7.1): an empty shortlist now names its cause. When the dominant blocker across the eligible pool is a **missing or failed score** (gate status `missing` — `score_cache_missing` / `score_refresh_failed`), Discovery shows a calm **market-data-not-ready** state that says plainly it is not the founder's profile, distinguishes never-measured from a refresh that failed, and names the ops next step without leaking key values or raw provider errors — and it shows **neither** the Edit onboarding banner **nor** the profile-edit suggestions. Genuine profile filtering (margins / Fit / budget / oversized / demand scored-but-too-weak) keeps `zero_accept_ready` exactly as before, and a **tie** between the two blocker kinds reads as a data outage rather than as the founder's fault. The blocker reason is traced through `rankWave2Shortlist` and `countRemainingEligible` so the pool scan can no longer read as "your profile filtered everything out". §7.1 gains `shortlist_empty_no_scores`, recorded **beside** `shortlist_empty` under its own per-session key and **never** as `edit_onboarding_shown`, so the edit-onboarding rate measures profile-driven nags only. **Messaging and metrics only** — the fail-closed demand gate, confidence floors, heuristic fallback rule, accept gates, and rank are unchanged |
| 2026-08-07 | **Truthful demand + confidence floors** **LOCKED** (§3.2 / §6 / §7): “missing data = neutral” means *do not exclude*, never *counts as proven*; a qualified `whitespace` / `local_proven` label requires real evidence on every leg it claims (local-proven strictly above neutral), else `demandPath = null` and founder copy reads **estimate only**; unknown confidence floors to `HEURISTIC_SEED_CONFIDENCE` and the Okay cap boundary is inclusive, so never-scored products cannot read **Strong**; neutral deciding leg **passes** the demand gate but is capped Okay with `low_evidence_confidence` |
| 2026-08-08 | §6.2 **Compare reliability parity with §6.1** **LOCKED** — finalize packs **whole sentences** into 500–1600 / 4–8 (shared abbreviation-aware `splitSuggestionSentences` / `packSuggestionSentences`); grounding and advice-alignment run on the **finalized** body; only a hard blocklist pre-checks the raw draft; cache bumped to `v2-compare-pack-finalize`. Skills winner / rival-promotion reject / one bounded retry unchanged |
| 2026-08-08 | §6.1 / §6.2 **Vague-fluff false positives** — “worth considering” fluff is **filler verdict only** (`is/are/… worth considering`), so §6.2 mark-feature phrasing stays legal; “Strong Fit …” strength-label reporting is not treated as “a good/strong fit” filler |
| 2026-08-08 | §6.2 **Advice survives packing + error modal skills pick** **LOCKED** — first-sentence nomination in the Gemini prompt; finalize prefers keeping an advice-nominating sentence and may append a deterministic skills footer when the packed body never nominates the advised product and never nominates a rival; rival-promoting bodies stay rejected; failed compare actions return skills `advisedName` so the portal shows the pick on error; cache bumped to `v3-compare-advice-footer` |
| 2026-08-08 | §6.1 / §6.2 **Locale-matched product names** **LOCKED** — Why + Compare payload `productName` / `advisedName` resolve from pool like the card (`nameAr` when non-empty in Arabic, else `nameEn`); Gemini must quote that exact UI-language string and must not translate the name; Why cache `v9-locale-product-name`, Compare cache `v4-locale-product-name` |
| 2026-08-08 | §6.1 / §6.2 **Arabic founder labels** **LOCKED** — AR Why/Compare prose uses **الملاءمة** / **مقبول** / **قوي** (not English Fit/Okay/Strong labels); facts JSON carries localized `fitLabel`/`strengthLabel`; sentence split accepts Arabic `؟`; Why cache `v10-ar-founder-labels`, Compare cache `v5-ar-founder-labels` (label ban later softened — see AR example length + rewrite) |
| 2026-08-08 | §6.1 / §6.2 **AR example length + label rewrite** — AR GOOD prompt examples must meet locked min chars (Why ≥800, Compare ≥500); clear English Fit/Okay/Strong slips are rewritten to Arabic labels before finalize (residual mismatch → `okay_mismatch` retry, not false `incomplete`); Why cache `v11-ar-example-length`, Compare cache `v6-ar-example-length` |
| 2026-08-08 | §6.1 **AR Strong vs Okay GOOD examples** **LOCKED** — AR system prompt branches on `strengthLabel`: مقبول cards keep Okay GOOD examples; قوي cards get Strong GOOD examples (`التوصية قوية`, no مقبول verdict) so Gemini does not copy Okay scare onto Strong → `okay_mismatch`; Why cache `v12-ar-strong-examples` |
| 2026-08-09 | **Discovery photo / thumbnail gallery PARKED** — **multi-photo modal** still parked. **§14** unlocks **one** pool image URL (or placeholder) per suggestion; no scrape/gen in this slice. |
| 2026-08-11 | **Demo restore Discovery** (ops / recruiter, not a Discovery lock change): `DEMO_RESET` Settings control now wipe-then-seeds invent/catalog shortlist (5 visible → Show more → 25). No Serper/SerpAPI. Wipe-to-empty remains dev-only. |

---

## 14) Discovery agent UI (**LOCKED 2026-08-19**)

Bounded agent: **OS chrome** (intro → one question card → photo grid → basket). **Not** a ChatGPT transcript. Skills/jobs remain SoT for 70/35%, demand, Lebanon competition, Fit. Gemini does not invent SKUs.

**Out of slice:** Marketing kits, Supplier 3+2, Store checklist/packs, Topic A, Topic B shape, shop-hub routing / Next chips, Shopify, journey FSM. Proceed = existing `acceptProductAction`.

### 14.1 Collisions Build must not guess (**required**)

| Collision | Lock |
| --- | --- |
| **Explore more vs freeze** | Visible grid may change inside the **same** session. Persist `shownCatalogKeys[]`, basket, frame, `exploreMoreCount`. Do **not** implement Explore more as Refresh. |
| **One UI** | `DISCOVERY_AGENT_UI=1` **replaces** the 5-card board. Flag **off** = current board (tests keep passing during PRs). Never both on one page. |
| **Three “more” controls** | **Explore more** = next **unseen** retrieve batch (replace grid; keep basket). **Refresh** = start over (new session; clear basket/chips/count). **Show more** = **hidden** when agent UI on. |
| **Hide-dump needs scores** | High competition (`COMPETITION_HIGH_MIN`) **and** Tier-1 (pool `tier1Marketplaces` or live evidence names Ishtari/EGLOW/Platza) → **not retrieved**. Rank remaining toward **whitespace**. If `DISCOVERY_POOL_V2` off or scores missing → **no hide-dump**; use existing empty / catalog / market-data-not-ready — do **not** fake an Ishtari filter. |
| **Build order** | §14.8 three PRs. Do not land ask+explore+hide in one PR. |

### 14.2 Flow

```text
first Discovery this profile → intro card (once) → persist discoveryIntroSeen
  → ask (fixed questions, chips)
  → retrieve → grid
  → click basket (max 3; drag optional, same state)
       1 in basket → Proceed with this product
       2–3 → Compare (then Proceed on one)
  → Explore more → why chips (not_convinced | keep_looking)
       not_convinced → narrowing ask, then retrieve
       keep_looking → new ids if exploreMoreCount < 5
       6th Explore more → narrowing ask first
```

Reject/undo may remain as fail-closed on cards if needed; **primary** path is basket + Proceed, not a Reject-first board.

### 14.3 Intro (fixed EN/AR, not Gemini)

First visit only. Lists the **10** `INDUSTRY_OPTIONS` labels. Other must map to one; if it cannot, we cannot help. Example of **none** in copy: **used cars** or **a bakery** — **not** paintings (paintings map to Home & kitchen). Next → ask.

### 14.4 Ask / Other / narrowing

- **Want to sell:** same 10 industry chips (pre-check onboarding likes) + **Other** (short text, ~80 chars). Multi-select industries allowed.
- Other → **keyword classifier** (code fixtures, not Gemini): `industry` | `none` | `unmapped`.  
  - **Map:** `paintings`, canvas prints, diamond-painting kits → `home_kitchen` (then retrieve; empty if nothing accept-ready).  
  - **`none`:** used cars / dealership, bakery / cooked food, sofas / full furniture, wedding dresses / bulky apparel, renting apartments.  
  - **`unmapped` + at least one industry chip:** Other is **rank hint only**; retrieve those chips.  
  - **`unmapped` or `none` with Other as the only selection:** **don’t-deal** — no invented grid, no silent remap to bins.  
  - **Zero rows** after a real map: same don’t-deal / nothing-fits honesty.
- Other questions (one card each): skip/refuse (e.g. cheap storage), who it’s for, how they want to differ (demo/bundle/niche — not cheaper). Skip remains on skip/refuse and audience (unless narrowing). **Differ has no Skip** — Next/select requires demo \| bundle \| niche.
- Narrowing uses the **same** cards; answers **overwrite** session fields; then retrieve again.
- Answers render as **chips** above the grid, not a transcript.

### 14.5 Grid, (i), differentiate, photos

- Each suggestion: **one** photo (pool URL or placeholder — **no** scrape/gen), **name**, **(i)** → existing §6.1 Why popup, **one differentiate line** (never “sell as-is” / undercut Ishtari on price). Blocklist those phrases on Why + differ + any Gemini id-pick copy.
- **Receipts (compact, on the tile):** Fit score, margin before/after (existing candidate fields), score age (`ScoreFreshnessNote`), live vs estimate (existing honesty keys). Why (i) stays. Chips stay above the grid. No scrape, no generate-all.
- Gemini **optional** reorder of retrieved ids; every id must be in the retrieve set or **drop**. Gemini miss → **skill order** of the retrieve set. Empty retrieve → honesty (don’t-deal / Edit onboarding / market-data-not-ready per existing cause rules — **one** banner, §14.7). Gemini id-reorder is still optional / **not required** for §14.11.

### 14.6 Basket / Compare / Proceed

- Click add/remove. Max **3**. 4th refused with existing compare max copy.
- Basket **replaces** worth-considering **checkboxes** when agent UI on. Same max; **same** `pickCompareWinner` + §6.2 brief. Do not keep two mark systems.
- Refresh clears basket (new session). Explore more **does not**.

### 14.7 Empty-state precedence (one banner)

1. Scores missing/failed → **market-data-not-ready**  
2. Other classifier `none` **or** mapped industry with 0 retrieve (including hide-dump or cheap-storage emptied the aisle) → **don’t deal / nothing fits this frame** (not Edit onboarding unless profile Fit/budget is the traced blocker)  
3. Profile 0 accept-ready → existing Edit onboarding  
4. Else grid  

Do not show Edit onboarding for “I typed bakery.”

### 14.8 Build slices (required order)

1. **PR1:** hide-dump (when scores exist) + click-basket + photo/name/(i) + differ line on **current** retrieve; Proceed/Compare wired to existing actions; flag still off or PR1 behind flag showing new **grid only** if cheaper — prefer flag-gated **replace of the result list** without ask yet. Tests: no dump ids when high+Tier-1; 1 vs 2+ button; max 3.  
2. **PR2:** intro + ask + Other classifier fixtures (paintings vs bakery/cars) + chips + persist. Tests: `none` → no ids; paintings → `home_kitchen` retrieve.  
3. **PR3:** Explore more (new ids, same session, counter) + why chips + narrowing at not_convinced or 6th explore. Tests: Explore more does not call session-close/Refresh; shown keys excluded; 6th blocked until narrowing fields written.

### 14.9 KB / frame (no vector DB)

**Frame:** onboarding + session fields + doctrine (10 industries, Other map-or-none, never as-is, always differ, ids ⊂ retrieve, 70/35% and oversized are gates, estimate-only without live evidence).  
**KB:** pool row, scores (demand/competition/Fit/margins), capped evidence, shown/rejected/basket ids.  
**Not in KB:** live Serper, Meta Ads, Topic A spend, WAVE-2.md as RAG, other founders’ chats.

### 14.10 Tests Build must add

- Explore more does not create a new Discovery session id  
- Refresh does  
- Id not in retrieve set is not rendered  
- Why/differ containing sell-as-is / guaranteed sales → reject  
- Classifier fixtures in §14.4  
- Empty precedence in §14.7  
- Compare still `pickCompareWinner`, never from prose  

### 14.11 Frame-aware retrieve + differ required + tile receipts (**LOCKED 2026-08-20**)

The ask is not theater. After the founder answers, retrieve must use those answers **inside the same accept-ready set**. No invented products. `DISCOVERY_AGENT_UI` off → old board unchanged.

Skills/jobs still own 70/35%, demand, Fit, and compare winner. Gemini does **not** invent SKUs, does **not** pick the compare winner, and does **not** invent money advice.

**Retrieve** starts from `scoreRankForDiscovery` + existing `restrictCategories` (industry / mapped Other / don’t-deal), then:

| Rule | Effect |
| --- | --- |
| **Cheap storage** (`skipRefuse === "cheap_storage"`) | **Hard drop** when `storageFootprint` is `medium` or `large`, **or** name/summary (en+ar, case-insensitive) hits: container, organizer, storage, cable clip, lunch set, علب, منظّم, تخزين. Do **not** drop all `home_kitchen`. Empty after this drop → `agentNothingFits`, **not** Edit onboarding. |
| **Audience** (if not skipped) | **Boost only**, never drop. myself: beauty_personal_care, fitness_lifestyle, health_wellness_gadgets, phone_tech_accessories + routine/desk/self. gifts: gift/gifting/packaging/monogram/هدية + kids_baby_accessories, fashion_accessories. households: home_kitchen, kids_baby_accessories, pet_accessories, car_accessories + home/apartment/family. creators: phone_tech_accessories, office_desk_gadgets + creator/reel/influencer/demo/content/مبدع. Stable sort: boosted first, keep relative order within each group. |
| **Differ** (always a chip after this lock) | **Boost only.** demo: demo, reel, before/after, clip, video, فيديو. bundle: bundle, kit, set, pack, included, طقم. niche: Arabic, local, Ramadan, niche, co-brand, عربي. If nothing matches, keep skill order. Card differ line still uses `safeDifferentiateLine` (never sell-as-is). |
| **Unmapped Other text** and explore **whyNote** | Same boost as keyword-in-name/summary/differentiation inside the current industry set. No match → ignore. Do **not** create a new category. |

Skip audience / skip refuse = no extra rule. `whyExplore === "keep_looking"` does **not** rescore the interview; it only pages unseen ids. `not_convinced` overwrites then retrieve again using these rules.

**Differ Skip:** `AskDifferCard` never renders Skip. Next/select requires demo \| bundle \| niche. Server `applyDifferAnswer` rejects `skipped` **always** (not only when narrowing). First-ask audience + skipRefuse still allow `skipped` when not narrowing.

**Out of this lock:** Shopify. Marketing. Gemini reorder. New ask questions. Vector DB. Edit onboarding dry-run is §14.12.

### 14.12 Edit onboarding dry-run + return to same frame (**LOCKED 2026-08-20**)

Edit onboarding only when the cause is **profile** (0 accept-ready, or visible+remaining < `DISCOVERY_FALLBACK_SHORTLIST_MIN` = 5). Never for don’t-deal, no-scores, or nothing-fits (hide-dump / cheap-storage / exhausted frame). §14.7 / §8 gating in `getDiscoveryView` stays; the agent UI still suppresses the nag for dontDeal / no_scores / `agentNothingFits`. Only `profile_filtered` (and thin) may show the note — and only after a dry-run.

**Dry-run (pure):** for the current frame + onboarding, try **one knob at a time**, smallest step, same 70/35% / demand / oversized / hide-dump. Pick the knob that unlocks the most extra ids (tie = earlier):

1. `maxLandedCost` — minimum value that unlocks ≥1 (clamped; not unbounded)
2. `hoursPerWeek` — next step toward the `timeNeed` of blocked rows (max 168)
3. `riskTolerance` — next rank low→medium→high
4. `experience` — next rank beginner→some→experienced (last resort)

If extra ids === 0 for all knobs → **do not show** Edit onboarding. Show existing nothing-fits / empty-catalog honesty instead (add industry chip / Explore more / Refresh). Do not invent SKUs.

**Forbidden advice:** `monthlyFollowOnBudget` (can worsen after-ads margin), storage free text (Fit does not use it), `categoryLikes` (agent aisle is ask industries, not likes). Never “lower the margin gates.”

**Paragraph (EN+AR templates, not free Gemini):** 0 vs thin count; named field + target value; preview product **names** of the dry-run extras (max ~3); honesty that listing is still ≥70%/≥35% and shippable — may, not will; not a sales guarantee; CTA `/onboarding?edit=1&from=discovery`. Gemini may only narrate those keys; fail-closed to templates.

**After save:** if `from=discovery` and this is **not** first completion, keep the Discovery session and `agentFrameJson` (do not close / do not clear chips), retrieve with the new profile, redirect to the Discovery surface (`/dashboard?unlock=<field>#discovery` or hub/add-SKU equivalent). Banner line: updated because of [field]. Stay-put on `#discovery` — do not jump to ETA / `#finance`. First onboarding completion still lands on `/dashboard`.

---

## 13) Related Wave 1 references

- Fit: `src/lib/skills/fit.ts`
- Margin: `src/lib/skills/margin.ts`
- Catalog seed + `DemandProvider` seam: `src/lib/discovery/catalog.ts` (seed/fallback until Path 1 pool is SoT)
- Discovery ladder / edit-onboarding suggestions: `src/lib/discovery/ladder.ts`
- Empty-shortlist cause — data outage vs profile filtering (§8): `src/lib/discovery/empty-state.ts`
- §14 hide-dump + Other classifier (fixtures): `src/lib/discovery/agent/`
- §14.11 frame-aware retrieve: `src/lib/discovery/agent/frame-rank.ts`
- §14.12 Edit onboarding dry-run: `src/lib/discovery/agent/onboarding-unlock.ts`
- Score freshness (§7, display only): `src/lib/discovery/freshness.ts`
- Undo reject (§7): `src/lib/discovery/undo-reject.ts`
- Measurement loop (§7.1): `src/lib/discovery/metrics/` + `scripts/discovery-metrics.ts`
- Product overview: `README.md`
- Early v1 plan (historical; Wave 1 multi-SKU superseded single-active UX): `.cursor/plans/lebanon_ecom_os_v1_4977ab1a.plan.md`
- Wave 3 Supplier (live leads + Gmail): `docs/WAVE-3.md`
- Wave 4 Marketing AI: `docs/WAVE-4.md`
