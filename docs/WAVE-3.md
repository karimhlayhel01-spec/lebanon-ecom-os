# Lebanon Ecom OS — Wave 3 (Supplier agent)

Product and engineering locks for **Wave 3**.  
**Wave 1** (multi-SKU hub, sample-first Supplier 3+2, Postgres, fail-closed `skuId`) remains the live baseline.  
**Wave 2** (Discovery Approach A) remains locked — see `docs/WAVE-2.md`. Do not reopen Discovery locks here.

**Status:** Wave 3 **Supplier live leads + outbound email** — **LOCKED in intent** (founder discussion 2026-08-09). **LBP→USD + max-landed gate** — **LOCKED 2026-08-22**. **AliExpress-first keep** — **LOCKED 2026-08-22** in **§3.4**. **Lebanon agent + broker example notes** — **LOCKED 2026-08-22** in **§3.5**. **Use Lebanon sourcing agent as Import seat + cost-quote copy** — **LOCKED 2026-08-26** in **§3.6**. Implementation is **additive** on the existing Supplier panel / FSM.

**Canonical doc:** this file. Do not reopen locks unless the founder explicitly changes one.

---

## 1) Wave 3 intent

**Founder pain (after Accept):** the shortlist is useful coaching, but options are **invented** (deterministic PRNG). Founders need **reachable, real-world supplier leads** (Alibaba / AliExpress–class marketplaces and similar easy public surfaces) and a path to **email a supplier from the OS** without leaving the draft behind as “copy yourself forever.”

**UX target:**
- Keep **sample-first**, **Import | Local** tabs, **3 primaries + 2 backups** per source, batch/store locks from Wave 1.
- Prefer **live leads** when enabled (auto on Accept / first ensure — Refresh optional).
  - **Import (live on):** real seats or honest empty + retry — never silent invent theater.
  - **Import (live off):** invent Planning estimates remain the safe fallback.
  - **Local (live on):** accurate only — empty or partial live shortlist; never invent Lebanese theater as truth.
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
| **Approach A for search** | Page loads must **not** re-query marketplaces every time. Persist leads on first successful fill (or explicit Refresh). **Import:** failed live gather → keep / fall back to heuristic; never wipe a good Import shortlist. **Local (live on):** failed/empty gather → empty Local (no invent pad); skip Local auto-backfill so empty does not re-query every visit — use **Refresh Local**. |
| **Idempotent fill** | Same Wave 2 `supplierGenerationPlan`: generate only missing sources; do not duplicate rows on every visit. |
| **Truthful provenance** | Each option records whether it came from `heuristic` or `live_search` (and platform / source URL when live). UI may show a calm “live lead” vs “planning estimate” hint — never fake “verified Alibaba Gold” without evidence. |

---

## 3) Live supplier leads (**LOCKED**)

### 3.1 Sources (easy-to-reach platforms)

| Source | Role |
| --- | --- |
| **Alibaba.com / AliExpress** (public web/shopping search) | Primary **Import** lead surface via search SaaS (`site:alibaba.com`, `site:aliexpress.com`, or shopping results) — **not** official Alibaba partner API unless later locked |
| **Other public B2B / marketplace SERP** | Allowed behind the same provider seam if they return title/url/(optional price) |
| **Local (Lebanon)** | Live via Serper when `SUPPLIER_LIVE_LEADS=1` (`gl=lb`, Lebanon / لبنان queries). **Accurate only** — no invent pad as Local truth. Zero usable leads → empty Local + calm “may not be sourcable locally” note. Prefer fewer live seats over fake Lebanese names. |

### 3.2 Provider seam

- Introduce `SupplierLeadProvider` (name flexible) with a single bind point (mirror Discovery’s `getDiscoverySearchProvider` idea).
- Env flag default **off**: `SUPPLIER_LIVE_LEADS=0`. When off, behavior = today’s invent shortlist.
- When on + key present: gather bounded leads → map into 3+2 shape on **Accept / first ensure** (auto; Refresh optional).
  - **Import (live on):** no invent pad — real seats, partial OK, or honest empty + retry. (Live off → invent Planning estimates.)
  - **Local (live on):** never invent-pad; partial live shortlist or empty state only.
