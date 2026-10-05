import hashlib, sqlite3

sql_path = r"F:\Backup\documentos linux\Coditech\Tarefas\AnimeDesk\src\db\schema.sql"
db_path = r"C:\Users\kakas\AppData\Roaming\com.animedesk.app\animedesk.db"

current = hashlib.sha384(open(sql_path, "rb").read()).digest()
con = sqlite3.connect(db_path)
stored = con.execute("SELECT checksum FROM _sqlx_migrations WHERE version = 1").fetchone()[0]
print("current:", current.hex())
print("stored :", bytes(stored).hex())
print("match  :", current == bytes(stored))
