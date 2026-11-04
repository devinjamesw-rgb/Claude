#!/usr/bin/env python3
"""DealDevil scanner.

Checks a list of web pages and feeds for deals and writes what it finds in
DealDevil's deal format. Standard library only, so it runs anywhere Python 3.9+
runs (a laptop, a server, GitHub Actions).

    python3 dealscan.py                         # scan every enabled source in sources.json
    python3 dealscan.py --only lucky-strike     # scan one source
    python3 dealscan.py --url https://example.com/specials --name "Some Bar" --town Patchogue

How it decides something is a deal:
  1. Feeds (RSS/Atom) are read item by item.
  2. Pages are read for schema.org JSON-LD offers and events, then split into
     text blocks (paragraphs, list items, table cells, headings).
  3. Each candidate is scored on discount signals ($ prices, % off, BOGO,
     half price, free), deal words (happy hour, special, sale...), and
     schedule clues (days, time ranges). Navigation and legal text scores down.
  4. Survivors are normalized: title, price tag, category, days, start/end
     times, last day, and a stable id so the same deal is never counted twice.

It respects robots.txt, waits between requests to the same site, sends
conditional requests (ETag / Last-Modified) so unchanged pages are skipped,
and never logs in. Sources that need a login are skipped with a note.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
import xml.etree.ElementTree as ET
import zlib
from html.parser import HTMLParser

USER_AGENT = "DealDevilScanner/1.0 (personal deal tracker; respects robots.txt)"
MAX_BYTES = 3_000_000
TIMEOUT = 20
HERE = os.path.dirname(os.path.abspath(__file__))
I = re.IGNORECASE

# --------------------------------------------------------------------------- text utils

def clean(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def strip_tags(s: str) -> str:
    p = _TextOnly()
    p.feed(s or "")
    p.close()
    return clean("".join(p.out))


class _TextOnly(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []

    def handle_data(self, data):
        self.out.append(data)

    def handle_starttag(self, tag, attrs):
        if tag in ("br", "p", "li", "div"):
            self.out.append(" ")


# --------------------------------------------------------------------------- page parsing

BLOCK_TAGS = {
    "p", "li", "div", "section", "article", "aside", "main", "header", "td", "th", "tr",
    "dd", "dt", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "figcaption", "ul", "ol", "table",
}
SKIP_TAGS = {"script", "style", "noscript", "template", "svg", "nav", "footer", "form", "iframe", "button", "select"}
HEADINGS = {"h1", "h2", "h3", "h4"}


class PageParser(HTMLParser):
    """Splits a page into text blocks, remembering the nearest heading and link."""

    def __init__(self, base_url: str):
        super().__init__(convert_charrefs=True)
        self.base = base_url
        self.blocks: list[dict] = []
        self.jsonld: list[str] = []
        self.title = ""
        self._buf: list[str] = []
        self._links: list[str] = []
        self._skip = 0
        self._heading = ""
        self._hbuf: list[str] | None = None
        self._jbuf: list[str] | None = None
        self._in_title = False
        self._seen_title = False
        self.published: list[str] = []  # publish dates the page states about itself

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta" and a.get("content"):
            key = (a.get("property") or a.get("name") or a.get("itemprop") or "").lower()
            if key in ("article:published_time", "og:published_time", "datepublished", "publish-date", "pubdate"):
                self.published.append(a["content"])
        if tag == "time" and a.get("datetime"):
            cls = (a.get("class") or "").lower()
            if "pubdate" in a or (a.get("itemprop") or "").lower() == "datepublished" or any(k in cls for k in ("publish", "entry-date", "post-date")):
                self.published.append(a["datetime"])
        if tag == "script" and (a.get("type") or "").lower().strip() == "application/ld+json":
            self._jbuf = []
            return
        if tag == "title" and not self._seen_title:
            self._in_title = True
        if tag in SKIP_TAGS:
            self._skip += 1
            return
        if tag in BLOCK_TAGS:
            self._flush()
        if tag in HEADINGS:
            self._hbuf = []
        if tag == "a" and a.get("href") and not self._skip:
            self._links.append(urllib.parse.urljoin(self.base, a["href"]))
        if tag in ("br", "hr"):
            self._buf.append(" ")

    def handle_startendtag(self, tag, attrs):
        if tag in ("br", "hr"):
            self._buf.append(" ")
        elif tag == "meta":  # <meta ... /> carries publish dates
            self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag == "script" and self._jbuf is not None:
            self.jsonld.append("".join(self._jbuf))
            self._jbuf = None
            return
        if tag == "title" and self._in_title:
            self._in_title = False
            self._seen_title = True
        if tag in SKIP_TAGS:
            self._skip = max(0, self._skip - 1)
            return
        if tag in HEADINGS and self._hbuf is not None:
            self._flush()  # flush while still inside the heading, so the block is marked as one
            self._heading = clean("".join(self._hbuf))[:120]
            self._hbuf = None
            return
        if tag in BLOCK_TAGS:
            self._flush()

    def handle_data(self, data):
        if self._jbuf is not None:
            self._jbuf.append(data)
            return
        if self._in_title:
            self.title += data
            return
        if self._skip:
            return
        self._buf.append(data)
        if self._hbuf is not None:
            self._hbuf.append(data)

    def _flush(self):
        text = clean("".join(self._buf))
        if text:
            is_heading = self._hbuf is not None
            self.blocks.append({
                "text": text,
                "heading": "" if is_heading else self._heading,
                "is_heading": is_heading,
                "link": self._links[-1] if self._links else None,
            })
        self._buf = []
        self._links = []

    def close(self):
        super().close()
        self._flush()
        self.title = clean(self.title)


# --------------------------------------------------------------------------- deal signals

SIG_PRICE = re.compile(r"(?<![\w$])\$\s?\d{1,4}(?:\.\d{2})?(?!\d)")
SIG_PCT = re.compile(r"\b(\d{1,2})\s?%\s?(?:off|discount|savings?|back)\b", I)
SIG_DEAL = re.compile(r"\b(half[\s-]?(?:off|price|priced)|bogo|buy one,? get one(?: free| half off)?|2[\s-]?for[\s-]?1|two[\s-]for[\s-]one|b1g1)\b", I)
SIG_OFF = re.compile(r"(?:\$\d+(?:\.\d{2})?|\d{1,3}\s?¢|\d{1,3}\s?cents)\s?off\b", I)
SIG_FREE = re.compile(r"\bfree\b", I)
DEAL_WORDS = re.compile(
    r"\b(happy hours?|specials?|deals?|discounts?|sale|savings?|save|promo(?:tion)?s?|coupons?|"
    r"students?|members? (?:get|save|pay)|unlimited|bottomless|early bird|late night|daily|weekly|"
    r"doorbusters?|clearance|markdowns?|limited time)\b", I)
NOISE = re.compile(
    r"\b(privacy|cookies?|terms of (?:use|service)|subscribe|newsletter|sign (?:in|up)|log ?in|password|"
    r"copyright|all rights reserved|careers?|apply now|gift card balance|shipping policy|accessibility)\b", I)

DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
DAY_RE = r"(sun(?:day)?s?|mon(?:day)?s?|tue(?:s|sday)?s?|wed(?:nesday)?s?|thu(?:r|rs|rsday)?s?|fri(?:day)?s?|sat(?:urday)?s?)"
DAY_RANGE = re.compile(DAY_RE + r"\.?\s*(?:-|–|—|to|thru|through)\s*" + DAY_RE + r"\b", I)
DAY_SINGLE = re.compile(r"\b" + DAY_RE + r"\b\.?", I)
MER = r"(a\.?\s?m\.?|p\.?\s?m\.?)"
TIME_RANGE = re.compile(
    r"\b(\d{1,2})(?::(\d{2}))?\s*" + MER + r"?\s*(?:-|–|—|to|until|till|til)\s*"
    r"(?:(\d{1,2})(?::(\d{2}))?\s*" + MER + r"|(close|closing|midnight))", I)
TIME_FROM = re.compile(r"\b(?:after|from|starting(?: at)?|starts(?: at)?|beginning at)\s+(\d{1,2})(?::(\d{2}))?\s*" + MER, I)
ALL_DAY = re.compile(r"\b(all day|open (?:to|til|till|until) close|all night)\b", I)
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
EXPIRY = re.compile(
    r"\b(?:ends|through|thru|until|till|expires?|valid (?:through|until)|offer ends|last day)\s+(?:on\s+)?"
    r"(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?"
    r"((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?|\d{1,2}/\d{1,2}(?:/\d{2,4})?)", I)

CATEGORY_WORDS = [
    ("happy", r"happy hour|cocktails?|beers?|drafts?|wine|margaritas?|martinis?|sangria|pints?|shots?|well drinks|bar menu|oysters?"),
    ("coffee", r"coffee|latte|espresso|cappuccino|bakery|donuts?|doughnuts?|ice cream|gelato|dessert|pastr(?:y|ies)|cafe|café|cookies?|cupcakes?"),
    ("food", r"tacos?|pizza|wings?|burgers?|lunch|dinner|brunch|breakfast|appetizers?|entr(?:é|e)es?|sushi|bagels?|sandwich(?:es)?|heroes|subs?|kids eat|prix fixe|menu"),
    ("grocery", r"grocery|groceries|supermarket|produce|deli|butcher|circular|market|meat|seafood counter|surprise bags?"),
    ("fun", r"bowling|movies?|cinema|theat(?:er|re)|trivia|karaoke|concerts?|tickets?|arcade|comedy|live music|mini golf|escape room|admission|museum|game night"),
    ("gas", r"\bgas\b|fuel|gallon|car wash|oil change|tires?|auto|detailing"),
    ("shop", r"outlet|sitewide|store ?wide|clothing|apparel|shoes|haircuts?|salon|nails?|gym|fitness|spa|massage|student discount|electronics|laptops?|subscription"),
]
CATEGORY_RES = [(c, re.compile(r"\b(?:" + pat + r")\b", I)) for c, pat in CATEGORY_WORDS]


def signals(text: str) -> dict:
    return {
        "price": SIG_PRICE.findall(text),
        "pct": SIG_PCT.findall(text),
        "deal": SIG_DEAL.findall(text),
        "off": SIG_OFF.findall(text),
        "free": bool(SIG_FREE.search(text)),
        "words": {w.lower() for w in DEAL_WORDS.findall(text)},
        "noise": bool(NOISE.search(text)),
    }


def score(text: str, context: str, sched: dict) -> tuple[int, dict]:
    s = signals(text)
    ctx = signals(context) if context else {"words": set()}
    strong = bool(s["pct"] or s["deal"] or s["off"])
    weak = bool(s["price"] or s["free"])
    words = s["words"] | ctx["words"]
    has_sched = bool(sched.get("days") or sched.get("start") or sched.get("all_day"))
    if not strong and not (weak and (words or has_sched)):
        return 0, s
    pts = 0
    pts += 3 if s["pct"] else 0
    pts += 3 if s["deal"] else 0
    pts += 3 if s["off"] else 0
    pts += 2 if s["price"] else 0
    pts += 1 if s["free"] else 0
    pts += min(2, len(words))
    pts += 1 if has_sched else 0
    if s["noise"]:
        pts -= 3
    if len(text) > 350:
        pts -= 2
    if len(s["price"]) > 4:  # a full price list, not a deal
        pts -= 2
    return pts, s


def parse_days(text: str) -> list[int] | None:
    t = text.lower()
    days: set[int] = set()
    if re.search(r"\b(daily|every ?day|7 days|seven days)\b", t):
        return list(range(7))
    if re.search(r"\bweekdays?\b", t):
        days |= {1, 2, 3, 4, 5}
    if re.search(r"\bweekends?\b", t):
        days |= {0, 6}
    used = []
    for m in DAY_RANGE.finditer(t):
        a, b = _day_index(m.group(1)), _day_index(m.group(2))
        if a is None or b is None:
            continue
        i = a
        while True:
            days.add(i)
            if i == b:
                break
            i = (i + 1) % 7
        used.append(m.span())
    for m in DAY_SINGLE.finditer(t):
        if any(s <= m.start() < e for s, e in used):
            continue
        word = m.group(1)
        # "sun" and "sat" are also English words: count them only next to another day or a time ("Fri & Sat", "Sat 2pm").
        if word in ("sun", "sat"):
            window = t[max(0, m.start() - 14):m.start()] + " " + t[m.end():m.end() + 14]
            if not (DAY_SINGLE.search(window) or re.match(r"\s*\d", t[m.end():])):
                continue
        i = _day_index(word)
        if i is not None:
            days.add(i)
    return sorted(days) if days else None


def _day_index(word: str) -> int | None:
    w = word.lower()[:3]
    return DAY_NAMES.index(w) if w in DAY_NAMES else None


def _to24(h: int, m: int, mer: str | None) -> str | None:
    if mer:
        if not 1 <= h <= 12:
            return None
        pm = mer.lower().startswith("p")
        h = (h % 12) + (12 if pm else 0)
    elif not 0 <= h <= 23:
        return None
    if not 0 <= m <= 59:
        return None
    return f"{h:02d}:{m:02d}"


def parse_times(text: str) -> dict:
    if ALL_DAY.search(text):
        return {"all_day": True}
    m = TIME_RANGE.search(text)
    if m:
        h1, m1, mer1, h2, m2, mer2, close = m.groups()
        if close and close.lower().startswith("midnight"):
            h2, m2, mer2, close = "12", "00", "am", None
        if close:
            start = _to24(int(h1), int(m1 or 0), mer1 or ("pm" if 1 <= int(h1) <= 11 else None))
            return {"start": start, "end": None} if start else {}
        if mer1 is None and mer2 is not None:
            # "4-7pm": the first time borrows the second's am/pm unless that makes it later
            mer1 = mer2
            if int(h1) % 12 > int(h2) % 12 and mer2.lower().startswith("p"):
                mer1 = "am"
        start, end = _to24(int(h1), int(m1 or 0), mer1), _to24(int(h2), int(m2 or 0), mer2)
        if start and end:
            return {"start": start, "end": end}
    m = TIME_FROM.search(text)
    if m:
        start = _to24(int(m.group(1)), int(m.group(2) or 0), m.group(3))
        if start:
            return {"start": start, "end": None}
    return {}


def parse_expiry(text: str, today: dt.date) -> str | None:
    m = EXPIRY.search(text)
    if not m:
        return None
    raw = m.group(1).lower().replace(",", " ")
    try:
        if "/" in raw:
            parts = [int(p) for p in raw.split("/")]
            mon, day = parts[0], parts[1]
            year = parts[2] if len(parts) > 2 else None
            if year is not None and year < 100:
                year += 2000
        else:
            bits = raw.replace(".", " ").split()
            mon = MONTHS[bits[0][:3]]
            day = int(re.sub(r"\D", "", bits[1]))
            year = int(bits[2]) if len(bits) > 2 and bits[2].isdigit() else None
        if year is None:
            year = today.year
            if dt.date(year, mon, day) < today - dt.timedelta(days=30):
                year += 1
        return dt.date(year, mon, day).isoformat()
    except (ValueError, KeyError, IndexError):
        return None


def price_tag(text: str) -> str:
    m = SIG_PCT.search(text)
    if m:
        return f"{m.group(1)}%"
    low = text.lower()
    if re.search(r"half[\s-]?(off|price)", low):
        return "50%"
    if re.search(r"\bbogo\b|buy one,? get one|b1g1", low):
        return "BOGO"
    if re.search(r"\b2[\s-]?for[\s-]?1\b|two[\s-]for[\s-]one", low):
        return "2-FOR-1"
    m = SIG_OFF.search(text)
    if m:
        v = re.sub(r"\s?off", "", m.group(0), flags=I).replace(" ", "")
        v = re.sub(r"cents?$", "¢", v, flags=I)
        return ("-" + v)[:7]
    m = SIG_PRICE.search(text)
    if m:
        return m.group(0).replace(" ", "")[:7]
    if SIG_FREE.search(text):
        return "FREE"
    if re.search(r"happy hour", low):
        return "HH"
    return "DEAL"


def guess_category(text: str, fallback: str | None) -> str:
    best, best_n = None, 0
    for cat, rx in CATEGORY_RES:
        n = len(rx.findall(text))
        if n > best_n:
            best, best_n = cat, n
    return best or fallback or "shop"


def make_title(text: str, heading: str) -> str:
    parts = [clean(p) for p in re.split(r"(?<=[.!?;])\s+|\s[|•·]\s|\s{2,}", text) if clean(p)]
    def strength(p):
        s = signals(p)
        return (3 * bool(s["pct"] or s["deal"] or s["off"])) + (2 * bool(s["price"])) + bool(s["free"]) + len(s["words"])
    best = max(parts, key=strength) if parts else text
    if len(best) < 14 and heading and heading.lower() not in best.lower():
        best = f"{heading}: {best}"
    best = best.strip(" -–—:;,.")
    if len(best) > 90:
        cut = best[:88].rsplit(" ", 1)[0]
        best = cut.rstrip(" ,;:-") + "…"
    return best[:1].upper() + best[1:]


# Words that don't name an item on their own. "$10 cocktails" or "$1 off drafts" fails the rule;
# "$5 espresso martinis" or "$3 Bud Light drafts" passes.
GENERIC = set("""
and with for our any all the from only get each per off price priced half day days night nights daily every weekly week
special specials deal deals discount discounts save savings sale happy hour hours menu bar drinks drink cocktails cocktail
beer beers wine wines apps appetizers appetizer app food select well drafts draft bottles bottle shots shot mixed everything
items item entrees entree desserts dessert house order orders purchase until til till close great new more also plus including
included available served serving start starts starting enjoy join you your today tonight weekday weekdays weekend weekends
late early bird seasonal signature specialty premium domestic imported craft local tap taps pint pints glass glasses
round rounds bucket buckets pitcher pitchers liquor spirits booze bites snacks small plates plate offer offers promo promotion
sunday monday tuesday wednesday thursday friday saturday sundays mondays tuesdays wednesdays thursdays fridays saturdays
""".split())
PRICE_BITS = re.compile(
    r"\$\s?\d+(?:\.\d{2})?(?:\s?off)?|\b\d{1,3}\s?%\s?(?:off|discount)?|\bhalf[\s-]?(?:off|price|priced)\b|\bbogo\b|"
    r"\bbuy one,? get one(?: free| half off)?\b|\b2[\s-]?for[\s-]?1\b|\bfree\b|\d+\s?(?:¢|cents)\s?off", I)


def item_name(title: str) -> str:
    """'$5 espresso martinis' -> 'Espresso martinis'; '$6 shots, 10pm-2am Fri & Sat' -> 'Shots'."""
    t = PRICE_BITS.sub(" ", title)
    t = TIME_RANGE.sub(" ", t)
    t = TIME_FROM.sub(" ", t)
    t = DAY_RANGE.sub(" ", t)
    t = DAY_SINGLE.sub(" ", t)
    t = re.sub(r"\b(every|all day|daily|on|from|after|at the bar|each|only|special|deal)\b", " ", t, flags=I)
    t = re.sub(r"\s*[:;,|•·]\s*", " ", t)
    t = clean(re.sub(r"(^|\s)[-–—&+]+(\s|$)", " ", t)).strip(" -–—&+.,")
    return t[:1].upper() + t[1:] if t else ""


def names_an_item(item: str) -> bool:
    words = re.findall(r"[a-z][a-z'’&-]+", item.lower())
    return any(len(w) >= 3 and w.strip("'’-") not in GENERIC for w in words)


def has_named_price(text: str) -> bool:
    s = signals(text)
    return bool(s["price"] or s["pct"] or s["deal"] or s["off"] or s["free"])


def fingerprint(source_id: str, title: str, venue: str) -> str:
    norm = re.sub(r"[^a-z0-9$%]+", " ", f"{source_id}|{venue}|{title}".lower()).strip()
    return "scan-" + hashlib.sha1(norm.encode()).hexdigest()[:12]


# --------------------------------------------------------------------------- extraction

def build_deal(text: str, heading: str, schedule_text: str, link: str | None, src: dict, today: dt.date,
               score_pts: int, venue: str | None = None, title: str | None = None, extra: dict | None = None) -> dict:
    days = parse_days(schedule_text)
    times = parse_times(schedule_text)
    full = f"{heading} {text}".strip()
    venue = venue or src.get("venue") or src.get("name") or ""
    title = title or make_title(text, heading)
    official = bool(src.get("official"))
    label = src.get("name") or urllib.parse.urlparse(src["url"]).hostname
    deal = {
        "id": fingerprint(src["id"], title, venue),
        "scope": src.get("scope", "local"),
        "item": item_name(title) or title,
        "price": price_tag(full),
        "venue": venue,
        "town": src.get("town", ""),
        "state": src.get("state", ""),
        "category": src.get("category") or guess_category(full, src.get("category_fallback")),
        "days": days or list(range(7)),
        "start": times.get("start"),
        "end": times.get("end"),
        "hoursKnown": bool(times),
        "validUntil": parse_expiry(full, today),
        "conditions": [],
        "details": text if len(text) <= 400 else text[:397] + "…",
        "businessUrl": src["url"] if official else None,
        # Nothing the scanner finds is shown as verified until a person checks the details.
        "verification": {
            "status": "pending",
            "reason": "scanner-official" if official else "third-party",
            "checkedAt": today.isoformat(),
            "note": ("Found on the business's own site by the scanner. Check the details, then mark it verified."
                     if official else "Found by the scanner on a third-party site. Confirm it on the business's own site or socials."),
        },
        "evidence": [{"label": label, "url": link or src["url"], "kind": "business" if official else "third-party"}],
        "status": "active",
        "addedBy": "scanner",
        "scanSource": src["id"],
        "score": score_pts,
        "foundAt": today.isoformat(),
    }
    if not days and not times:
        deal["hoursKnown"] = False
    if extra:
        deal.update({k: v for k, v in extra.items() if v is not None})
    return deal


def meets_rule(title: str, full: str, schedule_text: str, today: dt.date) -> bool:
    """Named item + named price + named day (weekdays, an explicit 'daily', or a dated deal)."""
    named_day = bool(parse_days(schedule_text) or parse_expiry(full, today))
    return named_day and has_named_price(full) and names_an_item(item_name(title) or "")


def published_date(p: "PageParser") -> dt.date | None:
    """The newest publish date the page states: article:published_time, <time pubdate>, or JSON-LD datePublished."""
    raw = list(p.published)
    for blob in p.jsonld:
        try:
            for node in _walk_json(json.loads(blob.strip())):
                if node.get("datePublished"):
                    raw.append(str(node["datePublished"]))
        except (ValueError, TypeError, AttributeError):
            continue
    dates = []
    for r in raw:
        mt = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(r).strip())
        if mt:
            try:
                dates.append(dt.date(int(mt.group(1)), int(mt.group(2)), int(mt.group(3))))
            except ValueError:
                pass
    return max(dates) if dates else None


def extract_from_html(html_text: str, url: str, src: dict, today: dt.date) -> list[dict]:
    p = PageParser(url)
    try:
        p.feed(html_text)
        p.close()
    except Exception:  # malformed markup: keep whatever was parsed
        pass
    if not src.get("official"):  # third-party and news pages older than a year are not evidence of anything current
        pub = published_date(p)
        if pub and (today - pub).days > 365:
            src["_stale"] = pub.isoformat()
            return []
    deals = extract_from_jsonld(p.jsonld, url, src, today)
    blocks = [b for b in p.blocks if not b["is_heading"] or len(b["text"]) < 120]
    include = re.compile(src["include"], I) if src.get("include") else None
    exclude = re.compile(src["exclude"], I) if src.get("exclude") else None
    seen_text = set()
    section, section_sched = None, ""
    for i, b in enumerate(blocks):
        text = b["text"]
        if b["heading"] != section:  # new section: forget the old section's hours
            section, section_sched = b["heading"], ""
        if text in seen_text or len(text) < 6:
            continue
        seen_text.add(text)
        prev_t = blocks[i - 1]["text"] if i > 0 and len(blocks[i - 1]["text"]) < 140 else ""
        next_t = blocks[i + 1]["text"] if i + 1 < len(blocks) and len(blocks[i + 1]["text"]) < 140 else ""
        own_sched = parse_days(text) or parse_times(text)
        context = f"{b['heading']} {prev_t}"
        # The deal's own days/hours win; otherwise use the section's ("Happy Hour: Mon-Fri 4-7pm" above a list).
        schedule_text = f"{b['heading']} {text}" if own_sched else f"{b['heading']} {section_sched} {prev_t} {text} {next_t}"
        if include and not include.search(f"{context} {text}"):
            continue
        if exclude and exclude.search(text):
            continue
        sched = {"days": parse_days(schedule_text), **parse_times(schedule_text)}
        pts, _ = score(text, context, sched)
        if pts < src.get("min_score", 3):
            if own_sched and len(text) < 100 and not b["is_heading"]:
                section_sched = text  # a plain "Monday – Friday, 4–7pm" line applies to the deals below it
            continue
        if not meets_rule(make_title(text, b["heading"]), f"{b['heading']} {text}", schedule_text, today):
            continue
        deals.append(build_deal(text, b["heading"], schedule_text, b["link"] or url, src, today, pts))
    return deals


def _walk_json(obj):
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from _walk_json(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk_json(v)


def extract_from_jsonld(blobs: list[str], url: str, src: dict, today: dt.date) -> list[dict]:
    out = []
    for blob in blobs:
        try:
            data = json.loads(blob.strip())
        except (ValueError, TypeError):
            continue
        for node in _walk_json(data):
            types = node.get("@type")
            types = {t.lower() for t in (types if isinstance(types, list) else [types]) if isinstance(t, str)}
            if not types & {"offer", "aggregateoffer", "event", "product", "saleevent", "foodevent", "socialevent", "musicevent", "comedyevent"}:
                continue
            offers = node.get("offers")
            offer = offers[0] if isinstance(offers, list) and offers else offers if isinstance(offers, dict) else (node if "offer" in types else None)
            if not offer and "event" not in " ".join(types):
                continue
            name = clean(str(node.get("name") or ""))
            desc = strip_tags(str(node.get("description") or ""))[:300]
            price = offer.get("price") if isinstance(offer, dict) else None
            text = clean(f"{name}. {desc}")
            tag_text = text
            if price not in (None, ""):
                try:
                    pv = float(str(price).replace("$", "").replace(",", ""))
                    tag_text = ("FREE " if pv == 0 else f"${pv:g} ") + text
                except ValueError:
                    pass
            if not name:
                continue
            start = str(node.get("startDate") or "")
            extra = {}
            sched_text = text
            if re.match(r"\d{4}-\d{2}-\d{2}", start):
                d0 = dt.date.fromisoformat(start[:10])
                if d0 < today:
                    continue
                extra = {"validFrom": d0.isoformat(), "validUntil": d0.isoformat(), "days": [(d0.weekday() + 1) % 7]}
                if len(start) >= 16 and start[10] == "T":
                    extra["start"] = start[11:16]
                    extra["hoursKnown"] = True
            loc = node.get("location") if isinstance(node.get("location"), dict) else {}
            venue = clean(str(loc.get("name") or "")) or None
            if not extra.get("days") and not parse_days(sched_text):
                continue  # no named day
            if not names_an_item(name) or not has_named_price(tag_text):
                continue
            deal = build_deal(text, "", sched_text, str(node.get("url") or url), src, today, 5, venue=venue, title=make_title(name, ""), extra=extra)
            deal["price"] = price_tag(tag_text)
            deal["item"] = name
            out.append(deal)
    return out


def extract_from_feed(xml_text: str, url: str, src: dict, today: dt.date) -> list[dict]:
    try:
        root = ET.fromstring(xml_text.encode("utf-8", "ignore"))
    except ET.ParseError:
        return []
    items = []
    for el in root.iter():
        tag = el.tag.split("}")[-1].lower()
        if tag not in ("item", "entry"):
            continue
        def get(*names):
            # Elements with no children are falsy, so compare with None explicitly.
            for name in names:
                found = next((c for c in el if c.tag.split("}")[-1].lower() == name), None)
                if found is not None:
                    return found
            return None
        title_el, desc_el = get("title"), get("description", "summary", "content")
        link_el = get("link")
        link = None
        if link_el is not None:
            link = link_el.get("href") or (link_el.text or "").strip()
        title = clean(title_el.text if title_el is not None and title_el.text else "")
        desc = strip_tags(desc_el.text if desc_el is not None and desc_el.text else "")[:300]
        if title:
            items.append((title, desc, link))
    deals = []
    for title, desc, link in items[: src.get("limit", 40)]:
        text = clean(f"{title}. {desc}")
        sched = {"days": parse_days(text), **parse_times(text)}
        pts, _ = score(text, "", sched)
        if not src.get("trust") and pts < src.get("min_score", 3):
            continue
        if not meets_rule(title, text, text, today):
            continue
        deals.append(build_deal(text, "", text, link or url, src, today, max(pts, 3), title=make_title(title, "")))
    return deals


# --------------------------------------------------------------------------- fetching

class Fetcher:
    def __init__(self, min_delay: float, http_state: dict):
        self.min_delay = min_delay
        self.last_hit: dict[str, float] = {}
        self.robots: dict[str, urllib.robotparser.RobotFileParser | str] = {}
        self.http_state = http_state

    def _open(self, url: str, headers: dict | None = None):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip, deflate",
                                                   "Accept": "text/html,application/xhtml+xml,application/xml,application/rss+xml,application/json;q=0.9,*/*;q=0.5",
                                                   **(headers or {})})
        return urllib.request.urlopen(req, timeout=TIMEOUT)

    def allowed(self, url: str) -> tuple[bool, str]:
        parts = urllib.parse.urlparse(url)
        if parts.scheme == "file":
            return True, ""
        host = f"{parts.scheme}://{parts.netloc}"
        rp = self.robots.get(host)
        if rp is None:
            rp = urllib.robotparser.RobotFileParser()
            try:
                self._wait(parts.netloc)
                with self._open(host + "/robots.txt") as r:
                    rp.parse(self._decode(r).splitlines())
            except urllib.error.HTTPError as e:
                if e.code in (401, 403):
                    rp = "blocked"
                else:
                    rp.parse([])  # no robots.txt: everything allowed
            except Exception as e:  # network failure: don't guess
                self.robots[host] = f"error: {e}"
                return False, f"couldn't read robots.txt ({e})"
            self.robots[host] = rp
        if isinstance(rp, str):
            return False, "robots.txt refused" if rp == "blocked" else rp
        if not rp.can_fetch(USER_AGENT, url):
            return False, "robots.txt disallows this page"
        return True, ""

    def _wait(self, netloc: str):
        rp = self.robots.get(netloc)
        delay = self.min_delay
        if isinstance(rp, urllib.robotparser.RobotFileParser):
            cd = rp.crawl_delay(USER_AGENT)
            if cd:
                delay = max(delay, float(cd))
        gap = time.time() - self.last_hit.get(netloc, 0)
        if gap < delay:
            time.sleep(delay - gap)
        self.last_hit[netloc] = time.time()

    @staticmethod
    def _decode(resp) -> str:
        raw = resp.read(MAX_BYTES + 1)[:MAX_BYTES]
        enc = (resp.headers.get("Content-Encoding") or "").lower()
        if enc == "gzip":
            raw = gzip.decompress(raw)
        elif enc == "deflate":
            try:
                raw = zlib.decompress(raw)
            except zlib.error:
                raw = zlib.decompress(raw, -zlib.MAX_WBITS)
        charset = resp.headers.get_content_charset() or "utf-8"
        return raw.decode(charset, "replace")

    def get(self, url: str) -> tuple[str, str | None, str]:
        """Returns (status, body, content_type). status is ok | not_modified | error text."""
        parts = urllib.parse.urlparse(url)
        if parts.scheme not in ("http", "https", "file"):
            return "unsupported URL scheme", None, ""
        ok, why = self.allowed(url)
        if not ok:
            return why, None, ""
        cond = {}
        prev = self.http_state.get(url, {})
        if prev.get("etag"):
            cond["If-None-Match"] = prev["etag"]
        if prev.get("last_modified"):
            cond["If-Modified-Since"] = prev["last_modified"]
        try:
            if parts.scheme != "file":
                self._wait(parts.netloc)
            with self._open(url, cond) as r:
                body = self._decode(r)
                ctype = (r.headers.get("Content-Type") or "").lower()
                self.http_state[url] = {"etag": r.headers.get("ETag"), "last_modified": r.headers.get("Last-Modified"),
                                        "checked": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
                return "ok", body, ctype
        except urllib.error.HTTPError as e:
            if e.code == 304:
                return "not_modified", None, ""
            return f"HTTP {e.code}", None, ""
        except Exception as e:
            return f"failed: {e.__class__.__name__}: {e}", None, ""


def render_with_browser(url: str) -> str | None:
    """Optional: pages that build their deals with JavaScript. Needs `pip install playwright`."""
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except ImportError:
        return None
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                page = browser.new_page(user_agent=USER_AGENT)
                # "networkidle" never arrives on pages with endless trackers; load the DOM, then give scripts a moment.
                page.goto(url, wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(3000)
                return page.content()
            finally:
                browser.close()
    except Exception as e:  # a slow or hostile page must never stop the run
        print(f"  (headless render failed for {url}: {e.__class__.__name__})", file=sys.stderr)
        return None


def looks_like_feed(body: str, ctype: str) -> bool:
    head = body.lstrip()[:300].lower()
    return "rss" in ctype or "atom" in ctype or head.startswith("<?xml") and ("<rss" in head or "<feed" in head) or head.startswith("<rss") or head.startswith("<feed")


# --------------------------------------------------------------------------- runner

def scan_source(src: dict, fetcher: Fetcher, today: dt.date, allow_render: bool) -> tuple[str, list[dict] | None]:
    if src.get("requires_login"):
        return "skipped: needs a login (" + src.get("note", "the scanner never logs in") + ")", []
    status, body, ctype = fetcher.get(src["url"])
    if status == "not_modified":
        return "unchanged since last scan", None
    if status != "ok" or body is None:
        return status, []
    kind = src.get("type", "auto")
    if kind == "rss" or (kind == "auto" and looks_like_feed(body, ctype)):
        deals = extract_from_feed(body, src["url"], src, today)
    else:
        if src.get("render") and allow_render:
            rendered = render_with_browser(src["url"])
            if rendered:
                body = rendered
        deals = extract_from_html(body, src["url"], src, today)
        if src.get("_stale"):
            return f"skipped: page published {src.pop('_stale')}, over a year ago", []
    # dedupe within source, best score first, cap
    best: dict[str, dict] = {}
    for d in sorted(deals, key=lambda d: -d["score"]):
        best.setdefault(d["id"], d)
    capped = list(best.values())[: src.get("limit", 25)]
    note = f"{len(capped)} deals"
    if not capped and src.get("render") and not allow_render:
        note += " (this page loads deals with JavaScript; run with --render and Playwright installed)"
    return note, capped


def load_json(path: str, fallback):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return fallback


def write_json(path: str, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


# --------------------------------------------------------------------------- verification

def _parse(body: str) -> "PageParser":
    p = PageParser("about:blank")
    try:
        p.feed(body)
        p.close()
    except Exception:
        pass
    return p


def page_text(body: str) -> str:
    p = _parse(body)
    return " ".join([p.title] + [b["text"] for b in p.blocks] + [strip_tags(j) for j in p.jsonld])


def _clean(s: str) -> str:
    """Normalize spacing, dashes and am/pm ("3 PM", "3 p.m." -> "3pm") without changing case."""
    s = (s or "").replace("–", "-").replace("—", "-").replace("\xa0", " ").replace("’", "'")
    s = re.sub(r"(\d)\s*([AaPp])\.?\s?[Mm]\.?(?![A-Za-z])", lambda m: m.group(1) + m.group(2).lower() + "m", s)
    return re.sub(r"\s+", " ", s).strip()


def _norm(s: str) -> str:
    return _clean(s).lower()


def _token_rx(token: str):
    t = _norm(token)
    if re.match(r"^\$?\d", t):  # prices and numbers: "$1" must not match "$12" or "$1.50"
        return re.compile(r"(?<![\d.])" + re.escape(t) + r"(?!\.?\d)")
    return re.compile(re.escape(t))


def token_on_page(token: str, page: str) -> bool:
    return _token_rx(token).search(_norm(page)) is not None


# Words near a match that mean the deal is over.
NEGATION = re.compile(r"\b(expired|has ended|have ended|ended|no longer available|no longer offered|no longer valid|sold out|discontinued)\b", I)
VERIFY_WINDOW = 250


def page_blocks(body: str) -> list[str]:
    """The page as blocks of text, each list item or paragraph carrying the heading above it."""
    p = _parse(body)
    out = [p.title] if p.title else []
    for b in p.blocks:
        out.append(f"{b['heading']} · {b['text']}" if b["heading"] and not b["is_heading"] else b["text"])
    out += [strip_tags(j) for j in p.jsonld]
    return [c for c in (_clean(x) for x in out) if c]


def find_match(tokens: list[str], blocks: list[str], window: int = VERIFY_WINDOW) -> dict | None:
    """All tokens inside one block, or else inside one stretch of at most `window` characters."""
    rxs = [_token_rx(t) for t in tokens]
    for b in blocks:
        low = b.lower()
        hits = [r.search(low) for r in rxs]
        if all(hits):
            return {"scope": "block", "text": b, "lo": min(h.start() for h in hits), "hi": max(h.end() for h in hits)}
    full = " · ".join(blocks)
    low = full.lower()
    occ = [[(m.start(), m.end()) for m in r.finditer(low)] for r in rxs]
    if not all(occ):
        return None
    best = None
    for s0, e0 in occ[0]:
        lo, hi = s0, e0
        for o in occ[1:]:
            q = min(o, key=lambda se: max(hi, se[1]) - min(lo, se[0]))
            lo, hi = min(lo, q[0]), max(hi, q[1])
        if hi - lo <= window and (best is None or hi - lo < best[1] - best[0]):
            best = (lo, hi)
    return {"scope": "window", "text": full, "lo": best[0], "hi": best[1]} if best else None


def _snippet(m: dict, size: int = 240) -> str:
    text, lo, hi = m["text"], m["lo"], m["hi"]
    start = lo if hi - lo >= size else max(0, lo - (size - (hi - lo)) // 2)
    s = text[start:start + size].strip()
    return ("…" if start > 0 else "") + s + ("…" if start + size < len(text) else "")


def verify_catalog(path: str, out_dir: str, min_delay: float, allow_render: bool) -> int:
    """Re-check each catalog deal against the business's own page. Writes verification.json and verification.md."""
    cat = load_json(path, None)
    if cat is None:
        print(f"Couldn't read {path}", file=sys.stderr)
        return 2
    os.makedirs(out_dir, exist_ok=True)
    fetcher = Fetcher(min_delay, {})  # always a fresh read: verification never trusts a cache
    pages: dict[str, tuple[str, str]] = {}
    results = {}
    for d in cat.get("deals", []):
        v = d.get("verify") or {}
        url, tokens = v.get("url"), v.get("tokens") or []
        if not url or not tokens:
            continue
        if url not in pages:
            status, body, _ = fetcher.get(url)
            pages[url] = (status, page_blocks(body) if body else [])
        status, blocks = pages[url]
        m = find_match(tokens, blocks) if status == "ok" else None
        if status == "ok" and not m and allow_render and not url.startswith("file:"):
            html = render_with_browser(url)
            if html:
                pages[url] = (status, page_blocks(html))
                blocks = pages[url][1]
                m = find_match(tokens, blocks)
        alltext = " ".join(blocks).lower()
        missing = [t for t in tokens if not _token_rx(t).search(alltext)]
        if status != "ok":
            res = {"status": "unreachable", "reason": status}
        elif m:
            snip = _snippet(m)
            region = m["text"][max(0, m["lo"] - 120): m["hi"] + 120].lower()
            neg = NEGATION.search(region)
            if neg:
                res = {"status": "expired_or_negated", "reason": f'the matched text says "{neg.group(0)}"', "matchedSnippet": snip}
            else:
                res = {"status": "verified", "matchScope": m["scope"], "matchedSnippet": snip,
                       "snippetHash": hashlib.sha256(snip.encode("utf-8")).hexdigest()[:16]}
        elif len(alltext) < 300:
            res = {"status": "needs_render", "missing": missing, "reason": "page text is nearly empty; it probably loads with JavaScript"}
        elif missing:
            res = {"status": "not_found", "missing": missing}
        else:
            res = {"status": "not_together", "reason": f"every word is on the page, but not within one block or {VERIFY_WINDOW} characters"}
        res.update({"url": url, "tokens": tokens, "checkedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")})
        results[d["id"]] = res
        print(f"  {d['id']:<34} {res['status']}{' (' + res.get('reason', '') + ')' if res.get('reason') else ''}", file=sys.stderr)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    write_json(os.path.join(out_dir, "verification.json"), {"generatedAt": stamp, "results": results})
    counts: dict[str, int] = {}
    for r in results.values():
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    lines = [f"# DealDevil verification, {stamp}", "", ", ".join(f"{n} {k.replace('_', ' ')}" for k, n in sorted(counts.items())) or "Nothing to check.", "",
             "| Deal | Result | Business page |", "|---|---|---|"]
    for did, r in results.items():
        extra = r.get("reason") or (("missing: " + ", ".join(r["missing"])) if r.get("missing") else "")
        lines.append(f"| {did} | {r['status'].replace('_', ' ')}{' (' + extra.replace('|', '/') + ')' if extra else ''} | [{urllib.parse.urlparse(r['url']).hostname or 'file'}]({r['url']}) |")
    with open(os.path.join(out_dir, "verification.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Checked {len(results)} deals: {counts}", file=sys.stderr)
    return 0


def run(args) -> int:
    if args.verify:
        return verify_catalog(args.verify, args.out, args.min_delay, args.render)
    today = dt.date.fromisoformat(args.today) if args.today else dt.date.today()
    if args.url:
        sources = [{"id": "adhoc", "name": args.name or urllib.parse.urlparse(args.url).hostname, "url": args.url,
                    "town": args.town or "", "category": args.category, "trust": False}]
    else:
        cfg = load_json(args.sources, None)
        if cfg is None:
            print(f"Couldn't read {args.sources}", file=sys.stderr)
            return 2
        sources = [s for s in cfg.get("sources", []) if s.get("enabled", True)]
        if args.only:
            wanted = set(args.only.split(","))
            sources = [s for s in cfg.get("sources", []) if s["id"] in wanted]
    os.makedirs(args.out, exist_ok=True)
    state = load_json(os.path.join(args.out, "state.json"), {"seen": {}, "http": {}})
    previous = {d["id"]: d for d in load_json(os.path.join(args.out, "deals.json"), [])}
    fetcher = Fetcher(args.min_delay, {} if args.url or args.fresh else state.setdefault("http", {}))
    report, current, new = [], {}, []
    for src in sources:
        src.setdefault("id", re.sub(r"[^a-z0-9]+", "-", src.get("name", src["url"]).lower()).strip("-"))
        t0 = time.time()
        try:
            note, deals = scan_source(src, fetcher, today, args.render)
        except Exception as e:  # one broken source never stops the others
            note, deals = f"failed: {e.__class__.__name__}: {e}", []
        if deals is None:  # unchanged: carry forward what we had
            deals = [d for d in previous.values() if d.get("scanSource") == src["id"]]
        for d in deals:
            current[d["id"]] = d
        report.append({"source": src["id"], "url": src["url"], "result": note, "deals": len(deals), "seconds": round(time.time() - t0, 1)})
        print(f"  {src['id']:<28} {note}", file=sys.stderr)
    seen = state.setdefault("seen", {})
    for did, d in current.items():
        rec = seen.get(did)
        if rec is None:
            seen[did] = {"first": today.isoformat(), "last": today.isoformat()}
            new.append(d)
        else:
            rec["last"] = today.isoformat()
    cutoff = (today - dt.timedelta(days=args.forget_days)).isoformat()
    for did in [k for k, v in seen.items() if v.get("last", "") < cutoff]:
        del seen[did]
    deals_out = sorted(current.values(), key=lambda d: (d["scanSource"], -d["score"], d["item"]))
    if args.url or args.dry_run:
        print(json.dumps(deals_out, indent=1, ensure_ascii=False))
        return 0
    write_json(os.path.join(args.out, "deals.json"), deals_out)
    write_json(os.path.join(args.out, "new.json"), new)
    write_json(os.path.join(args.out, "state.json"), state)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [f"# DealDevil scan, {stamp}", "", f"{len(deals_out)} deals found, {len(new)} new since last scan.", "",
             "| Source | Result | Deals |", "|---|---|---|"]
    lines += [f"| [{r['source']}]({r['url']}) | {r['result'].replace('|', '/')} | {r['deals']} |" for r in report]
    if new:
        lines += ["", "## New this scan", ""] + [f"- **{d['price']}** {d['item']} at {d['venue']} ([source]({d['evidence'][0]['url']}))" for d in new[:60]]
    with open(os.path.join(args.out, "report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"{len(deals_out)} deals, {len(new)} new. Wrote {args.out}/deals.json, new.json, report.md", file=sys.stderr)
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Scan websites and feeds for deals, in DealDevil's format.")
    ap.add_argument("--sources", default=os.path.join(HERE, "sources.json"), help="sources file (default: sources.json next to this script)")
    ap.add_argument("--out", default=os.path.join(HERE, "out"), help="output folder (default: out/ next to this script)")
    ap.add_argument("--only", help="comma-separated source ids to scan, even if disabled")
    ap.add_argument("--url", help="scan one page or feed right now and print the deals")
    ap.add_argument("--name", help="with --url: the venue or site name")
    ap.add_argument("--town", help="with --url: the town, for distance in DealDevil")
    ap.add_argument("--category", help="with --url: force a category (food, happy, grocery, coffee, fun, gas, shop)")
    ap.add_argument("--verify", metavar="CATALOG", help="re-check each deal in a catalog file against the business's own page")
    ap.add_argument("--render", action="store_true", help="use a headless browser for sources marked render:true (needs Playwright)")
    ap.add_argument("--min-delay", type=float, default=3.0, help="seconds between requests to the same site (default 3)")
    ap.add_argument("--forget-days", type=int, default=21, help="forget deals not seen for this many days (default 21)")
    ap.add_argument("--fresh", action="store_true", help="ignore saved ETags and re-read every page")
    ap.add_argument("--dry-run", action="store_true", help="print results instead of writing files")
    ap.add_argument("--today", help=argparse.SUPPRESS)
    return run(ap.parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())
