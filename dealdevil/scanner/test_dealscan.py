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
    hits = [d for d in deals if needle.lower() in d["title"].lower()]
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


class PageTests(unittest.TestCase):
    def setUp(self):
        self.src = {"id": "salty", "name": "The Salty Dog", "url": "https://example.com/specials", "town": "Patchogue"}
        self.deals = ds.extract_from_html(fixture("bar.html"), self.src["url"], self.src, TODAY)

    def test_happy_hour_list_inherits_section_hours(self):
        d = by_title(self.deals, "espresso martinis")
        self.assertIsNotNone(d)
        self.assertEqual(d["tag"], "$5")
        self.assertEqual(d["days"], [1, 2, 3, 4, 5])
        self.assertEqual((d["start"], d["end"]), ("16:00", "19:00"))
        self.assertEqual(d["category"], "happy")
        self.assertEqual(d["town"], "Patchogue")
        w = by_title(self.deals, "half-price wings")
        self.assertIsNotNone(w)
        self.assertEqual(w["tag"], "50%")
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
        s = by_title(self.deals, "$6 shots")
        self.assertEqual(s["days"], [5, 6])
        self.assertEqual((s["start"], s["end"]), ("22:00", "02:00"))
        self.assertEqual(s["sourceUrl"], "https://example.com/late")

    def test_ignores_menu_nav_footer_scripts(self):
        text = " ".join(d["title"] + d["details"] for d in self.deals).lower()
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
        self.assertEqual(ev["tag"], "FREE")
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
        self.assertEqual(d["tag"], "25%")
        self.assertEqual(d["validUntil"], "2026-11-30")
        self.assertEqual(d["sourceUrl"], "https://example.com/nike")
        self.assertEqual(d["category"], "shop")


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
            first = json.load(open(os.path.join(out, "new.json")))
            self.assertGreaterEqual(len(first), 5)
            self.assertEqual(ds.main(args), 0)
            self.assertEqual(json.load(open(os.path.join(out, "new.json"))), [])  # nothing new the second time
            report = open(os.path.join(out, "report.md")).read()
            self.assertIn("needs a login", report)


if __name__ == "__main__":
    unittest.main()
