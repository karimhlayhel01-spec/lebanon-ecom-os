# Lebanon Ecom OS — Wave 4 (Marketing AI)

Product and engineering locks for **Wave 4**.  
**Wave 1** (multi-SKU hub, stage-aware Marketing FSM, Postgres, fail-closed `skuId`) remains the live baseline.  
**Wave 2** (Discovery) and **Wave 3** (Supplier) remain locked — see `docs/WAVE-2.md`, `docs/WAVE-3.md`. Do not reopen those locks here.

**Status:** Wave 4 **Marketing AI** — **LOCKED in intent** (founder discussion 2026-08-10). **Phase 1 shipped** (Intro Gemini + literacy + UI harden). **Phase 2 shipped** (Store attractive + discoverability pack). **Phase 3 shipped** (AI creative kits + external AI desk). **Phase 4 parked** (this week’s one post — UI race; revisit later). **Phase 5 shipped** (Nano Banana / Seedance tool suggest + copyable prompts). **Phase 6 parked** (in-app visual gen). **Phase 7 shipped** (Marketing Gemini spend ledger + harden / EN–AR / tests). **Store follow-up shipped** (per-SKU page packs + Marketing-style picker). **Whole-shop Store pack shipped** (≥3 live SKUs).

**Canonical doc:** this file. Do not reopen locks unless the founder explicitly changes one.

---

## 1) Wave 4 positioning (**LOCKED**)

Lebanon Ecom OS Marketing is **AI-native kits**: content tailored per SKU (and whole-shop brand kits when ≥3 live SKUs). Deterministic templates = **fail-closed fallback only**.

**Differentiator:** vs checklist-only ecom OS tools — founders get SKU-specific lesson/creative bodies, not generic “post 3 times a week” advice.

**Founder pain:** Intro / creative copy that ignores the product niche, or tools that force founders to become full-time prompt engineers before they can ship.

---

## 2) Structure (**LOCKED**)

| Rule | Detail |
| --- | --- |
| **Stages stay** | `intro_pdf` → `pre_launch` → `launch` → `weekly_refresh` (formerly `monthly_refresh`; UI: **Weekly refresh**). Do not invent a new Marketing stage for Store SEO. |
| **Additive only** | Extend generate/improve paths and Intro UI. **No Marketing FSM rewrite.** |
| **Calendar** | OS remains SoT for kits / “this week’s one post.” Optional Calendar **export** later — not Calendar API as SoT. |
| **Skills / gates own truth** | Unlocks, capacity tiers, COD-as-wow ban, margin honesty stay in skills/gates. **LLM does not** unlock stages or invent ROAS / money advice. |
| **Approach A** | Generate / improve on **explicit founder click** — not every page load. |
| **In-OS LLM** | **Gemini first** via a `MarketingLlmProvider` seam (name flexible). Claude API later = **provider swap**, not a rewrite. |
| **External AI desk** | Claude / ChatGPT **role prompts** = **Phase 3 shipped** (copyable helpers; not SoT; no auto-fill). Cursor = optional advanced tip, **not** the default marketing manager. |
| **Whole-shop kit** | When ≥3 live SKUs, kit may use `skuId` **null** — brand / multi-SKU only. **Intro AI is per-SKU only** (never whole-shop Intro). |
| **Store pack** | Attractiveness / discoverability / SEO pack = **Store** side surface (roadmap Phase 2) — not a new Marketing stage. |
| **Non-promises** | No Google Merchant API, ranking guarantees, or AI-chatbot citation promises in Wave 4. |

---

## 3) Phase roadmap (**INTENT**)

Amend dates / promotion in §7 changelog.

| Phase | Intent |
| --- | --- |
| **0** | Lock this doc |
| **1** | Intro Gemini bodies + AI literacy + Intro UI harden — **shipped** |
| **2** | Store attractive + discoverability pack (Store surface) — **shipped** |
| **3** | AI-native creative kits + external AI desk roles — **shipped** |
| **4** | This week’s one post + Posted / Skipped — **parked / deferred** (UI race — revisit later) |
| **5** | Tool suggest Nano Banana / Seedance + copyable prompts — **shipped** |
| **6** | Optional in-app visual gen (capped spend) — **parked / deferred** |
| **7** | Harden / EN–AR / tests / Marketing Gemini spend ledger — **shipped** |