- Reuse Serper / SerpAPI keys already in `.env` when possible; **count spend** (prefer shared monthly search ledger or a supplier bucket — do not unbounded-burn Serper trial).
- Timeouts + bounded retries (same spirit as Discovery resilience).
- **Refresh vs warm/sample:** in-flight sample on that source → Refresh **blocked**; approved/warm/chosen → Refresh requires explicit confirm (warns progress wipe).

### 3.3 Schema (additive columns)

Nullable / default-safe fields on `supplier_options` (names may vary in migration):

| Field | Purpose |
| --- | --- |
| `leadSource` | `heuristic` \| `live_search` |
| `platform` | e.g. `alibaba`, `aliexpress`, `local_web`, `other`, null for heuristic |
| `sourceUrl` | Public listing / company URL when known |
| `externalTitle` | Raw title from search (optional) |

Ownership: always `workspaceId` + `skuId` fail-closed.

### 3.4 LBP→USD + max-landed gate (**LOCKED 2026-08-22**)

Founder `maxLandedCost` is USD. A listing priced in LBP must never be stored as dollars. A lead whose **USD** unit cannot fit the cap must not appear.

| Rule | Detail |
| --- | --- |
| **USD only** | `unitPrice` / `unitPriceHint` are USD. Parse `$` / `US$` / `USD` as dollars. |
| **LBP markers** | `LBP` / `LL` / `L.L.` / `ل.ل` / `ليرة` convert via `USD_LBP_RATE` (LBP per 1 USD). Missing or invalid rate → hint **null** (do not write LBP digits as dollars). |
| **No Gemini FX** | Rate is env only. No live Sayrafa API in this lock. |
| **Gate** | Drop only when the **USD unit is known** and it cannot fit (`unit > cap`, or unit + SKU intlShip + clearance + localCourier > cap × 1.2). Never merge invent `unitPrice` onto a live URL (unknown live unit stores `0`, not the heuristic seat price). |
| **Unknown price** | Do **not** hide AliExpress because Serper had no dollar (LBP often missing from the snippet). **Do** hide unknown **Alibaba** until a scrape yields a unit that fits — that is how $320 retail leaked. |
| **Import surfaces** | Alibaba **and** AliExpress. **Query and scrape AliExpress first**, then Alibaba, so the 5-scrape budget prices cheap LBP listings before expensive US retail. |
| **Holes** | No invent pad to cover dropped seats. Optional honesty: N hidden over cap. |
| **Price fill (ensure/refresh only)** | After `mapOrganicHitToImportLead`, if hint is null, scrape the listing once and `extractUnitPriceUsd` (max **5** scrapes per run, AE-first order). Then gate. |
| **Refresh keep** | Refresh must **not** replace a good AliExpress shortlist with one survivor. Union new passing leads with **prior live Import seats that still keep** (cheap/unknown AE; known-fit Alibaba). Dedupe by URL. Incoming scrape wins when it has a unit; else keep the prior unit. |
| **Assess** | If a later extract is over the cap, hide/remove that available Import live seat (no sample). Do not leave it displayed. |
| **Over-cap live Import** | A live Import seat must not render when the USD unit is over the cap, or when Alibaba is unknown / unparseable / invent leftover on a live URL. Re-gate persisted Import live rows on ensure/refresh. |
| **Out** | Discovery retrieve, 70/35%, Shopify, Gmail, Local invent-as-truth. |

### 3.5 Lebanon agent + broker example notes (**LOCKED 2026-08-22**)

Static coaching copy only. Not supplier cards. Not Discovery.

