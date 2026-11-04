"""Client for the National Water Data Portal (NWIC, India) CKAN API.

Base: https://nwdp.nwic.gov.in  (CKAN 2.x action API under /api/3/action/)

Endpoints used:
  package_search   list/search the ~572 datasets
  package_show    dataset metadata + resource (CSV) URLs
  datastore_search paged rows for a resource (datastore_active resources)

Standard library only. Responses are cached under data/raw/nwic/ so reruns are offline.

Usage:
  python scripts/nwic_api.py list --query discharge --rows 50
  python scripts/nwic_api.py show f5b49998-6208-4627-b88f-4d3b75238d78
  python scripts/nwic_api.py fetch a21e8e48-d5e3-4a35-8274-007e52f92daf --out data/raw/nwic/discharge_1972_2020.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://nwdp.nwic.gov.in"
ACTION = BASE + "/api/3/action/"
USER_AGENT = "FLOODCAST-hackathon-client/1.0"
CACHE = Path("data/raw/nwic")


def _get(action: str, params: dict, retries: int = 3) -> dict:
    url = ACTION + action + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            if not body.get("success"):
                raise RuntimeError(f"{action} failed: {body.get('error')}")
            return body["result"]
        except Exception as exc:  # network / HTTP / JSON
            last = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"{action} unreachable after {retries} tries: {last}")


def list_datasets(query: str = "", rows: int = 1000) -> list[dict]:
    """Return all matching datasets, paging 100 at a time (CKAN default rows cap)."""
    out, start = [], 0
    while True:
        res = _get("package_search", {"q": query, "start": start, "rows": 100})
        page = res.get("results", [])
        out.extend(page)
        start += len(page)
        if not page or start >= res.get("count", 0) or len(out) >= rows:
            break
    return out[:rows]


def show_dataset(dataset_id: str) -> dict:
    return _get("package_show", {"id": dataset_id})


def datastore_rows(resource_id: str, page: int = 5000, limit: int | None = None):
    """Yield every row of a datastore resource, paging by offset."""
    offset, seen = 0, 0
    while True:
        res = _get("datastore_search", {"resource_id": resource_id, "limit": page, "offset": offset})
        records = res.get("records", [])
        if not records:
            break
        for rec in records:
            yield rec
            seen += 1
            if limit is not None and seen >= limit:
                return
        offset += len(records)
        if offset >= res.get("total", 0):
            break


def fetch_to_csv(resource_id: str, out_path: Path, limit: int | None = None) -> int:
    """Write datastore rows to CSV. Column order follows datastore field order."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fields_res = _get("datastore_search", {"resource_id": resource_id, "limit": 0})
    cols = [f["id"] for f in fields_res.get("fields", []) if f["id"] != "_id"]
    n = 0
    with out_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        writer.writeheader()
        for rec in datastore_rows(resource_id, limit=limit):
            writer.writerow(rec)
            n += 1
    return n


def _cli(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    l = sub.add_parser("list", help="list datasets")
    l.add_argument("--query", default="")
    l.add_argument("--rows", type=int, default=1000)

    s = sub.add_parser("show", help="show a dataset's resources")
    s.add_argument("dataset_id")

    f = sub.add_parser("fetch", help="download a resource's datastore rows to CSV")
    f.add_argument("resource_id")
    f.add_argument("--out", type=Path, required=True)
    f.add_argument("--limit", type=int, default=None)

    args = p.parse_args(argv)
    if args.cmd == "list":
        for d in list_datasets(args.query, args.rows):
            print(f"{d['id']}\t{d.get('title','')}")
    elif args.cmd == "show":
        d = show_dataset(args.dataset_id)
        print(json.dumps({"title": d.get("title"), "license": d.get("license_title"),
                          "resources": [{"id": r["id"], "name": r.get("name"), "format": r.get("format"),
                                         "url": r.get("url"), "datastore_active": r.get("datastore_active")}
                                        for r in d.get("resources", [])]}, indent=2))
    elif args.cmd == "fetch":
        n = fetch_to_csv(args.resource_id, args.out, args.limit)
        print(f"wrote {n} rows -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(_cli(sys.argv[1:]))
