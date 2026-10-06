import sqlite3
import tempfile
from pathlib import Path

schema = Path(
    r"F:\Backup\documentos linux\Coditech\Tarefas\AnimeDesk\src-tauri\migrations\0001_initial.sql"
).read_text(encoding="utf-8")

path = tempfile.NamedTemporaryFile(suffix=".db", delete=False).name
con = sqlite3.connect(path)
con.executescript(schema)

# Prova que anime e mangá podem compartilhar o mesmo MAL ID numérico.
con.execute(
    "INSERT INTO media(type,title,mal_id,genres_json) VALUES(?,?,?,?)",
    ("anime", "Anime #1", 1, "[]"),
)
con.execute(
    "INSERT INTO media(type,title,mal_id,genres_json) VALUES(?,?,?,?)",
    ("manga", "Manga #1", 1, "[]"),
)
con.execute(
    "INSERT INTO media(type,title,mal_id,genres_json) VALUES(?,?,?,?)",
    ("anime", "Frieren", 52991, "[]"),
)

def link(media_type, mal_id, provider, external_id, confidence=1.0, verified=1):
    confidence = max(0.0, min(1.0, confidence))
    con.execute(
        """
        INSERT INTO external_media_ids(
          media_id,provider,external_id,external_title,confidence,verified
        )
        SELECT id,?,?,?,?,?
        FROM media
        WHERE type=? AND mal_id=?
        ON CONFLICT(provider, external_id) DO UPDATE SET
          media_id=excluded.media_id,
          external_title=excluded.external_title,
          confidence=excluded.confidence,
          verified=excluded.verified
        """,
        (
            provider,
            external_id,
            f"{media_type}:{mal_id}",
            confidence,
            verified,
            media_type,
            mal_id,
        ),
    )

link("anime", 1, "myanimelist/anime", "1")
link("manga", 1, "myanimelist/manga", "1")
link("anime", 52991, "myanimelist/anime", "52991")
link("anime", 52991, "kitsu", "46474")
link("anime", 52991, "tmdb", "209867", confidence=1.4, verified=0)
con.commit()

namespace_rows = con.execute(
    """
    SELECT m.type,m.mal_id,e.provider,e.external_id
    FROM external_media_ids e
    JOIN media m ON m.id=e.media_id
    WHERE e.external_id='1'
    ORDER BY e.provider
    """
).fetchall()
print("mal_namespaces", namespace_rows)

resolved = con.execute(
    """
    SELECT m.type,m.mal_id,m.title,e.provider,e.external_id,e.confidence,e.verified
    FROM external_media_ids e
    JOIN media m ON m.id=e.media_id
    WHERE e.provider=? AND e.external_id=?
    """,
    ("kitsu", "46474"),
).fetchone()
print("resolved_kitsu", resolved)

tmdb = con.execute(
    "SELECT confidence FROM external_media_ids WHERE provider='tmdb' AND external_id='209867'"
).fetchone()
print("tmdb_confidence", tmdb)

assert len(namespace_rows) == 2
assert namespace_rows[0][2] != namespace_rows[1][2]
assert resolved[1] == 52991
assert tmdb[0] == 1.0
con.close()
