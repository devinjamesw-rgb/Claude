# DealDevil handoff for Gemini

_As of November 4, 2026 · repo `devinjamesw-rgb/Claude`, branch `claude/practical-turing-xer7ji` · written by Claude for another AI to analyze and improve_

DealDevil is a personal deal finder. It has three parts:
- **A live web app** on claude.ai.
- **A curated deal catalog** in this repo.
- **A scanner**, run by GitHub Actions, that re-checks each deal on the business's own website.

It holds **22 deals: 20 verified and 2 waiting for verification**. Its biggest gaps are thin local coverage, and a sync step from scan results to the app that still needs a Claude session.

---

## 1. Read this first: what you can and can't do

| You can | You can't |
|---|---|
| Read and analyze everything in `dealdevil/` and `.github/workflows/dealdevil-scan.yml` | Open the app (`https://claude.ai/artifact/4HPW9b1uDxaRTqPwGLkbxr`). It is private to the owner |
| Propose code changes as unified diffs against the branch | Write to the app's database. Only a Claude session signed in as the owner can (the `ArtifactData` tool) |
| Propose new deals as catalog JSON entries (format in section 6) | Republish the app. Only a Claude session can (the `Artifact` tool) |
| Run the scanner and its tests locally, with open internet | Mark a deal verified without the business's own page or social post saying so |

**How to hand work back:** reply with diffs and catalog entries. The owner gives them to a Claude session, which applies them, runs the tests, pushes, lets GitHub page-check new deals, and syncs the database.

**The owner:**
- Has no coding experience and works only through chat: no terminals, editors or dashboards. Never propose a workflow that needs them to run commands.
- Is based in Suffolk County, NY, and also wants deals that work while traveling.

---

## 2. Product rules (from the owner, not negotiable)

1. **Named item, named price, named day.**
   - The day is specific weekdays, an explicit "daily" from the business, or a specific date.
   - "$5 espresso martinis on Fridays" counts.
   - "Happy hour 3–6", "$10 cocktails", "$1 off drafts" and "half-price apps" never count.
2. **Verified only.**
   - The main list shows only deals confirmed on the business's own website or social accounts.
   - Third-party listings (OpenTable, Yelp, Patch, blogs, aggregators) are leads, never proof.
   - Everything unconfirmed waits in a "To verify" drawer with the reason and the evidence.
   - **Memberships are the one exception.** An always-on discounted plan (student, young-adult or teacher rates) must name a plan, a price and who qualifies instead of a day. These live in their own Memberships drawer and follow the same verification rule. Vague offers like "up to 30% off" don't count.
3. **Two scopes.**
   - **Local** is a specific venue near a US town the owner picks.
   - **Anywhere** is a chain-wide deal usable while traveling, like Whole Foods oysters on Fridays.
4. **Polite collection.** Respect robots.txt, never log in, never scrape behind accounts. UNiDAYS is excluded for this reason.
5. **Accuracy beats volume.** A thin, correct list is better than a full, wrong one. When in doubt, a deal goes to To verify.

---

## 3. Current state

**Update, Nov 5, 2026.** A Memberships section was added (app version 6). 14 student and young-adult memberships from Gemini's student sheet were seeded. 12 are verified through first-party search checks: Spotify, Apple Music, YouTube Premium, the Disney+ and Hulu bundle, HBO Max, Peacock, Prime for Young Adults, Walmart+, Target Circle 360, DashPass, Headspace and Peloton App One. 2 wait in To verify: Uber One (Uber's own pages disagree, $4.99/mo vs $6.99/mo) and Paramount+ (the student page looks about three years old). Tech discounts ("up to 30% off") and third-party-only offers were left out. Gemini's 13 Suffolk deals are in the catalog as pending; they go into the database only after the GitHub page check runs. GitHub was refusing every push on Nov 4 and 5 ("fatal error in commit_refs"), so that check hasn't run yet.

The app, the catalog (`dealdevil/deals/catalog.json`) and the database were in sync after commit `17a9b7a`.

