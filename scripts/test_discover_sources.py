import json, urllib.parse, urllib.request

BASE = "https://kitsu.io/api/edge"
UA = {"User-Agent": "AnimeDesk/0.1.1"}

def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)

def resolve(params):
    qs = urllib.parse.urlencode(params)
    return get(f"{BASE}/anime?{qs}")

def count_mal(payload):
    included = payload.get("included", [])
    mal_mapping_ids = {
        r["id"] for r in included
        if r.get("type") == "mappings"
        and r.get("attributes", {}).get("externalSite") == "myanimelist/anime"
    }
    total = len(payload.get("data", []))
    mapped = 0
    for item in payload.get("data", []):
        refs = item.get("relationships", {}).get("mappings", {}).get("data", []) or []
        if any(ref.get("id") in mal_mapping_ids for ref in refs):
            mapped += 1
    return total, mapped

trending = get(f"{BASE}/trending/anime")
ids = ",".join(x["id"] for x in trending.get("data", []))
sections = {
    "trending": resolve({"filter[id]": ids, "page[limit]": 20, "include": "mappings,categories"}),
    "seasonal": resolve({"filter[season]": "fall", "filter[seasonYear]": 2026, "page[limit]": 18, "sort": "-userCount", "include": "mappings,categories"}),
    "popular": resolve({"page[limit]": 18, "sort": "-userCount", "include": "mappings,categories"}),
    "top": resolve({"page[limit]": 18, "sort": "-averageRating", "include": "mappings,categories"}),
    "current": resolve({"filter[status]": "current", "page[limit]": 18, "sort": "-userCount", "include": "mappings,categories"}),
    "upcoming": resolve({"filter[status]": "upcoming", "page[limit]": 18, "sort": "startDate", "include": "mappings,categories"}),
}

for name, payload in sections.items():
    total, mapped = count_mal(payload)
    titles = [x.get("attributes", {}).get("canonicalTitle") for x in payload.get("data", [])[:3]]
    print(f"{name}: total={total} mal_mapped={mapped} sample={titles}")
