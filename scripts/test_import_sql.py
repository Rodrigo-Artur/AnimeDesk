import sqlite3
import tempfile
from pathlib import Path

db = tempfile.NamedTemporaryFile(suffix=".db", delete=False).name
schema = Path(r"F:\Backup\documentos linux\Coditech\Tarefas\AnimeDesk\src-tauri\migrations\0001_initial.sql").read_text(encoding="utf-8")
con = sqlite3.connect(db)
con.executescript(schema)

media_sql = """
INSERT INTO media (
  type, title, title_english, mal_id, cover_url, synopsis,
  total_episodes, total_chapters, score, year, genres_json, airing_status
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(type, mal_id) DO UPDATE SET
  type=excluded.type,
  title=excluded.title,
  title_english=excluded.title_english,
  cover_url=excluded.cover_url,
  synopsis=excluded.synopsis,
  total_episodes=excluded.total_episodes,
  total_chapters=excluded.total_chapters,
  score=excluded.score,
  year=excluded.year,
  genres_json=excluded.genres_json,
  airing_status=excluded.airing_status,
  cached_at=CURRENT_TIMESTAMP
"""

library_sql = """
INSERT INTO library_entries (media_id, status, progress, score, updated_at)
SELECT id, ?, ?, ?, ? FROM media WHERE type = ? AND mal_id = ?
ON CONFLICT(media_id) DO UPDATE SET
  status=excluded.status,
  progress=excluded.progress,
  score=excluded.score,
  updated_at=excluded.updated_at
"""

def save(kind, title, mal_id, total, status, progress, user_score):
    eps = total if kind == "anime" else None
    chapters = total if kind == "manga" else None
    con.execute(media_sql, (kind,title,None,mal_id,None,None,eps,chapters,None,2026,"[]",None))
    con.execute(library_sql, (status,progress,user_score,"2026-10-05T15:00:00Z",kind,mal_id))

save("anime", "Anime A", 1, 12, "watching", 3, 8)
save("manga", "Manga A", 1, 50, "reading", 10, 9)
save("anime", "Anime A atualizado", 1, 12, "completed", 12, 9)

print("media", con.execute("SELECT type,title,mal_id,total_episodes,total_chapters FROM media ORDER BY type").fetchall())
print("library", con.execute("""
SELECT m.type,m.mal_id,l.status,l.progress,l.score
FROM library_entries l JOIN media m ON m.id=l.media_id
ORDER BY m.type
""").fetchall())
con.close()
