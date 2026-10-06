import os
import sqlite3
from pathlib import Path
from urllib.parse import unquote, urlparse

db_path = os.path.expandvars(r"%APPDATA%\com.animedesk.app\animedesk.db")
con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)

rows = con.execute(
    """
    SELECT m.type, m.mal_id, m.title, m.cover_url
    FROM library_entries l
    JOIN media m ON m.id=l.media_id
    ORDER BY m.type,m.mal_id
    """
).fetchall()

assert rows, "biblioteca vazia"
failures = []

for media_type, mal_id, title, cover_url in rows:
    if not cover_url:
        failures.append((media_type, mal_id, title, "sem cover_url"))
        continue

    parsed = urlparse(cover_url)
    if parsed.hostname != "asset.localhost":
        failures.append((media_type, mal_id, title, f"não-local: {cover_url}"))
        continue

    raw = unquote(parsed.path.lstrip("/"))
    path = Path(raw)

    if not path.exists():
        failures.append((media_type, mal_id, title, f"arquivo ausente: {path}"))
        continue

    header = path.read_bytes()[:16]
    is_jpeg = header.startswith(b"\xff\xd8\xff")
    is_png = header.startswith(b"\x89PNG\r\n\x1a\n")
    is_webp = len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WEBP"

    if not (is_jpeg or is_png or is_webp):
        failures.append((media_type, mal_id, title, f"assinatura inválida: {path}"))
        continue

    print("OK", media_type, mal_id, title, path.name, path.stat().st_size)

print("library_items", len(rows))
print("failures", failures)
assert not failures
print("offline_covers=OK")
con.close()
