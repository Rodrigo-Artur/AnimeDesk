import sqlite3

db = r"C:\Users\kakas\AppData\Roaming\com.animedesk.app\animedesk.db"
con = sqlite3.connect(db)

tables = [row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
print("TABLES:", tables)
print("MEDIA:")
for row in con.execute("PRAGMA table_info(media)"):
    print(row)

if "_sqlx_migrations" in tables:
    print("MIGRATIONS:")
    for row in con.execute("SELECT * FROM _sqlx_migrations"):
        print(row)

print("LIBRARY:")
for row in con.execute("SELECT * FROM library_entries LIMIT 10"):
    print(row)

con.close()