**Parked follow-ups:** Store Gemini metering (still not on Marketing Phase 7 ledger). Phase 4 hero remains parked. Phase 6 visual gen remains parked.

---

## 4g) Phase 7 — Harden / EN–AR / Marketing Gemini ledger (**SHIPPED**)

- **Ledger (Marketing only):** successful Gemini calls for **Intro fill** + **creatives kit improve** counted per workspace per UTC month (`marketing_gemini_usage`). Launch / weekly creatives meter **once per successful chunk**. Visual-prompt polish meters only when it actually calls Gemini (with `workspaceId`). **Store `improveStorePageCopy` is not wired** into this ledger.
- Env: `MARKETING_GEMINI_MONTHLY_CAP` (default 40; `0` = templates only). At/over cap → fail-closed to templates / skills + calm honesty (`lessonAiCap` / `kitAiCap`); Try AI fill again hidden while capped.
- Targeted EN/AR + RTL for Marketing Phase 3/5 / how-to / More help / cap copy. Desk stays behind More help. No Marketing redesign; no Phase 4/6 work.

---

## 4f) Phase 6 — In-app visual gen (**PARKED**)

Optional in-app Nano Banana / Seedance generation with spend cap. **Not shipped** — founders use Copy prompt + external tools (Phase 5). Revisit later.

---

## 4e) Phase 5 — Nano Banana / Seedance tool suggest (**SHIPPED**)

- Creative stages only (`pre_launch` / `launch` / `weekly_refresh`). **No** FSM rewrite; Phase 4 parked; no in-app visual gen.
- Skills-first routing by format: `post`/`carousel` → Nano Banana; `reel`/`story`/`ugc` → Seedance; `testimonial` → phone film (no AI).
- Each kit card: tool label, one-line why, **Copy prompt** (product + hook + **elaborated shots** + **how-to shoot** + stage-soft rules). Plain founder language — no OS / Topic A / unlocks meta.
- Optional Gemini polish of why/prompt via `MarketingLlmProvider.polishCreativeVisualSuggestion` — fail-closed to skills text; UI uses skills on render (no spend / no file write / OS does not open tools).

---

## 4d) Phase 4 — This week’s one post (**PARKED**)

Intent remains: one next creative, Posted / Skipped honor-system, OS SoT (no Calendar API). **Not shipped** — uncommitted attempt dropped; **UI race** between optimistic local state and refresh. Revisit later.

---

## 4c) Phase 3 — AI creative kits + external AI desk (**SHIPPED**)

