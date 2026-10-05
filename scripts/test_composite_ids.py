import sqlite3
import tempfile
from pathlib import Path

db = tempfile.NamedTemporaryFile(suffix=".db", delete=False).name
schema = Path(r"F:\Backup\documentos linux\Coditech\Tarefas\AnimeDesk\src-tauri\migrations\0001_initial.sql").read_text(encoding="utf-8")
con = sqlite3.connect(db)
con.executescript(schema)
con.execute("INSERT INTO media(type,title,mal_id) VALUES(?,?,?)", ("anime", "Teste Anime", 1))
con.execute("INSERT INTO media(type,title,mal_id) VALUES(?,?,?)", ("manga", "Teste Manga", 1))
con.commit()
print(con.execute("SELECT type,title,mal_id FROM media ORDER BY type").fetchall())
con.close()
