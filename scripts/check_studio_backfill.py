import json, os, sqlite3

db_path = os.path.expandvars(r"%APPDATA%\com.animedesk.app\animedesk.db")
con = sqlite3.connect("file:" + db_path + "?mode=ro", uri=True)

columns = [
    row[1:5]
    for row in con.execute("PRAGMA table_info(media)").fetchall()
    if row[1] == "studios_json"
]
marker = con.execute(
    "SELECT value FROM settings WHERE key=?",
    ("animedesk-studio-backfill-v1",),
).fetchone()
rows = con.execute(
    """
    SELECT mal_id, title, studios_json
    FROM media
    WHERE id IN (SELECT media_id FROM library_entries)
    ORDER BY mal_id
    """
).fetchall()

print("studios_column", columns)
print("marker", marker)
print("library_studios")
for mal_id, title, studios_json in rows:
    try:
        studios = json.loads(studios_json)
    except Exception:
        studios = studios_json
    print(mal_id, title, studios)

con.close()
