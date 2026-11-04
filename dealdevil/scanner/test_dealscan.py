"""Tests for the DealDevil scanner. Run: python3 -m unittest test_dealscan.py"""
import datetime as dt
import os
import unittest

import dealscan as ds

HERE = os.path.dirname(os.path.abspath(__file__))
TODAY = dt.date(2026, 11, 4)


def fixture(name):
    with open(os.path.join(HERE, "fixtures", name), encoding="utf-8") as f:
        return f.read()


def by_title(deals, needle):
    hits = [d for d in deals if needle.lower() in (d["item"] + " " + d["details"]).lower()]
    return hits[0] if hits else None


class ParsingTests(unittest.TestCase):
    def test_time_ranges(self):
        self.assertEqual(ds.parse_times("4–7pm"), {"start": "16:00", "end": "19:00"})
        self.assertEqual(ds.parse_times("11-2pm lunch"), {"start": "11:00", "end": "14:00"})
        self.assertEqual(ds.parse_times("9pm-2am"), {"start": "21:00", "end": "02:00"})
        self.assertEqual(ds.parse_times("5:30 p.m. to 7 p.m."), {"start": "17:30", "end": "19:00"})
        self.assertEqual(ds.parse_times("5pm to close"), {"start": "17:00", "end": None})
        self.assertEqual(ds.parse_times("after 7:30 pm"), {"start": "19:30", "end": None})
        self.assertEqual(ds.parse_times("open to close"), {"all_day": True})
        self.assertEqual(ds.parse_times("serves 4-7 people"), {})

    def test_days(self):
        self.assertEqual(ds.parse_days("Mon–Fri"), [1, 2, 3, 4, 5])
        self.assertEqual(ds.parse_days("Tues & Thurs"), [2, 4])
        self.assertEqual(ds.parse_days("Fri-Sun"), [0, 5, 6])
        self.assertEqual(ds.parse_days("every day"), list(range(7)))
        self.assertEqual(ds.parse_days("weekends only"), [0, 6])
        self.assertIsNone(ds.parse_days("sun-dried tomatoes"))

    def test_expiry(self):
        self.assertEqual(ds.parse_expiry("Ends 11/30", TODAY), "2026-11-30")
        self.assertEqual(ds.parse_expiry("valid through Jan 3", TODAY), "2027-01-03")
        self.assertEqual(ds.parse_expiry("offer ends Dec 1, 2026", TODAY), "2026-12-01")

    def test_price_tag(self):
        self.assertEqual(ds.price_tag("Extra 25% off clearance"), "25%")
        self.assertEqual(ds.price_tag("Half-price wings"), "50%")
        self.assertEqual(ds.price_tag("BOGO pizza"), "BOGO")
        self.assertEqual(ds.price_tag("$5 espresso martinis"), "$5")
        self.assertEqual(ds.price_tag("$2 off any pint"), "-$2")
        self.assertEqual(ds.price_tag("Free trivia"), "FREE")

    def test_named_item_rule(self):
        self.assertEqual(ds.item_name("$5 espresso martinis"), "Espresso martinis")
        self.assertTrue(ds.names_an_item("Espresso martinis"))
        self.assertTrue(ds.names_an_item("Bud Light drafts"))
        self.assertTrue(ds.names_an_item("Wings at the bar"))
        self.assertFalse(ds.names_an_item("Cocktails"))
        self.assertFalse(ds.names_an_item("Select drafts and house wine"))
        self.assertFalse(ds.names_an_item("Happy hour drink specials"))
        self.assertFalse(ds.meets_rule("Happy hour 3-6pm", "Happy hour 3-6pm", "Monday-Friday 3-6pm", TODAY))
        self.assertFalse(ds.meets_rule("$10 cocktails", "$10 cocktails", "Tue-Thu 5-7pm", TODAY))
        self.assertFalse(ds.meets_rule("$5 espresso martinis", "$5 espresso martinis", "", TODAY))  # no day
        self.assertTrue(ds.meets_rule("$5 espresso martinis", "$5 espresso martinis", "Fridays", TODAY))
        self.assertTrue(ds.meets_rule("$1 oysters", "$1 oysters daily", "$1 oysters daily", TODAY))


