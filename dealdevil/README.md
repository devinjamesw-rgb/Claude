# DealDevil

A personal deal finder. It has two modes:
- **Local:** verified deals near any US town you pick.
- **Anywhere:** chain-wide deals you can use while traveling, like Whole Foods' $1 oysters on Fridays.

The app lives at https://claude.ai/artifact/4HPW9b1uDxaRTqPwGLkbxr. It's private, and only the owner can add, edit or delete deals.

## The rule

A deal counts only if it names **an item, a price and a day**:
- The day can be specific weekdays, an explicit "daily" from the business, or a specific date.
- "$5 espresso martinis on Fridays" counts.
- "Happy hour 3–6" and "$10 cocktails" don't.

A deal shows in the main list only once it's **verified on the business's own website or socials**. Everything else waits in **To verify**, with the reason and the evidence.

| `verification.status` | Shown | Meaning |
|---|---|---|
| `verified` | Main list | Confirmed on the business's site or socials. `method` says where, `via` says how (`page` = the scanner loaded it, `search` = seen on the business's page through a search check, `you` = you confirmed it) |
| `pending` | To verify | `reason`: `conflict`, `third-party`, `not-on-site`, `scanner-official`, `not-found`, `negated`, `awaiting-page-check`, `unreachable` |

A verified deal also goes back to To verify (reason `stale`) when its `checkedAt` is more than 14 days old for a local deal or 30 days for a chain deal. `verification.snippet` holds the business's own sentence, shown as a quote in the deal's detail. `loyaltyRequired: true` shows a "Free member login" pill.

## Files

| Path | What it is |
|---|---|
| `index.html` | The app (published to claude.ai with `data/places.txt` beside it) |
| `deals/catalog.json` | The curated deals, each with a `verify` block: the business's page and the words that must appear on it |
| `data/places.txt` | About 4,700 US cities with 10,000+ people, plus Suffolk County hamlets, for the town picker (from GeoNames via the geonamescache package) |
| `scanner/` | The scanner: finds new deals and re-checks catalog deals |

## Scanner

```bash
cd dealdevil/scanner
python3 dealscan.py                                   # find new deals from sources.json
python3 dealscan.py --verify ../deals/catalog.json    # re-check every catalog deal on the business's own page
python3 dealscan.py --url https://example.com/specials --name "Some Bar" --town Patchogue
python3 -m unittest test_dealscan.py
```

What it does:
- **Finding.** It reads feeds, schema.org JSON-LD, and page text split by headings. It keeps only blocks that name an item, a price and a day.
- **Every find starts as `pending`**, even from the business's own site, so a person checks the details before it shows.
- **Verifying.** It loads the business's page (with a headless browser when `--render` is set and Playwright is installed).
  - Every token must appear in one block (a paragraph or list item plus its heading), or within 250 characters.
  - Price tokens match exactly, so `$1` doesn't match `$12`. "3 PM" and "3pm" count as the same.
  - "Ended", "expired", "sold out" and similar words near the match fail it.
  - Results go to `out/verification.json` (with the matched snippet and a SHA-256 prefix) and `out/verification.md`. The statuses are `verified`, `not_found`, `not_together`, `expired_or_negated`, `needs_render` and `unreachable`.
- **Stale pages.** Third-party pages that say they were published more than a year ago are skipped.
- **Syncing.** `build_sync_batch.py --db-dir <export> --db-versions <versions.json> --out <dir>` turns the catalog plus `out/verification.json` into ArtifactData batches. It never overwrites a deal the owner verified or removed in the app.
- **Manners.** It honors robots.txt, waits between requests to the same site and never logs in. UNiDAYS and other login-only sites are skipped.

**Schedule:** `.github/workflows/dealdevil-scan.yml` runs both steps on every push to a `claude/*` branch that touches the scanner or catalog, and every 6 hours once it's on the default branch. Claude copies the results into the app's database.