- Stages stay: `pre_launch` / `launch` / `weekly_refresh` (UI: weekly refresh). **No** Marketing FSM rewrite.
- **Weekly next-week move (LOCKED 2026-08-16):** one selling week, one kit per SKU/shop + `weekly_refresh` (replace, never stack). `WEEKLY_PLAN_WEEKS` stays 1. First **Generate week** → Week 1 open brief (stock-here / how-to-order). Stage rail **Regenerate week** → rebuild this week (same `weeklyWeek`, week-1/open brief; no `previousWeekHooks`). Kit-bottom **Move to next week** → increment `weeklyWeek`, author a new kit for week 2+ (convert / proof / weekly extras — not the week-1 open list reshuffled), exclude last kit’s `hookEn`/`angleEn`, Gemini facts include `weeklyWeek` + `weekPhase` + `previousWeekHooks`. New ids, replace the row. Last week not archived. No Move CTA on the stage rail or on Launch / pre-launch / Intro. No new stage, no kit stack. Phase 4 stays parked.
- Approach A: **Generate kit** → Gemini fills niche creative **copy** (hooks, captions, angles, **elaborated shots**, **howToShootEn/Ar**, series labels, why) EN/AR onto deterministic `buildCreatives` skeleton (ids/format/week/schedule locked).
- Fail-closed without key / validate miss → template kit + calm honesty; optional **Try AI fill again** when `source === "template"` or `partial` (hidden on full Gemini and at monthly cap).
- **Launch / weekly_refresh chunked fill:** skeleton split by week (max 4 cards/call); creatives `maxOutputTokens` 16384; parsed JSON is accepted **per card** (one thin shot list does not drop the chunk); leftover fill uses the same Gemini request as generate (full card). Mix persists `source: "partial"` + `templateIds`. **Try AI fill again** on partial fills only leftovers (`continueCreativesKitFill`) — full `generateKit` only when `source === "template"`. Each successful Gemini call counts 1 toward `MARKETING_GEMINI_MONTHLY_CAP`. Pre-launch stays one-shot unless the kit has more than 6 cards. Validate locks unchanged.
- Validate rejects COD-as-wow, pre_launch soft bans, required fields / length / product name, **thin shot lines**.
- Cards show **How to shoot** (phone / light / length / order); Phase 5 prompts reuse the same shot + how-to detail.
- Whole-kit generate only (no Store-style per-creative version picker; no visual gen).
- **External AI desk:** 1–2 copyable Claude/ChatGPT role prompts (SKU + stage + rules; helper not SoT). Teaching copy only — founder opens Claude/ChatGPT themselves. No Claude/ChatGPT API; desk does **not** auto-fill kit cards. UI: collapsed behind **More help** (default closed) so kit + visual tool stay primary.
- Provider: `MarketingLlmProvider.improveCreativesKit` → `creatives-llm.ts`.

---

## 4b) Phase 2 — Store attractive + discoverability (**SHIPPED**)

- Store side surface only — **no** new Marketing stage.
- Approach A: **Improve with AI** click → Gemini EN/AR product drafts + optional policies + discoverability pack (title, short description, search phrases, FAQs, attractiveness tips).
- Fail-closed without `GEMINI_API_KEY` → deterministic template drafts; calm honesty in UI.
- Persist per live SKU on `store_page_packs` (drafts, policies, discoverability, versions). When ≥3 live SKUs, a **Whole-shop** pack (`sku_id` NULL) is available — homepage / shop SEO / shared policies, not a fake product page. Shop checklist / URL / WhatsApp / courier stay on workspace `store_readiness`. Founder **Copy**s drafts/pack for Shopify paste (read-only in OS — no Save drafts).
- **Versions:** baseline captured once before first Improve; up to **3** successful Gemini snapshots **per pack** (product and shop each have their own 3 AI slots); template/LLM miss does not consume a slot; founder picks active version (≤4).
- Non-promises: no ranking guarantees, Merchant API, chatbot citations, or auto-Shopify write.

---

## 4) Phase 1 — Intro Gemini + literacy (**SHIPPED**)

### 4.1 Fixed section ids + titles

- Canonical section **ids** remain `INTRO_LESSON_SECTION_IDS` in `src/lib/marketing/intro-lesson.ts` (`hook`, `niche_signal`, `why_follow`, `reply_loop`, `series`, `three_metrics`, `dm_order_clarity`, `journey_map`).
- **Titles** come from code / i18n by id — UI must **not** depend on model-supplied titles.
- Gemini fills **`bodyEn` / `bodyAr`** only for the owned SKU; validate; on failure fall back to deterministic `buildIntroLesson`.

### 4.2 AI literacy block (fixed titles)

Calm, fixed-title block (not model-authored titles). Canonical ids in `INTRO_LITERACY_SECTION_IDS`:

- `ai_captions` — Chat AI for captions
- `ai_image_nano` — Nano Banana (image / stills tooling hint)
- `ai_video_seedance` — Seedance (motion / short-video tooling hint)
- `ai_chat_claude` — Claude / ChatGPT as strategy / post helpers
- `ai_cursor_optional` — Cursor as optional advanced tip

Same Intro accordion under a literacy subheading.

