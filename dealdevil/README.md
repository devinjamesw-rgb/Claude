# DealDevil

A personal deal finder for Suffolk County: food, happy hours, grocery, coffee and sweets, fun and nightlife, gas and car, shopping and services. It's sorted by what's on right now and how far away it is.

- **App:** `index.html`, published privately on claude.ai at https://claude.ai/artifact/4HPW9b1uDxaRTqPwGLkbxr. Deals live in the page's database. Only the owner can add, edit or delete them.
- **Starter deals:** `seed/deals.seed.json`. These came from web research on Nov 4, 2026, and are marked Unverified until checked in the app.
- **Scanner:** `scanner/`. A standalone deal scanner that reads web pages and feeds and writes deals in the app's format.

## How the app decides what to show

| Status | Meaning |
|---|---|
| `inbox` | Found by the scanner. It waits in the Inbox until you keep or toss it. |
| `unverified` | From a web listing. Nobody has checked it in person yet. |
| `confirmed` | You added it, or you tapped **Still on**. Shows "Checked 3d ago". |
| `gone` | You tapped **It's gone**. It's hidden but can be brought back. |

A deal has days (`0` = Sunday … `6` = Saturday) and an optional `start`/`end` (24-hour `HH:MM`).
- No `start` means all day.
- A `start` with no `end` means "til close".
- An `end` earlier than `start` runs past midnight.
- `hoursKnown: false` shows "check hours".
- `validFrom`/`validUntil` limit it to dates.

Distances are measured from approximate town centers, because the claude.ai page can't use your phone's GPS.

## Scanner

```bash
cd dealdevil/scanner
python3 dealscan.py                       # scan every enabled source in sources.json
python3 dealscan.py --only amf-specials   # one source
python3 dealscan.py --url https://example.com/specials --name "Some Bar" --town Patchogue   # any page, right now
python3 -m unittest test_dealscan.py      # tests
```

It uses only the standard library (Python 3.9+). Each run writes:
- `out/deals.json`: everything it currently sees.
- `out/new.json`: first seen this run.
- `out/report.md`: what happened per source.
- `out/state.json`: memory between runs.

How it works:
1. **Feeds** (RSS/Atom) are read item by item.
2. **Pages** are read for schema.org JSON-LD offers and events, then split into text blocks with their headings.
3. Each block is **scored**:
   - Discount signals count for it: `$5`, `25% off`, BOGO, half price, `$2 off`, free.
   - Deal words count for it: happy hour, special, sale and similar.
   - Schedule clues count for it: days, time ranges, "after 7:30 pm".
   - Navigation, legal text and long price lists count against it.
   - A plain "Mon–Fri 4–7pm" line above a list gives its hours to the deals under it.
4. Survivors are turned into deals with a title, price tag, category, days, hours, last day and a stable id, so the same deal is never counted twice.

It is polite by design:
- It checks robots.txt.
- It waits between requests to the same site.
- It uses ETag / Last-Modified so unchanged pages are skipped.
- It never logs in. Sources marked `requires_login` (like UNiDAYS) are skipped with a note.
- Pages that build their deals with JavaScript need `render: true`, plus `pip install playwright` and the `--render` flag.

**Running it on a schedule:** `.github/workflows/dealdevil-scan.yml` runs it every 6 hours on GitHub Actions and commits the results. GitHub only runs scheduled workflows from the repository's default branch, so this starts once this folder is merged there. You can also start a run by hand from the Actions tab.

**Getting finds into the app:** the published page can't read GitHub (claude.ai pages are sandboxed), so Claude copies `out/new.json` into the app's database with status `inbox`. Ask Claude to "sync DealDevil", or set up a daily scheduled task that does it.
