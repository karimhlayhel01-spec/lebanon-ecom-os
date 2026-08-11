# Lebanon Ecom OS — Wave 4 (Marketing AI)

Product and engineering locks for **Wave 4**.  
**Wave 1** (multi-SKU hub, stage-aware Marketing FSM, Postgres, fail-closed `skuId`) remains the live baseline.  
**Wave 2** (Discovery) and **Wave 3** (Supplier) remain locked — see `docs/WAVE-2.md`, `docs/WAVE-3.md`. Do not reopen those locks here.

**Status:** Wave 4 **Marketing AI** — **LOCKED in intent** (founder discussion 2026-08-10). **Phase 1 shipped** (Intro Gemini + literacy + UI harden). **Phase 2 shipped** (Store attractive + discoverability pack). Phases 3–7 remain roadmap (amend in § changelog when promoted).

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
| **Stages stay** | `intro_pdf` → `pre_launch` → `launch` → `monthly_refresh` (UI copy: **weekly refresh**). Do not invent a new Marketing stage for Store SEO. |
| **Additive only** | Extend generate/improve paths and Intro UI. **No Marketing FSM rewrite.** |
| **Calendar** | OS remains SoT for kits / “this week’s one post.” Optional Calendar **export** later — not Calendar API as SoT. |
| **Skills / gates own truth** | Unlocks, capacity tiers, COD-as-wow ban, margin honesty stay in skills/gates. **LLM does not** unlock stages or invent ROAS / money advice. |
| **Approach A** | Generate / improve on **explicit founder click** — not every page load. |
| **In-OS LLM** | **Gemini first** via a `MarketingLlmProvider` seam (name flexible). Claude API later = **provider swap**, not a rewrite. |
| **External AI desk** | Claude / ChatGPT **role prompts** = roadmap **Phase 3+**. Cursor = optional advanced tip, **not** the default marketing manager. |
| **Whole-shop kit** | When ≥3 live SKUs, kit may use `skuId` **null** — brand / multi-SKU only. **Intro AI is per-SKU only** (never whole-shop Intro). |
| **Store pack** | Attractiveness / discoverability / SEO pack = **Store** side surface (roadmap Phase 2) — not a new Marketing stage. |
| **Non-promises** | No Google Merchant API, ranking guarantees, or AI-chatbot citation promises in Wave 4. |

---

## 3) Phase roadmap (**INTENT**)

Amend dates / promotion in §7 changelog. Only **Phase 1** is firm to build next.

| Phase | Intent |
| --- | --- |
| **0** | Lock this doc |
| **1** | Intro Gemini bodies + AI literacy + Intro UI harden — **shipped** |
| **2** | Store attractive + discoverability pack (Store surface) — **shipped** |
| **3** | AI-native creative kits + external AI desk roles |
| **4** | This week’s one post + Posted / Skipped |
| **5** | Tool suggest Nano Banana / Seedance + copyable prompts |
| **6** | Optional in-app visual gen (capped spend) |
| **7** | Harden / EN–AR / tests / spend ledger |

---

## 4b) Phase 2 — Store attractive + discoverability (**SHIPPED**)

- Store side surface only — **no** new Marketing stage.
- Approach A: **Improve with AI** click → Gemini EN/AR product drafts + optional policies + discoverability pack (title, short description, search phrases, FAQs, attractiveness tips).
- Fail-closed without `GEMINI_API_KEY` → deterministic template drafts; calm honesty in UI.
- Persist on `store_readiness` (`content_draft_*`, `policies_draft`, `discoverability_pack`, `page_copy_versions`). Founder **Copy**s drafts/pack for Shopify paste (read-only in OS — no Save drafts).
- **Versions:** baseline captured once before first Improve; up to **3** successful Gemini snapshots; template/LLM miss does not consume a slot; founder picks active version (≤4).
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
# Phase 1 — Gemini for Intro bodies (fail-closed when missing)
GEMINI_API_KEY=…          # or a Marketing-scoped alias if added later
# Optional later waves:
# MARKETING_VISUAL_GEN=0  # Phase 6 in-app visual gen (default off)
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
