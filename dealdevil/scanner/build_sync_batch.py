#!/usr/bin/env python3
"""Turn the catalog plus the scanner's results into DealDevil database writes.

    python3 build_sync_batch.py --db-dir DIR --db-versions VERSIONS.json --out OUT
        [--catalog ../deals/catalog.json] [--verification out/verification.json]
        [--new out/new.json --include-new]

Inputs
  --db-dir       the live `deals` collection exported with ArtifactData (`list` with `out_dir`):
                 one <id>.json per document, holding the document's fields
  --db-versions  {"<id>": <version>, ...} from the same listing, used to pin every write (if_version)

Output (in OUT)
  docs/<id>.json      the document body for each write
  batch-01.json ...   ArtifactData `writes` arrays, at most 50 entries each
  summary.txt         what changed and why

Rules
  - A catalog deal is written with the latest page-check result applied:
      verified                      -> verification.via = "page", with the matched snippet, unless the
                                       catalog marks it pending for a conflict (a human must decide)
      not_found / not_together      -> pending, reason "not-found"
      expired_or_negated            -> pending, reason "negated"
      unreachable / needs_render    -> catalog verification kept; the attempt is noted in lastCheck
  - The owner's decisions win: a database deal the owner verified themselves (via "you") or marked
    gone is never overwritten, and deals the owner added in the app (not in the catalog) are left alone.
  - Ids listed in the catalog's "removed" are deleted if they still exist.
  - With --include-new, scanner finds become pending deals unless they repeat a catalog deal
    (same venue and price) or already exist.
  - Unchanged documents are skipped, so running it twice writes nothing the second time.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FAIL = {"not_found": "not-found", "not_together": "not-found", "expired_or_negated": "negated"}
VOLATILE = {"updatedAt", "createdAt"}


def load(path, fallback):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return fallback


def norm_price(p: str) -> str:
    return re.sub(r"[^0-9a-z$%]", "", str(p or "").lower())


def apply_result(doc: dict, r: dict | None) -> str:
    """Mutates doc['verification'] from a page-check result; returns a short note for the summary."""
    if not r:
        return ""
    v = dict(doc.get("verification") or {})
    day = (r.get("checkedAt") or "")[:10]
    status = r.get("status")
    if status == "verified":
        if v.get("status") == "pending" and v.get("reason") == "conflict":
            return "page words found, but the catalog marks a conflict; left pending"
        snippet = r.get("matchedSnippet")
        if snippet and snippet.rstrip().endswith("?"):  # an FAQ question is not a quote of the offer
            snippet = None
        host = re.sub(r"^https?://(www\.)?", "", str(r.get("url") or "")).split("/")[0]
        note = v.get("note") if v.get("status") == "verified" else f"Confirmed on {host} by the page check on {day}."
        doc["verification"] = {"status": "verified", "method": "website", "via": "page", "url": r.get("url"), "checkedAt": day,
                               "note": note, "snippet": snippet or v.get("snippet"),
                               "snippetHash": r.get("snippetHash") if snippet else None, "reason": None}
        return "verified on the business page"
    if status in FAIL:
        detail = r.get("reason") or ("missing: " + ", ".join(r.get("missing") or []))
        doc["verification"] = {"status": "pending", "reason": FAIL[status], "checkedAt": day, "url": r.get("url"),
                               "note": f"The business page check on {day} did not confirm it ({detail}).",
                               "snippet": r.get("matchedSnippet")}
        return f"moved to To verify ({status})"
    doc["lastCheck"] = {"status": status, "reason": r.get("reason"), "at": day}
    return f"page check {status}; kept the earlier verification"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Build ArtifactData batches that sync DealDevil's database with the catalog and scanner results.")
    ap.add_argument("--catalog", default=os.path.join(HERE, "..", "deals", "catalog.json"))
    ap.add_argument("--verification", default=os.path.join(HERE, "out", "verification.json"))
    ap.add_argument("--new", default=os.path.join(HERE, "out", "new.json"))
    ap.add_argument("--include-new", action="store_true", help="also add scanner finds as pending deals")
    ap.add_argument("--db-dir", required=True)
    ap.add_argument("--db-versions", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--now", help=argparse.SUPPRESS)
    args = ap.parse_args(argv)

    now = args.now or dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    cat = load(args.catalog, None)
    if cat is None:
        print(f"Couldn't read {args.catalog}", file=sys.stderr)
        return 2
    results = load(args.verification, {}).get("results", {})
    versions = load(args.db_versions, {})
    db = {}
    if os.path.isdir(args.db_dir):
        for name in os.listdir(args.db_dir):
            if name.endswith(".json"):
                db[name[:-5]] = load(os.path.join(args.db_dir, name), {})

    os.makedirs(os.path.join(args.out, "docs"), exist_ok=True)
    writes, lines = [], []

    def put(did: str, body: dict, why: str):
        path = os.path.join(args.out, "docs", did + ".json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(body, f, indent=1, ensure_ascii=False)
        w = {"op": "set", "collection": "deals", "doc_id": did, "file_path": os.path.abspath(path)}
        if did in db:
            w["if_version"] = int(versions.get(did, 1))
        writes.append(w)
        lines.append(f"set    {did}: {why}")

    catalog_ids = set()
    for d in cat.get("deals", []):
        did = d["id"]
        catalog_ids.add(did)
        body = {k: v for k, v in d.items() if k != "id"}
        note = apply_result(body, results.get(did))
        old = db.get(did)
        if old is not None:
            ov = old.get("verification") or {}
            if ov.get("via") == "you" or old.get("status") == "gone":
                lines.append(f"skip   {did}: the owner {'verified it' if ov.get('via') == 'you' else 'marked it gone'} in the app")
                continue
        if old is not None:  # keep fields that live only in the database (foundAt, addedBy, owner notes)
            body = {**old, **body}
        body.setdefault("status", "active")
        body.setdefault("addedBy", "claude")
        body["createdAt"] = (old or {}).get("createdAt") or now
        if old is not None and {k: v for k, v in old.items() if k not in VOLATILE} == {k: v for k, v in body.items() if k not in VOLATILE}:
            lines.append(f"same   {did}")
            continue
        body["updatedAt"] = now
        put(did, body, note or ("new deal" if old is None else "catalog changed"))

    for r in cat.get("removed", []):
        did = r["id"]
        if did in db:
            writes.append({"op": "delete", "collection": "deals", "doc_id": did, "if_version": int(versions.get(did, 1))})
            lines.append(f"delete {did}: {r.get('why', '')}")

    if args.include_new:
        known = {(str(d.get("venue", "")).lower(), norm_price(d.get("price"))) for d in cat.get("deals", [])}
        for f in load(args.new, []):
            did = f["id"]
            if did in db or did in catalog_ids or (str(f.get("venue", "")).lower(), norm_price(f.get("price"))) in known:
                continue
            body = {k: v for k, v in f.items() if k != "id"}
            body.update({"createdAt": now, "updatedAt": now})
            put(did, body, "scanner find, pending review")

    for i in range(0, len(writes), 50):
        with open(os.path.join(args.out, f"batch-{i // 50 + 1:02d}.json"), "w", encoding="utf-8") as f:
            json.dump(writes[i:i + 50], f, indent=1)
    untouched = sorted(set(db) - catalog_ids - {r["id"] for r in cat.get("removed", [])})
    if untouched:
        lines.append("left alone (added in the app): " + ", ".join(untouched))
    with open(os.path.join(args.out, "summary.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    print(f"{len(writes)} writes in {max(1, -(-len(writes) // 50)) if writes else 0} batch file(s) under {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
