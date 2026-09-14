import sqlite3
db_path = r'c:\Users\M.S.I\OneDrive\Escritorio\ASISTENTE BOT\registros.db'
con = sqlite3.connect(db_path)
con.execute("UPDATE inventory SET owner = '25' WHERE name = 'Turbinas'")
con.commit()
result = con.execute('SELECT owner, updated_at FROM inventory WHERE name = ?', ('Turbinas',)).fetchone()
print('Updated Turbinas:', result)
con.close()