The strict GitHub page check of Nov 4, 2026, 18:30 UTC ([run 41887408980](https://github.com/devinjamesw-rgb/Claude/actions/runs/41887408980)) confirmed 16 of the 20 verified deals directly on the businesses' pages. AMC (HTTP 403) and Regal (robots.txt refuses bots) block automated checks, so those 4 rest on search-engine snippets of their own pages.

| Item | Price | Business | Scope | Days | Status | Evidence |
|---|---|---|---|---|---|---|
| All-you-can-eat tacos | $34.99 | Rocco's Tacos, Huntington Station NY | Local | Tue, open–close | Verified | Page check |
| House margaritas | $7 | Rocco's Tacos, Huntington Station NY | Local | Tue | Verified | Page check |
| Unlimited bowling (Family Unlimited) | $15.99 | Lucky Strike, Commack NY | Local | Sat–Sun 11 AM–3 PM | Verified | Page check |
| Unlimited bowling (Night Strike) | $19.99 | Lucky Strike, Commack NY | Local | Sun from 6 PM | Verified | Page check |
| Unlimited bowling (Night Strike) | $19.99 | Lucky Strike, Commack NY | Local | Mon–Thu from 7 PM | Verified | Page check |
| Arcade play | 50% off | Lucky Strike, Commack NY | Local | Wed | Verified | Page check |
| Unlimited bowling (After Party) | $28.99 | Lucky Strike, Commack NY | Local | Fri–Sat from 8 PM | Verified | Page check |
| Third game when you buy two | 50% off | Lucky Strike, Commack NY | Local | Daily | Verified | Page check |
| Two 20-inch pizzas | $22 | Uncle Giuseppe's, North Babylon NY | Local | Wed, Fri | Verified | Page check |
| Local oysters (Buck A Shuck) | $1 each | Salt & Barrel, Bay Shore NY | Local | Daily 3–6 PM | Verified | Page check |
| Movie tickets, adult evening price | 50% off | AMC Theatres | Anywhere | Tue, Wed | Verified, free membership | Search; site blocks bots |
| Small popcorn & drink combo | 50% off | AMC Theatres | Anywhere | Tue, Wed | Verified, free membership | Search; site blocks bots |
| Popcorn | 50% off | Regal | Anywhere | Tue | Verified, free membership | Search; robots.txt refuses |
| Candy | 25% off | Regal | Anywhere | Mon | Verified, free membership | Search; robots.txt refuses |
| Movie tickets | Up to 50% off | Cinemark | Anywhere | Tue | Verified | Page check |
| Arcade games | Half price | Dave & Buster's | Anywhere | Wed | Verified | Page check |
| Boneless wings | BOGO | Buffalo Wild Wings | Anywhere | Thu | Verified | Page check |
| Traditional wings | BOGO 50% off | Buffalo Wild Wings | Anywhere | Tue | Verified | Page check |
| Traditional wings (6, 10 or 15 count) | BOGO free | Buffalo Wild Wings | Anywhere | Tue | Verified, free Rewards, dine-in | Page check |
| Live oysters | 12 for $12 | Whole Foods Market | Anywhere | Fri | Verified | Page check |
| Trivia night | Free | Bridge Lane Wine, Mattituck NY | Local | Thu 6:30–8 PM | To verify | Seasonal; not on the November calendar |
| Heroes and hot food | 50% off | Uncle Giuseppe's, store unknown | Local | Daily after 7:30 PM | To verify | Not on uncleg.com; the owner reported it |

**Removed after checks:**
- Croxley's Ale House, Smithtown (closed 2020).
- Perfecto Mundo, Commack (only a 2012 Patch post; reported closed 2014).
- 11 generic or unverifiable deals.

**Corrected after checks:**
- Whole Foods: "$1 each" became the page's own "12 for $12".
- Salt & Barrel: OpenTable's half-price listing became its own Buck A Shuck offer.

---

## 4. Architecture

```
 Owner's phone ──uses──> DealDevil app (claude.ai artifact: index.html + places.txt)
                               │  reads/writes
                               ▼
                         Deal database (artifact's built-in store; owner-only writes)
                               ▲
                               │  writes (ArtifactData tool)
                         Claude session  ── runs build_sync_batch.py ──┐
                               │ curates                                │ reads
                               ▼                                        │
  deals/catalog.json ──> scanner on GitHub Actions ──> scanner/out/*.json (results)
                               │
                               ▼  loads pages (robots.txt respected)
                         Business websites (first-party only)
```

The app cannot read GitHub: claude.ai pages block outside network requests. That's why a Claude session must copy scan results into the database. This one manual link is the main architectural weakness.

| Part | Path | Notes |
|---|---|---|
| App | `dealdevil/index.html` | About 960 lines of plain HTML/CSS/JS, no framework, no build step. Published to the artifact with `places.txt` beside it |
| Places list | `dealdevil/data/places.txt` | 4,702 lines `name\|state\|lat\|lng\|population_thousands`: US cities of 10,000+ (GeoNames) plus Suffolk County hamlets. Used by the town picker |
| Catalog | `dealdevil/deals/catalog.json` | Source of truth for curated deals. Each has a `verify` block, and a top-level `removed` list names deleted ids |
| Scanner | `dealdevil/scanner/dealscan.py` | Python 3.9+, standard library only (Playwright optional for JavaScript pages) |
| Tests | `dealdevil/scanner/test_dealscan.py`, `fixtures/` | 23 unit tests, all passing |
| Sources | `dealdevil/scanner/sources.json` | 11 enabled pages (5 local, 6 chain), 2 disabled (Slickdeals, UNiDAYS) |
| Sync helper | `dealdevil/scanner/build_sync_batch.py` | Catalog + `out/verification.json` + optional `out/new.json` become database write batches |
| Workflow | `.github/workflows/dealdevil-scan.yml` | Runs tests, `--verify`, then a scan. Commits results to `dealdevil/scanner/out/` |
| Results | `dealdevil/scanner/out/` | `verification.json/.md`, `deals.json`, `new.json`, `state.json`, `report.md` |

---

## 5. Data model

Each deal is one document in the database collection `deals`. The catalog uses the same shape plus an `id`.

| Field | Type | Meaning |
|---|---|---|
| `scope` | `"local"` or `"anywhere"` | Missing means local |
| `item` | string | The named thing; must pass the named-item check |
| `price` | string | `"$7"`, `"50% off"`, `"BOGO"`, `"12 for $12"`, `"Free"` |
| `priceNote` | string or null | `"per person"`, `"each"` (rows show it only if 24 characters or fewer) |
| `venue` | string | The business (Local) or brand (Anywhere) |
| `town`, `state`, `lat`, `lng` | strings, numbers or null | Local only; `lat`/`lng` = town center, used for distance |
| `address` | string or null | Shown in detail and used for directions |
| `category` | `food` `drinks` `grocery` `coffee` `fun` `gas` `shop` | Legacy `happy` is read as `drinks` |
| `days` | array of 0–6 | 0 = Sunday; empty = every day |
| `start`, `end` | `"HH:MM"` 24-hour or null | No start = all day; start without end = until close; end before start = runs past midnight |
| `hoursKnown` | boolean | `false` shows "hours vary" |
| `validFrom`, `validUntil` | `"YYYY-MM-DD"` or null | Date limits |
| `conditions` | string array | The fine print |
| `loyaltyRequired` | boolean (optional) | Shows a "Free member login" pill |
| `businessUrl` | string or null | The business's own page |
| `verification` | object | See below |
| `evidence` | array of `{label, url, kind}` | `kind` is `business` or `third-party` |
| `verify` | `{url, tokens}` or null | The page the scanner checks and the phrases that must appear together |
| `kind` | `"membership"` or absent | Memberships skip the day rule and show in their own drawer |
| `eligibility` | string (memberships) | Who qualifies, short: "College students", "Ages 18–24 & students" |
| `group` | string (memberships) | `streaming`, `shopping`, `delivery`, `wellness`, `tech`, `travel`, `other` |
| `regularPrice` | string (memberships, optional) | The non-discounted price, e.g. "$12.99/mo" |
| `status` | `"active"` or `"gone"` | Gone = hidden, restorable |
| `addedBy` | `claude`, `you`, `scanner` | Who created it |
| `createdAt`, `updatedAt`, `foundAt` | ISO strings | Timestamps |

The `verification` object:
- `status`: `verified` or `pending`.
- `method`: `website`, `instagram`, `facebook` or `in-person`.
- `via`: `page` (the scanner loaded the page and found it), `search` (seen on the business's own page through search) or `you` (the owner confirmed it in the app).
- Also: `url`, `checkedAt`, `note`, `snippet` (the business's exact sentence, shown as a quote) and `snippetHash`.
- For pending deals, `reason` is one of: `conflict`, `third-party`, `not-on-site`, `scanner-official`, `not-found`, `negated`, `awaiting-page-check`, `unreachable`.

**Staleness (enforced in the app):** a verified deal whose `checkedAt` is more than **14 days old (local) or 30 days old (chain)** is shown in To verify with reason `stale`.

Example catalog entry:

```json
{
  "id": "wholefoods-oysters-fri",
  "scope": "anywhere",
  "item": "Live oysters",
  "price": "12 for $12",
  "priceNote": "live oysters",
  "venue": "Whole Foods Market",
  "category": "grocery",
  "days": [5], "start": null, "end": null, "hoursKnown": true,
  "conditions": ["In-store only, U.S. stores", "Excludes refrigerated shucked oysters"],
  "businessUrl": "https://www.wholefoodsmarket.com/days-of-deals",
  "verification": {"status": "verified", "method": "website", "via": "page",
    "url": "https://www.wholefoodsmarket.com/days-of-deals", "checkedAt": "2026-11-04",
    "snippet": "12 for $12 All Live Oysters"},
  "verify": {"url": "https://www.wholefoodsmarket.com/days-of-deals", "tokens": ["12 for $12", "live oysters"]}
}
```

Other storage:
- **Per-person preferences** live at `data/users/<id>/prefs`: home town, saved deals.
- **Database access rules:** `deals` is readable by viewers and writable only by the owner or editors.
- **Browser storage** holds conveniences only (`dd2:view`, `dd2:deals`, `dd2:prefs`).

---

## 6. How to propose a new deal

Give one JSON object per deal in the catalog shape above, with these rules:
- `businessUrl` and `verify.url` must be the **business's own page**, not a listing site.
- `verify.tokens` are 2–4 short phrases copied from that page that must sit **in one block or within 250 characters**:
  - the price (e.g. `"$19.99"`)
  - an item phrase (e.g. `"Night Strike"`)
  - a day phrase (e.g. `"Sunday starting at 6PM"`)
  Prices match exactly (`"$1"` never matches `"$12"`), and times match regardless of spacing ("3 PM" equals "3pm").
- Set `verification` to `{"status": "pending", "reason": "awaiting-page-check", "note": "<where you saw it>"}`. The scanner promotes it after its own page check passes. Never set `verified` yourself.
- The item must name a specific thing. The scanner and the app both reject generic items using the word list in `GENERIC` in `dealscan.py`.

---

## 7. App internals (`index.html`)

**The screen, top to bottom:**
1. Wordmark, search toggle and saved-only toggle.
2. A large **Local | Anywhere** switch.
3. A control line: home town picker, day picker (Today, Tomorrow, each weekday, Any day) and, in Local, a distance picker (5, 10, 25, 50, 100 mi, any).
4. A one-line summary.
5. One **collapsible drawer per deal type**, then the **To verify** drawer.
6. A footer.
7. An owner-only **Add a deal** form.

**Key functions:**
- `derive()`: filters by scope, gone, search, saved, verification (via `verOf()`, which applies staleness), the day (`runsOn()`) and distance (`haversine()`).
- `when()`: computes the status: `live`, `later`, `check`, `ended` or `other`.
- `render*()` builds the screen. Detail sheets come from `detailHTML()` and `verifyFormHTML()`; the add form from `openForm()` and `submitForm()`.
- `boot()` subscribes to the database once and caches it in browser storage.

**Writes the app makes:**
- Add or edit a deal (full set).
- "I verified it" (sets `verification` with method and proof link).
- "It's gone" and "Restore" (with Undo), and delete (two taps).
- Save, and the home town (per-person prefs).

**Design system:**
- Color tokens with full light and dark sets: stone `#F2F0EB`, ink `#19181C`, garnet `#7D1E2C`, green for live, brass `#6E5B2A` for the verified seal.
- Type: Geist for the UI, Instrument Serif for the wordmark, sheet titles and quotes.
- Every color is a token. Phone safe areas are respected.

**Platform limits:**
- No GPS (claude.ai blocks it), so distance comes from the chosen town's center.
- No `alert`/`confirm`.
- No outside network calls except files published beside the page.

---

## 8. Scanner internals (`dealscan.py`)

**Finding pipeline** (`python3 dealscan.py`):
1. **Fetch.** It checks robots.txt (a 401 or 403 on robots.txt counts as blocked), waits at least 3 seconds per host, sends ETag/If-Modified-Since, caps pages at 3 MB, and decodes gzip and deflate.
2. **Parse.** RSS and Atom are read item by item. Pages yield schema.org JSON-LD offers and events, then text blocks (paragraphs, list items, cells, headings) with their heading attached; nav, footer, forms and scripts are skipped.
3. **Skip stale third-party pages:** non-official pages whose `article:published_time`, `<time pubdate>` or JSON-LD `datePublished` is over 365 days old.
4. **Score each block.**
   - Points for: percent off (+3), BOGO/half price (+3), "$X off" (+3), a $ price (+2), free (+1), deal words (up to +2), a schedule (+1).
   - Points against: nav/legal words (−3), over 350 characters (−2), more than 4 prices, i.e. a menu (−2).
   - The threshold is 3. A "Mon–Fri 4–7pm" line above a list lends its hours to the items under it.
5. **Apply the rule.** `meets_rule()` needs a named day, a named price, and an item surviving `names_an_item()`, which strips about 150 generic words.
6. **Normalize** to the data model. Ids are a stable hash. **Every find starts as `pending`**, even from official sites, because parsing can attach the wrong day.
7. **Track** in `state.json`: first and last seen. New finds go to `new.json`; finds unseen for 21 days are forgotten.

**Verify mode** (`python3 dealscan.py --verify ../deals/catalog.json --render`):
- **Matching:**
  - Loads each `verify.url` fresh, with headless Chromium as a fallback.
  - All tokens must appear in **one block** (block text plus its heading), or else within a **250-character window**.
  - Statement blocks are preferred over FAQ questions.
- **Negation:** "expired", "ended", "no longer available", "sold out" or "discontinued" near the match fails it.
- **Result statuses:** `verified`, `not_found`, `not_together`, `expired_or_negated`, `needs_render` (page text under 300 characters) and `unreachable`.
- **Evidence:** the `matchedSnippet` is the page's exact words. It is the smallest run of blocks holding every token, with call-to-action tails trimmed, plus a SHA-256 prefix.

**Sync** (`build_sync_batch.py --db-dir <export> --db-versions <versions.json> --out <dir>`):
- Writes ArtifactData batches of at most 50, pinned with `if_version`.
- Applies results: `verified` → `via: page` with snippet; failures → pending (`not-found` or `negated`); `unreachable` → keeps the earlier verification.
- Never overwrites a deal the owner verified (`via: you`) or marked gone, and leaves owner-added deals alone.
- Deletes ids in `removed`. Scanner finds are added only with `--include-new`, de-duplicated against the catalog.

**Workflow:**
- Runs on pushes to `claude/**` that touch the scanner or catalog, plus a **6-hour schedule that only runs once the file is on the default branch** (`claude/retro-bowl-multiplayer-9a8cd0`). [PR #1](https://github.com/devinjamesw-rgb/Claude/pull/1) does that and is waiting for the owner.
- Uses `actions/checkout@v5`, `actions/setup-python@v6` and Playwright 1.64.0.

---

## 9. Constraints

| Constraint | Effect |
|---|---|
| claude.ai artifact sandbox | The app can't call outside URLs or read GitHub; results reach it only through a Claude sync |
| No device location in the artifact | Distance is from the chosen town's center |
| Artifact is private | Only the owner opens the app; other AIs work from this repo and this file |
| Database limits | 25,000 documents, 256 KiB each, last write wins |
| Claude's coding sandbox blocks most websites | Its research uses search snippets; real page loads happen on GitHub Actions |
| GitHub schedules need the default branch | The 6-hour cron waits for PR #1 |
| Bot protection | AMC (403) and Regal (robots.txt) can't be page-checked |
| Instagram and Facebook | No automated access; the owner verifies by pasting a post link in the app |
| Owner doesn't code | Everything must work through chat |
| App Store | Needs the owner's Apple Developer account ($99/yr), and Apple rejects thin web wrappers; not started |

---

## 10. Known gaps and risks

| Severity | Risk |
|---|---|
| High | **No automatic sync.** Scan results reach the app only when a Claude session runs `build_sync_batch.py` and writes the batch. Checks now expire, so deals will drift into To verify unless the sync runs regularly |
| High | **Token checks still can't see regional exclusions** or contradicting terms elsewhere on a page |
| Medium | **Thin local coverage:** 10 verified local deals, 7 of them from Lucky Strike and Rocco's. Small venues post specials on Instagram and Facebook, which nothing automated can read |
| Medium | **Big brands block bots** (AMC, Regal) |
| Medium | **Extraction is heuristic:** English-only, regex-based, misses specials posted as images or PDFs |
| Medium | **Schedule inactive** until PR #1 merges |
| Medium | **Open human questions:** the Uncle Giuseppe's 7:30 claim, the Bridge Lane season, the Dave & Buster's Sunday mention, and Salt & Barrel's Tuesday closures (older posts say closed Tuesdays; its page says "EVERYDAY") |
| Low | **Approximate distance:** town centers, not addresses |
| Low | **No time zone per deal:** the status uses the device clock |
| Low | **No app tests;** only the scanner has unit tests |
| Low | **Mixed id styles** (`luckystrike-commack-family` vs `lucky-strike-commack-arcade-wed`). Ids are opaque, but a cleanup needs a coordinated catalog + database migration |

---

## 11. Backlog (ranked)

| Priority | Item | Status |
|---|---|---|
| P1 | Automate the sync: a daily job runs `build_sync_batch.py` on the latest results and writes the batch (needs a Claude scheduled task; Gemini can design the job and its safety checks) | In progress (helper built) |
| P1 | Merge PR #1 so the 6-hour schedule runs | In progress (waiting for the owner) |
| P1 | Strict verification: proximity, negation, verbatim snippet, stale-article guard | Done |
| P1 | Verification expiry (14/30 days) in the app | Done |
| P2 | First-party pages bots can read for AMC and Regal (press releases, help-center or terms pages) | Not started |
| P2 | Screenshot proof when the owner verifies from Instagram or Facebook (artifact `assets` capability) | Not started |
| P2 | Grow Local: 20–30 official "specials" or "events" pages for Suffolk venues in `sources.json` with `official: true` | Not started |
| P2 | OCR for specials posted as images or PDFs, in the GitHub job | Not started |
| P2 | Feed scanner finds into To verify (`--include-new`), with better de-duplication | Not started |
| P3 | Geocode venue addresses outside the app, for real distances | Not started |
| P3 | Time zone per Local deal | Not started |
| P3 | App smoke test: Playwright with a fake `window.claude` serving the catalog | Not started |
| P3 | Workflow actions on Node 24 versions | Done |
| P3 | App Store feasibility note (native wrapper with location and notifications) | Not started |

---

## 12. Suggested first tasks for you

1. **Review the verification logic** in `dealscan.py` (`find_match`, `_snippet`, `verify_catalog`, `_token_rx`) for false passes and false fails. Propose tests for anything you find.
2. **Design the automated sync** so it's safe to run unattended:
   - what it must refuse to do, like mass-demoting deals when a site is down;
   - how it reports to the owner;
   - how it handles owner edits.
3. **Propose 10–20 new Suffolk County deals** that pass section 2's rules, each from the business's own page, in section 6's format.
4. **Propose first-party, bot-readable pages** for AMC and Regal's recurring deals.
5. **Critique the data model** for travel use, for example time zones, multi-window schedules such as Night Strike's different start times, and price variation by location.

---

## 13. Ground rules for any change

- Never mark a deal verified from a third-party listing, and always record how it was verified.
- Never invent a deal or fill a gap with a guess. Unknown hours become `hoursKnown: false`, and doubtful deals go to To verify.
- Keep scanner changes standard-library only, and add tests with every change.
- Keep the app framework-free. Keep both themes and the design tokens, and check phone width in light and dark.
- Respect robots.txt and never log in to a site.

## Sources behind the verified deals

[Rocco's Tacos Taco Tuesday](https://www.roccostacos.com/event/taco-tuesday-huntington/) · [Lucky Strike Commack specials](https://www.luckystrikeent.com/location/lucky-strike-commack/specials) · [Lucky Strike Commack](https://www.luckystrikeent.com/location/lucky-strike-commack) · [Uncle Giuseppe's North Babylon](https://uncleg.com/stores/north-babylon/) · [Salt & Barrel Happy Hour](https://saltandbarrel.com/happy-hours/) · [AMC 50% Off Tuesdays & Wednesdays](https://www.amctheatres.com/50pct-off-tuesdays-and-wednesdays) · [Regal Value Days](https://www.regmovies.com/promotions/regal-value-days) · [Cinemark Discount Tuesdays](https://www.cinemark.com/discounts/discount-tuesdays) · [Dave & Buster's](https://www.daveandbusters.com/us/en/play) · [Buffalo Wild Wings BOGO Days](https://www.buffalowildwings.com/bogo-days/) · [Whole Foods Days of Deals](https://www.wholefoodsmarket.com/days-of-deals)