| Rule | Detail |
| --- | --- |
| **Import sourcing note** | Always on the Supplier **Import** tab and **Both** when Import is in view. Hide on Local-only. Place under the Import shortlist / empty Import body (not inside a card). Bold. If listings are too expensive or MOQ is too high to work the factory yourself, a Lebanon sourcing agent can buy, inspect, and ship — founder pays their fee. Many also clear door-to-door; ask them; founder still pays **duties**. Examples (not OS partners; check yourself): Nour Express (nourexpress.me), China to Lebanon (chinatolebanon.com), Pick N Ship (picknship.net), China Gate (chinagatelb.com). Optional `https` links to those four hosts only. |
| **Clearance brokers** | Extend Import `clearancePartnerPlaceholder` and Import `costQuotesGuideClearance` only. If the founder already bought direct and only needs Beirut release, a customs broker can clear — not a China buying agent. Examples (not OS partners): ASL (asl.com.lb), Ocean Link (oceanlink-lb.com), Chami (chami.co). Do **not** name the four sourcing agents on clearance surfaces. |
| **Local / Both clearance** | `clearanceLocalSoft` / `clearanceLocalVsDeliveryNote` / `clearanceBothNote` unchanged. Do not dump broker names on Local. Onboarding `sampleClearance` unchanged. |
| **Out** | No phones, WhatsApp, Gemini, Serper for agents, invent pad, Discovery expensive-aisle, MIN_BUDGET. |

### 3.6 Use Lebanon sourcing agent as Import seat + cost-quote copy (**LOCKED 2026-08-26**)

Named agents stay coaching examples in §3.5. This slice adds **Use this agent** seats so `requestSample` has a real `supplier_options` id. Real unit costs stay the Import form — no new quote JSON keys, no Local form for agents.

