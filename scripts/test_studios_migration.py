import json
import sqlite3
import tempfile
from pathlib import Path

root = Path(r"F:\Backup\documentos linux\Coditech\Tarefas\AnimeDesk")
v1 = (root / "src-tauri" / "migrations" / "0001_initial.sql").read_text(encoding="utf-8")
v2 = (root / "src-tauri" / "migrations" / "0002_add_studios.sql").read_text(encoding="utf-8")

path = tempfile.NamedTemporaryFile(suffix=".db", delete=False).name
con = sqlite3.connect(path)
con.executescript(v1)
con.executescript(v2)

columns = {
    row[1]: row
    for row in con.execute("PRAGMA table_info(media)").fetchall()
}
assert "studios_json" in columns
assert columns["studios_json"][3] == 1  # NOT NULL
assert columns["studios_json"][4] == "'[]'"

studios = ["Madhouse", "Studio Bind"]
con.execute(
    """
    INSERT INTO media(type,title,mal_id,genres_json,studios_json)
    VALUES(?,?,?,?,?)
    """,
    ("anime", "Teste", 123, "[]", json.dumps(studios)),
)
loaded = con.execute(
    "SELECT studios_json FROM media WHERE type='anime' AND mal_id=123"
).fetchone()[0]
assert json.loads(loaded) == studios

print("studios_column", columns["studios_json"])
print("studios_json", loaded)
print("studios_migration=OK")
con.close()