### 4.3 UI

- Keep existing Intro accordion + `LessonBody`.
- Harden layout for **long AI text** (readable scroll / density — no FSM change).
- Fail-closed without `GEMINI_API_KEY` (or Marketing-specific Gemini env if introduced): show deterministic Intro + clear “AI unavailable” honesty — never invent bodies.

### 4.4 Provider seam

- Introduce `MarketingLlmProvider` (name flexible) with a single bind point for Intro body fill.
- Reuse Gemini patterns from Discovery explain where practical; do not couple Marketing unlocks to Discovery scoring.

---

## 5) Flags / env (names only)

```text
# Phase 1 — Gemini for Intro / creatives (fail-closed when missing)
GEMINI_API_KEY=…          # or DISCOVERY_EXPLAIN_GEMINI_API_KEY
# Phase 7 — Marketing Gemini monthly cap (per workspace; not Store)
# MARKETING_GEMINI_MONTHLY_CAP=40
# Phase 6 — in-app visual gen (parked; default off)
# MARKETING_VISUAL_GEN=0
```

Never commit secrets.

---

## 6) Non-goals (Wave 4)

- Rewriting Marketing / journey FSM
- Calendar API as source of truth
- LLM unlocking stages or inventing ROAS / Topic A money advice
- Whole-shop Intro AI (`skuId` null Intro)
- Google Merchant Center API / ranking guarantees
- Promising AI-chatbot citations or SEO #1 outcomes
- Making Cursor the default marketing manager UI
- Reopening Wave 2 Discovery or Wave 3 Supplier locks

---

## 7) Lock changelog