| Rule | Detail |
| --- | --- |
| **Picker** | Under `importSourcingAgentNote` (Import + Both only): four rows from the existing allow-list — **Open site** + **Use this agent on this SKU**. In-use row: name + Open site + **Undo** (`undoUseAgentOnSku`) — not a dead “in use” label. Undo deletes this SKU’s `lebanon_agent` directory seat only (not live Import listings); no sample → delete (all four rows show Use again); sample on that seat → block (`useAgentBlockedSample`), do not wipe in-flight/approved. Other-host Use still replace-if-no-sample (Undo not required to switch). Hosts and note copy stay §3.5. No sample CTA on clearance brokers. |
| **Seat** | Inserts one owned Import `supplier_options`: `platform` `lebanon_agent`, `leadSource` `directory` (not `live_search`), name + sanitised `https` URL from the allow-list only. No unit / MOQ / stars. Hide **Assess** on that platform. |
| **One per SKU** | At most one `lebanon_agent` seat. Replace if no sample on it. If a sample exists on that seat, error / confirm-block — do not wipe in-flight. |
| **Sample** | Existing `requestSample` / flight cap / “you still contact outside” unchanged. The new id is a normal Import supplier for sample-first. |
| **Refresh / gate** | Refresh Import, `visibleImportRefreshSeats`, `shouldKeepPersistedImportLiveSeat`, `unionImportRefreshLeads`, drop-on-read: never delete or hide `platform` `lebanon_agent` (keep even with unit `0`). Do **not** run `keepImportLiveLead` on them. Do not treat those URLs as live_search AliExpress / Alibaba. |
| **Cost quotes** | Still source `import`. No new persistence keys. When working/path platform is `lebanon_agent`, swap intro + `costQuotesGuideFreight` + `costQuotesGuideClearance` (EN+AR): agent invoice; door-to-door → intl shipping; duties → clearance; if all-in, don’t double-count; no ASL / Ocean Link / Chami on this path. Courier + Local quotes unchanged. Prefill / save / unlock / path-switch unchanged. |
| **Out** | No phones / WhatsApp scrape. No Gemini. No MIN_BUDGET. No Discovery expensive-aisle. No Local form for agents. |

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
# USD_LBP_RATE=            # LBP per 1 USD (e.g. 89500). Missing → LBP hints stay null
```

Never commit secrets.

---

## 6) Non-goals

- Official Alibaba Open Platform / Accio required
- Live search on every Supplier page load
- Auto-emailing suppliers without confirm
- Moving Supplier onto Discovery cards
- Invent Local shortlist posing as real when `SUPPLIER_LIVE_LEADS` is on (empty > invent)
- Clearing a good **Import** shortlist when Import live returns empty (Import still heuristic-pads)
- Discovery photo gallery in this wave

---

## 7) Lock changelog

| Date | Change |
| --- | --- |
| 2026-08-26 | **Undo Use this agent** — in-use row is Open site + Undo (remove directory seat if no sample; block if sample exists). Does not wipe live Import listings or in-flight/approved sample. Other-host Use still replace-if-no-sample. |
| 2026-08-26 | **Use Lebanon sourcing agent as Import seat LOCKED** — allow-list Open site + Use this agent under Import sourcing note; one `lebanon_agent` / `directory` Import seat per SKU (replace if no sample; block if sample exists); hide Assess; Refresh/gate keep unit-0 agent seats; Import quote intro/freight/clearance swap when path is `lebanon_agent` (no broker names; no new quote JSON keys). |
| 2026-08-22 | **Lebanon agent + broker example notes LOCKED** — static Import sourcing-agent note (Nour Express / China to Lebanon / Pick N Ship / China Gate) on Import + Both; clearance-broker examples (ASL / Ocean Link / Chami) on Import footer + Import quotes only. Not cards. Not Discovery. No phones. |
| 2026-08-22 | **Over-cap live Import must not render** — `$320-340` / invent leftover on an Alibaba URL cannot sit under a $100 cap. Re-gate persisted Import live seats on ensure/refresh. AliExpress-first keep of cheap/unknown AE is unchanged. |
| 2026-08-22 | **AliExpress-first keep LOCKED** — supersedes “null Serper hint = hide.” Drop only **known** over-cap USD. Keep unknown AliExpress. Hide unknown Alibaba until priced-and-fit. Query + scrape AE before Alibaba. Refresh **unions** prior keepable live Import seats with new leads (do not wipe cheap AE). Still no invent unit on a live URL. |
| 2026-08-22 | **Live Import price fill** — ensure/refresh may scrape up to 5 listings to `extractUnitPriceUsd`, then gate. Never invent unitPrice onto a live URL. Assess over-cap extract hides the available seat. AliExpress + Alibaba stay. |
| 2026-08-22 | **LBP→USD + max-landed gate LOCKED** — `unitPrice` / `unitPriceHint` stay USD. LBP (`LBP` / `LL` / `L.L.` / `ل.ل` / `ليرة`) converts via `USD_LBP_RATE` (LBP per 1 USD); missing rate → hint null, never LBP-as-dollars. Drop live leads when unit > onboarding `maxLandedCost` or unit + money-snapshot legs > cap × 1.2. Import still Alibaba **and** AliExpress. No invent pad, no Gemini FX, no Discovery change. |
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
| 2026-08-09 | **Live Local (Lebanon)** **LOCKED** — same `SUPPLIER_LIVE_LEADS` + `SERPER_API_KEY`; Serper `gl=lb` + Lebanon/لبنان queries (≤3); persist only http(s) URL + contact-facing name; **no invent pad** when live on (0 → empty Local + “may not be sourcable locally”; partial live OK). **Refresh Local leads** mirrors Import confirm/quota gates; Import path untouched. Approach A: skip Local auto-backfill when live on so empty does not re-query every page load. |
| 2026-08-09 | **Local product relevance** — Local SERP hits must match SKU modifiers/distinctive tokens (`isLocalHitRelevantToProduct`); quoted product queries; loose category matches (e.g. food containers without collapsible) → drop; 0 strict matches → empty Local. Import gather unchanged. |
| 2026-08-09 | **Local marketplace ban** — Local URL gate allows only `.lb` or Google Maps + Lebanon signal; deny Ubuy/eBay/Amazon/Noon/… brand labels on any TLD; no longer accept arbitrary hosts just because snippet says “Lebanon”. |
| 2026-08-09 | **Both-tab Local empty note** — when Both (or frozen Both) has Import groups but zero Local groups, show a compact `bothTabNoLocalNote`; Local tab empty banner unchanged. |
| 2026-08-09 | **Supplier Both/sample-first copy** — `intro` + `bothTabDensityNote` no longer claim dual full 3+2 / primary+backup shortlists; match empty/partial Local reality. |
| 2026-08-09 | **Auto live fill + Refresh/warm locks** — Accept/`ensureSuppliers` one-shot live Import+Local when flag+key (Approach A; no re-query once filled). Live ON → **no invent pad** for Import or Local (empty + retry CTA). Refresh: **block** while sample in-flight on that source; **confirm** for approved/warm/chosen wipe. Refresh optional, not required for first shortlist. |
| 2026-08-09 | **Marketing “Set ETA on Supplier”** **LOCKED** — CTA links to `#batch-arrival-eta` on SKU surface (cross-page: `/sku/{id}#batch-arrival-eta`; fallback `/supplier#batch-arrival-eta`). Same-document clicks scroll via hash (Next Link hash-only can no-op). `BatchArrivalEtaBlock` mounts with stable `id="batch-arrival-eta"` whenever sample approved **or** batch ordered, until batch arrived — so the CTA is never dead on pre-launch. Save gate (`canEditBatchArrivalEta`) matches. |
| 2026-08-09 | **Generate kit stay on Marketing** **LOCKED** — intentional `#batch-arrival-eta` scrolls once then locks that locationKey (remount/revalidate with leftover hash must not re-scroll). Generate / Regenerate kit and Save creatives on SKU surface pin `#marketing` + suppress before revalidate (mirror Topic A stay-put). Fresh `/sku/{id}#batch-arrival-eta` still lands on ETA once. |
| 2026-08-10 | **Founder rename supplier after sample** **LOCKED** — after ≥1 `sample_records` row for a supplier, founder may rename `supplier_options.name` (SKU SampleTracker + Shop hub Status/chip + Sample/Working supplier card). Fail-closed ownership. Assess `persistAssessedSupplierName` stays no-op (no auto-rename). No rename on shortlist/Assess cards. One DB write → hub + SKU sync via revalidate. |
| 2026-08-10 | **Contact supplier door (path/working card)** **LOCKED** — after sample path is chosen, `ChosenSupplierSummary` (Sample supplier / Working supplier) is the **primary contact surface** for the whole SKU journey (sample → approve → batch → selling/reorder). Door opens a portal modal (same pattern as Assess) with Open listing (when URL), honesty `emailDraftHint`, read-only `negotiationDraft`, Copy draft, Open in Gmail (Phase 3a). OS does **not** auto-email or invent inboxes. Shortlist card email remains for browse/pick only. Additive; no FSM rewrite; no Phase 3b Zapier send. Card stays multi-target (Rename / Open listing / View shortlist keep working). |
| 2026-08-10 | **Founder-stored supplier email + WhatsApp** **LOCKED** — nullable `supplier_options.contact_email` / `contact_whatsapp` (founder-entered only; never Serper/Assess/scrape). Same sample-request gate as rename (≥1 `sample_records`). Surfaces: Shop hub Supplier Status + Contact supplier door (shared editor). One DB write → hub + SKU sync via revalidate. Open in Gmail prefills `to` when email set; Open WhatsApp → `wa.me/{digits}` when set. Do **not** use `store_readiness.whatsappNumber`. OS still does not auto-email/auto-WhatsApp. Shortlist cards: no contact edit. No Phase 3b. |
| 2026-08-10 | **Spare rename + contacts + Contact door** **LOCKED** — same sample-request gate applies to path **or** spare (`supplier_options` SoT; path vs spare is display only). SKU Supplier panel: every SampleTracker (incl. spare) gets Rename + contacts + Contact door; warmed-spares list on Sample/Working card and warm switch list get Rename + Contact (modal parameterized by that spare’s `SupplierView`). Hub Status stays **working/path only**. Shortlist cold seats: still no rename/contacts. Additive; no FSM / flight-cap / scrape changes. |

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
- Wave 4 Marketing AI (do not reopen here): `docs/WAVE-4.md`
- Search vendors already in tree: `src/lib/discovery/providers/serper.ts`, `serpapi.ts`
- LBP→USD + max-landed + AliExpress-first keep: `src/lib/supplier/live/unit-price.ts`, `src/lib/supplier/live/max-landed.ts`, `src/lib/supplier/live/fill-import-price.ts`, `unionImportRefreshLeads` in `src/lib/supplier/live/refresh.ts`
- Lebanon agent seats + quote copy: `src/lib/supplier/lebanon-agent-seat.ts`, `useLebanonSourcingAgent` / `undoLebanonSourcingAgent` in `src/lib/supplier/service.ts`
