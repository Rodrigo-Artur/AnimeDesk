import json
import urllib.parse
import urllib.request

UA = {"User-Agent": "AnimeDesk/0.2.1"}


def get(base, params):
    url = base + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response)


def run(media_type, mal_ids):
    external_site = f"myanimelist/{media_type}"
    mappings = get(
        "https://kitsu.io/api/edge/mappings",
        {
            "filter[externalSite]": external_site,
            "filter[externalId]": ",".join(str(value) for value in mal_ids),
            "page[limit]": 20,
            "include": "item",
        },
    )

    pairs = [
        (
            item["attributes"]["externalId"],
            item["relationships"]["item"]["data"]["id"],
        )
        for item in mappings.get("data", [])
    ]
    kitsu_ids = [kitsu_id for _, kitsu_id in pairs]

    print(media_type, "mappings", pairs)

    if not kitsu_ids:
        return

    media = get(
        f"https://kitsu.io/api/edge/{media_type}",
        {
            "filter[id]": ",".join(kitsu_ids),
            "page[limit]": 20,
            "include": "categories",
        },
    )

    categories = {
        item["id"]: item.get("attributes", {}).get("title")
        for item in media.get("included", [])
        if item.get("type") == "categories"
    }

    rows = []
    for item in media.get("data", []):
        attributes = item.get("attributes", {})
        refs = (
            item.get("relationships", {})
            .get("categories", {})
            .get("data", [])
            or []
        )
        rows.append(
            {
                "title": attributes.get("canonicalTitle"),
                "episodes": attributes.get("episodeCount"),
                "chapters": attributes.get("chapterCount"),
                "cover": bool(attributes.get("posterImage")),
                "synopsis": bool(attributes.get("synopsis")),
                "categories": [
                    categories.get(ref["id"])
                    for ref in refs
                    if categories.get(ref["id"])
                ][:5],
            }
        )

    print(media_type, "media", rows)


run("anime", [52991, 21, 1535])
run("manga", [2, 13])