| Date | Change |
| --- | --- |
| 2026-08-16 | leftover fill uses the same Gemini request as generate (full card). |
| 2026-08-16 | leftover Try AI fill again is one card + copy draft shots if needed; kit button reports still leftover. Shot locks unchanged. |
| 2026-08-16 | Move to next week authors a new convert/weekly plan (excludes last week’s hooks); Regenerate rebuilds this week without incrementing or `previousWeekHooks`. Phase 4 stays parked. |
| 2026-08-15 | One-card leftover fill keeps a usable parse or tells the founder it failed; shot locks unchanged. |
| 2026-08-15 | Leftover / one-card retry asks for complete JSON + built-in shot patterns; validate locks unchanged. |
| 2026-08-15 | Leftover (or full-template) cards get per-card Try AI fill; kit-level button still does all leftovers. |
| 2026-08-15 | Marketing partial amber names leftover card badges + in-page Show scroll; no hash; no per-card generate yet. |
| 2026-08-15 | Marketing creatives: per-card Gemini accept inside a chunk; leftover template ids get one shots-focused retry; Try AI fill again on partial fills only leftovers (no full rebuild). Validate locks unchanged. |
| 2026-08-15 | Marketing launch / weekly kit: chunked Gemini fill (week groups, max 4/call), creatives tokens 16384, `partial` source + honest banner; cap checked per chunk; Store Gemini still not on Marketing ledger. |
| 2026-08-13 | Store Whole-shop pack shipped — `store_page_packs.sku_id` nullable + one shop row per workspace; Marketing-style picker (`?sku=shop`, ≥3 live); shop Improve is homepage/SEO/shared policies; product packs stay isolated; Store Gemini still not on Marketing ledger. |
| 2026-08-13 | Store discoverability intro: why / how to paste in Shopify / no Merchant or ranking claims (EN+AR). |
| 2026-08-13 | Store follow-up — **per-SKU page packs** (`store_page_packs`); Marketing-style picker (no Whole-shop chip); checklist stays shop-wide; Improve/versions fail-closed on `skuId`; Store Gemini still not on Marketing ledger. Whole-shop Store parked. |
| 2026-08-12 | **Phase 7 shipped** — Marketing Gemini monthly ledger (`MARKETING_GEMINI_MONTHLY_CAP`, per workspace); Intro + creatives metered; polish only if Gemini; Store pack out of scope / parked; Phase 6 parked; Phase 4 stays parked; EN/AR + cap honesty + tests. |
| 2026-08-12 | UI: external AI desk collapsed behind **More help · Claude / ChatGPT** (default closed); kit + visual prompts stay primary. |
| 2026-08-12 | Phase 3/5 addendum — elaborated shot lists (see / camera / action) + **How to shoot** on cards (`howToShootEn/Ar`); Gemini validate rejects thin shots; visual prompts reuse full shots + how-to; template fallback richer. |
| 2026-08-12 | Phase 5 UI: show full visual-tool prompt on each creative card (scrollable preview + Copy). |
| 2026-08-12 | **Phase 5 shipped** — creative cards: Nano Banana / Seedance / phone-film suggest + Copy prompt (`suggestCreativeVisualTool`); skills-first; optional Gemini polish seam; no in-app visual gen. |
| 2026-08-11 | Stage id rename: `monthly_refresh` → `weekly_refresh` (canonical). Migration + dual-read legacy rows. Unlock/capacity/FSM unchanged. Phase 4 remains parked. |
| 2026-08-11 | **Phase 4 parked** — This week’s one post + Posted/Skipped deferred (UI race); uncommitted Phase 4 code dropped. Phase 3 remains HEAD. Phases 5–7 next. |
| 2026-08-11 | **Phase 3 shipped** — creative kits: Gemini fills copy onto `buildCreatives` skeleton (`improveCreativesKit`); validate (COD / pre_launch soft / fields); template fallback + Try AI fill again; external AI desk copyable Claude/ChatGPT role prompts (helper not SoT, no auto-fill, no visual gen). |
| 2026-08-11 | Store page stronger: drop **Save drafts** — drafts read-only with **Copy** (+ Copy pack); paste-into-Shopify is guidance only (no Merchant write). |
| 2026-08-11 | Phase 2 addendum — Store page copy **version picker**: always keep non-AI baseline; ≤3 successful Gemini snapshots; template/fail does not burn a slot; select active version; Regenerate disabled at cap. |
| 2026-08-11 | **Phase 2 shipped** — Store “Make the page stronger”: Gemini improve EN/AR drafts + policies + discoverability pack (title/short/phrases/FAQs/tips); Approach A click; template fallback; persist `discoverability_pack`; honesty (no ranking / Merchant / citation promises). |
| 2026-08-11 | Intro trust: successful Gemini Intro stays fixed on stage rail; **Try AI fill again** only when `source === "template"` (banner CTA). |
| 2026-08-10 | Intro AI retry path — template fallback may overwrite via in-lesson recovery (`generateKit` replaces intro items). |
| 2026-08-10 | **Phase 1 shipped** — Intro Gemini bodies via `MarketingLlmProvider` (`intro-llm.ts`); canonical titles + literacy ids; validate → template fallback; Intro UI harden (canonical titles, LessonBody, AI literacy block, EN/AR keys). Approach A on Generate lesson; per-SKU only (shop Intro refused). |
| 2026-08-10 | Wave 4 **Marketing AI** **LOCKED in intent** — AI-native kits (deterministic fallback); stages unchanged; Approach A click-to-generate; Gemini-first `MarketingLlmProvider` seam; skills/gates own unlocks & money honesty. **Phase 1 firm** (Intro Gemini bodies + AI literacy + Intro UI harden). Phases **2–7 roadmap** (Store pack, creative AI + external desk, one-post Posted/Skipped, tool prompts, optional visual gen, harden/spend). |

---

## 8) Related references

- Wave 1 Marketing baseline: `README.md`, `src/lib/marketing/`, `MarketingPanel.tsx`
- Intro deterministic SoT (fallback): `src/lib/marketing/intro-lesson.ts`
- Focus / unlocks: `src/lib/marketing/focus.ts`
- Wave 2 Discovery (do not reopen): `docs/WAVE-2.md`
- Wave 3 Supplier (do not reopen): `docs/WAVE-3.md`
- Gemini precedent (Discovery explain): `src/lib/discovery/explain/`
