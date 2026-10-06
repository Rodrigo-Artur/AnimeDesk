import json
import sqlite3
import tempfile
from pathlib import Path

schema = Path(
    r"F:\Backup\documentos linux\Coditech\Tarefas\AnimeDesk\src-tauri\migrations\0001_initial.sql"
).read_text(encoding="utf-8")

path = tempfile.NamedTemporaryFile(suffix=".db", delete=False).name
con = sqlite3.connect(path)
con.executescript(schema)


def set_value(key, value):
    con.execute(
        """
        INSERT INTO settings(key,value,updated_at)
        VALUES(?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          value=excluded.value,
          updated_at=CURRENT_TIMESTAMP
        """,
        (key, value),
    )


def get_value(key):
    row = con.execute(
        "SELECT value FROM settings WHERE key=?",
        (key,),
    ).fetchone()
    return row[0] if row else None


set_value("animedesk-release-alerts-enabled", "true")
set_value("animedesk-release-alerts-enabled", "false")
assert get_value("animedesk-release-alerts-enabled") == "false"

discover = {
    "savedAt": 123456789,
    "trending": [{"malId": 52991, "title": "Frieren"}],
    "seasonal": [],
    "popular": [],
    "topRated": [],
    "upcoming": [],
}
set_value("animedesk-discover-cache-v1", json.dumps(discover))
assert json.loads(get_value("animedesk-discover-cache-v1"))["trending"][0]["malId"] == 52991

schedule = {
    "savedAt": 123456789,
    "result": {
        "source": "AnimeSchedule",
        "items": [{"id": "test:1", "mediaTitle": "Teste", "releaseAt": "2026-10-06T00:00:00Z"}],
    },
}
set_value("animedesk-weekly-schedule-cache-v1", json.dumps(schedule))
assert json.loads(get_value("animedesk-weekly-schedule-cache-v1"))["result"]["source"] == "AnimeSchedule"

markers = {"animeschedule:test:1:10": 123456789}
set_value("animedesk-release-alert-markers-v1", json.dumps(markers))
assert len(json.loads(get_value("animedesk-release-alert-markers-v1"))) == 1

set_value("animedesk-last-sync:discover", "2026-10-05T23:30:00.000Z")
set_value("animedesk-last-sync:schedule", "2026-10-05T23:31:00.000Z")
assert get_value("animedesk-last-sync:discover").startswith("2026-10-05")

rows = con.execute(
    "SELECT key FROM settings ORDER BY key"
).fetchall()
print("settings_keys", [row[0] for row in rows])

con.execute(
    "DELETE FROM settings WHERE key=?",
    ("animedesk-release-alert-markers-v1",),
)
assert get_value("animedesk-release-alert-markers-v1") is None

# Simula o cache normalizado de releases para uma mídia da biblioteca.
con.execute(
    "INSERT INTO media(type,title,mal_id,genres_json) VALUES(?,?,?,?)",
    ("anime", "Frieren", 52991, "[]"),
)
media_id = con.execute(
    "SELECT id FROM media WHERE type='anime' AND mal_id=52991"
).fetchone()[0]

release_at = "2026-10-10T15:00:00Z"
episode = 1
provider = "AnimeSchedule"

existing = con.execute(
    """
    SELECT id FROM releases
    WHERE media_id=? AND provider=? AND release_at=?
      AND COALESCE(episode,-1)=COALESCE(?,-1)
      AND COALESCE(chapter,-1)=COALESCE(?,-1)
    """,
    (media_id, provider, release_at, episode, None),
).fetchone()

if existing:
    con.execute(
        "UPDATE releases SET release_type=? WHERE id=?",
        ("sub", existing[0]),
    )
else:
    con.execute(
        """
        INSERT INTO releases(media_id,episode,chapter,release_at,release_type,provider)
        VALUES(?,?,?,?,?,?)
        """,
        (media_id, episode, None, release_at, "sub", provider),
    )

# Repete o mesmo evento e atualiza o tipo, sem duplicar.
existing = con.execute(
    """
    SELECT id FROM releases
    WHERE media_id=? AND provider=? AND release_at=?
      AND COALESCE(episode,-1)=COALESCE(?,-1)
      AND COALESCE(chapter,-1)=COALESCE(?,-1)
    """,
    (media_id, provider, release_at, episode, None),
).fetchone()
con.execute(
    "UPDATE releases SET release_type=? WHERE id=?",
    ("dub", existing[0]),
)

release_rows = con.execute(
    "SELECT episode,release_type,provider FROM releases WHERE media_id=?",
    (media_id,),
).fetchall()
assert release_rows == [(1, "dub", "AnimeSchedule")]
print("release_cache", release_rows)

print("app_state_sql=OK")
con.close()
