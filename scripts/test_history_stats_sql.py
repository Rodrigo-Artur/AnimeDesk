import sqlite3
import tempfile
from pathlib import Path

schema = Path(
    r"F:\Backup\documentos linux\Coditech\Tarefas\AnimeDesk\src-tauri\migrations\0001_initial.sql"
).read_text(encoding="utf-8")

path = tempfile.NamedTemporaryFile(suffix=".db", delete=False).name
con = sqlite3.connect(path)
con.executescript(schema)

con.execute(
    """
    INSERT INTO media(
      type,title,title_english,mal_id,cover_url,genres_json
    ) VALUES(?,?,?,?,?,?)
    """,
    ("anime", "Sousou no Frieren", "Frieren", 52991, "asset://frieren.webp", '["Fantasy"]'),
)
con.execute(
    """
    INSERT INTO media(
      type,title,mal_id,cover_url,genres_json
    ) VALUES(?,?,?,?,?)
    """,
    ("manga", "Berserk", 2, "asset://berserk.webp", '["Drama"]'),
)

anime_id = con.execute(
    "SELECT id FROM media WHERE type='anime' AND mal_id=52991"
).fetchone()[0]
manga_id = con.execute(
    "SELECT id FROM media WHERE type='manga' AND mal_id=2"
).fetchone()[0]

con.execute(
    """
    INSERT INTO watch_history(media_id,episode,provider,watched_at,source_event_id)
    VALUES(?,?,?,?,?)
    """,
    (anime_id, 3, "manual", "2026-10-06 12:00:00", None),
)
con.execute(
    """
    INSERT INTO watch_history(media_id,chapter,provider,watched_at,source_event_id)
    VALUES(?,?,?,?,?)
    """,
    (manga_id, 100, "mangaprovider", "2026-10-05 11:00:00", "remote-100"),
)
con.commit()

rows = con.execute(
    """
    SELECT
      h.id,
      m.type AS media_type,
      m.mal_id,
      m.title,
      m.title_english,
      m.cover_url,
      h.episode,
      h.chapter,
      h.provider,
      h.watched_at,
      h.source_event_id
    FROM watch_history h
    INNER JOIN media m ON m.id = h.media_id
    ORDER BY datetime(h.watched_at) DESC, h.id DESC
    LIMIT ?
    """,
    (500,),
).fetchall()

assert len(rows) == 2
assert rows[0][1:5] == ("anime", 52991, "Sousou no Frieren", "Frieren")
assert rows[0][6] == 3
assert rows[0][8] == "manual"
assert rows[1][1] == "manga"
assert rows[1][7] == 100
assert rows[1][10] == "remote-100"

print("history_rows", rows)
print("history_stats_sql=OK")
con.close()