class PageTests(unittest.TestCase):
    def setUp(self):
        self.src = {"id": "salty", "name": "The Salty Dog", "url": "https://example.com/specials", "town": "Patchogue"}
        self.deals = ds.extract_from_html(fixture("bar.html"), self.src["url"], self.src, TODAY)

    def test_happy_hour_list_inherits_section_hours(self):
        d = by_title(self.deals, "espresso martinis")
        self.assertIsNotNone(d)
        self.assertEqual(d["item"], "Espresso martinis")
        self.assertEqual(d["price"], "$5")
        self.assertEqual(d["verification"]["status"], "pending")
        self.assertEqual(d["days"], [1, 2, 3, 4, 5])
        self.assertEqual((d["start"], d["end"]), ("16:00", "19:00"))
        self.assertEqual(d["category"], "happy")
        self.assertEqual(d["town"], "Patchogue")
        w = by_title(self.deals, "half-price wings")
        self.assertIsNotNone(w)
        self.assertEqual(w["price"], "50%")
        self.assertEqual(w["days"], [1, 2, 3, 4, 5])

    def test_weekly_specials(self):
        t = by_title(self.deals, "$2 tacos")
        self.assertEqual(t["days"], [2])
        self.assertTrue(t["hoursKnown"])
        self.assertIsNone(t["start"])
        self.assertEqual(t["category"], "food")
        w = by_title(self.deals, "50% off wings")
        self.assertEqual(w["days"], [4])
        self.assertEqual(w["start"], "20:00")

    def test_generic_deals_are_dropped(self):
        self.assertIsNone(by_title(self.deals, "$6 shots"))       # "shots" names no item
        self.assertIsNone(by_title(self.deals, "$1 off drafts"))  # generic happy hour line
        self.assertIsNone(by_title(self.deals, "house wine"))

    def test_ignores_menu_nav_footer_scripts(self):
        text = " ".join(d["item"] + d["details"] for d in self.deals).lower()
        self.assertNotIn("burger", text)
        self.assertNotIn("sign in", text)
        self.assertNotIn("newsletter", text)
        self.assertNotIn("first order", text)

    def test_ids_are_stable(self):
        again = ds.extract_from_html(fixture("bar.html"), self.src["url"], self.src, TODAY)
        self.assertEqual(sorted(d["id"] for d in self.deals), sorted(d["id"] for d in again))


class StructuredTests(unittest.TestCase):
    def test_jsonld_event(self):
        src = {"id": "blw", "name": "Bridge Lane Wine", "url": "https://example.com/trivia", "town": "Cutchogue"}
        deals = ds.extract_from_html(fixture("event.html"), src["url"], src, TODAY)
        ev = by_title(deals, "trivia night")
        self.assertIsNotNone(ev)
        self.assertEqual(ev["price"], "FREE")
        self.assertEqual(ev["validFrom"], "2026-11-12")
        self.assertEqual(ev["days"], [4])
        self.assertEqual(ev["start"], "19:30")
        self.assertEqual(ev["venue"], "Bridge Lane Wine")
        self.assertEqual(ev["category"], "fun")
        self.assertIsNone(by_title(deals, "old concert"))  # already happened

    def test_feed(self):
        src = {"id": "ex", "name": "Example", "url": "https://example.com/feed"}
        deals = ds.extract_from_feed(fixture("feed.xml"), src["url"], src, TODAY)
        self.assertEqual(len(deals), 1)
        d = deals[0]
        self.assertEqual(d["price"], "25%")
        self.assertEqual(d["validUntil"], "2026-11-30")
        self.assertEqual(d["evidence"][0]["url"], "https://example.com/nike")
        self.assertEqual(d["category"], "shop")


class VerifyTests(unittest.TestCase):
    def test_price_tokens_match_exactly(self):
        page = ds._norm("Fridays: $1 all live oysters, or 12 for $12. Wings $7.50")
        self.assertTrue(ds.token_on_page("$1", page))
        self.assertTrue(ds.token_on_page("$12", page))
        self.assertFalse(ds.token_on_page("$7", page))   # $7.50 is not $7
        self.assertFalse(ds.token_on_page("$2", page))
        self.assertTrue(ds.token_on_page("Oysters", page))

    def test_verify_catalog(self):
        import json, tempfile
        url = "file://" + os.path.join(HERE, "fixtures", "verify_page.html")
        with tempfile.TemporaryDirectory() as tmp:
            cat = os.path.join(tmp, "catalog.json")
            with open(cat, "w") as f:
                json.dump({"deals": [
                    {"id": "oysters", "verify": {"url": url, "tokens": ["$1", "oysters", "Friday"]}},
                    {"id": "wrong-price", "verify": {"url": url, "tokens": ["$2", "oysters"]}},
                    {"id": "no-check", "item": "Something with no business page"},
                ]}, f)
            self.assertEqual(ds.main(["--verify", cat, "--out", tmp, "--min-delay", "0"]), 0)
            with open(os.path.join(tmp, "verification.json")) as f:
                res = json.load(f)["results"]
            self.assertEqual(res["oysters"]["status"], "verified")
            self.assertEqual(res["wrong-price"]["status"], "not_found")
            self.assertEqual(res["wrong-price"]["missing"], ["$2"])
            self.assertNotIn("no-check", res)


class RunTests(unittest.TestCase):
    def test_full_run_tracks_new_deals(self):
        import json, tempfile
        with tempfile.TemporaryDirectory() as tmp:
            src_file = os.path.join(tmp, "sources.json")
            with open(src_file, "w") as f:
                json.dump({"sources": [
                    {"id": "salty", "name": "The Salty Dog", "url": "file://" + os.path.join(HERE, "fixtures", "bar.html"), "town": "Patchogue"},
                    {"id": "needs-login", "name": "Login site", "url": "https://example.com", "requires_login": True},
                ]}, f)
            out = os.path.join(tmp, "out")
            args = ["--sources", src_file, "--out", out, "--today", "2026-11-04", "--min-delay", "0"]
            self.assertEqual(ds.main(args), 0)
            with open(os.path.join(out, "new.json")) as f:
                self.assertGreaterEqual(len(json.load(f)), 5)
            self.assertEqual(ds.main(args), 0)
            with open(os.path.join(out, "new.json")) as f:
                self.assertEqual(json.load(f), [])  # nothing new the second time
            with open(os.path.join(out, "report.md")) as f:
                self.assertIn("needs a login", f.read())


if __name__ == "__main__":
    unittest.main()
