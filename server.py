import json
import os
import socket
import sqlite3
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
DATABASE = ROOT / "registros.db"
PORT = 8000
ENVIRONMENT_FILE = ROOT / ".env"


def load_environment():
    if not ENVIRONMENT_FILE.exists():
        return
    for line in ENVIRONMENT_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_environment()
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
USE_SUPABASE = bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


class SupabaseError(Exception):
    pass


def supabase_request(method, table, query="", payload=None):
    if not USE_SUPABASE:
        raise SupabaseError("Supabase no está configurado")
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Accept": "application/json",
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
    if method == "POST":
        headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    request = Request(f"{SUPABASE_URL}/rest/v1/{table}{query}", data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=15) as response:
            response_body = response.read().decode("utf-8")
            return json.loads(response_body) if response_body else None
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
        raise SupabaseError(str(error)) from error


def serialize_supabase_record(row):
    return {
        "date": row["record_date"],
        "arrivals": row["arrivals"],
        "report": row["report"],
        "updated_at": row.get("updated_at"),
    }


def get_records(date=None):
    if USE_SUPABASE:
        if date:
            rows = supabase_request("GET", "daily_records", f"?select=record_date,arrivals,report,updated_at&record_date=eq.{date}")
            return None if not rows else serialize_supabase_record(rows[0])
        rows = supabase_request("GET", "daily_records", "?select=record_date,arrivals,report,updated_at&order=record_date.desc")
        return [serialize_supabase_record(row) for row in rows]

    with get_connection() as connection:
        if date:
            row = connection.execute(
                "SELECT record_date, arrivals, report, updated_at FROM daily_records WHERE record_date = ?", (date,)
            ).fetchone()
            return None if row is None else ApplicationHandler.serialize_row(row)
        rows = connection.execute("SELECT record_date, arrivals, report, updated_at FROM daily_records ORDER BY record_date DESC").fetchall()
        return [ApplicationHandler.serialize_row(row) for row in rows]


def save_record(record_date, arrivals, report):
    if USE_SUPABASE:
        rows = supabase_request(
            "POST",
            "daily_records",
            "?on_conflict=record_date",
            [{"record_date": record_date, "arrivals": arrivals, "report": report}],
        )
        return rows

    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO daily_records (record_date, arrivals, report, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(record_date) DO UPDATE SET
                arrivals = excluded.arrivals,
                report = excluded.report,
                updated_at = CURRENT_TIMESTAMP
            """,
            (record_date, json.dumps(arrivals, ensure_ascii=False), report),
        )


def get_connection():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database():
    with get_connection() as connection:
        if not USE_SUPABASE:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS daily_records (
                    record_date TEXT PRIMARY KEY,
                    arrivals TEXT NOT NULL,
                    report TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS inventory (
                name TEXT PRIMARY KEY,
                owner TEXT NOT NULL DEFAULT '',
                borrower TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        # Agregar columnas de no operativos y sin solución si la tabla ya existía sin ellas
        inventory_columns = {row[1] for row in connection.execute("PRAGMA table_info(inventory)").fetchall()}
        if "non_operative" not in inventory_columns:
            connection.execute("ALTER TABLE inventory ADD COLUMN non_operative TEXT NOT NULL DEFAULT ''")
        if "no_solution" not in inventory_columns:
            connection.execute("ALTER TABLE inventory ADD COLUMN no_solution TEXT NOT NULL DEFAULT ''")

        # Eliminar herramienta ventilador si existe
        connection.execute("DELETE FROM inventory WHERE name = 'ventilador'")
        
        # Inicializar items de inventario si no existen
        default_items = [
            ("Turbinas", "17"),
            ("Aspiradoras", "19"),
            ("Taladros", "20"),
            ("Pulverizadores", "20"),
            ("Extensiones", "0"),
            ("Mochilas", "0")
        ]
        
        for name, qty in default_items:
            connection.execute(
                """
                INSERT OR IGNORE INTO inventory (name, owner, borrower, updated_at)
                VALUES (?, ?, '', CURRENT_TIMESTAMP)
                """,
                (name, qty)
            )


def get_network_ip():
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("192.0.2.1", 1))
        return probe.getsockname()[0]
    except OSError:
        return "IP-DE-ESTA-PC"
    finally:
        probe.close()


def show_startup_progress():
    print("Iniciando servidor local...")
    for progress in range(0, 101, 10):
        filled = progress // 5
        bar = "#" * filled + "-" * (20 - filled)
        sys.stdout.write(f"\r[{bar}] {progress:3d}%")
        sys.stdout.flush()
        time.sleep(0.04)
    print("\nServidor preparado.\n")


def send_json(handler, payload, status=200):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(body)


class ApplicationHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/check-sync":
            # Endpoint para verificar cambios recientes
            query = parse_qs(parsed.query)
            last_check = query.get("since", [str(int(time.time()) - 60)])[0]
            try:
                since_timestamp = float(last_check)
            except:
                since_timestamp = int(time.time()) - 60
            
            with get_connection() as connection:
                inventory = connection.execute(
                    "SELECT name, owner, borrower, non_operative, no_solution, updated_at FROM inventory WHERE updated_at > datetime(?, 'unixepoch') ORDER BY name COLLATE NOCASE",
                    (since_timestamp,)
                ).fetchall()
            
            if inventory:
                send_json(self, {
                    "has_changes": True,
                    "inventory": [dict(row) for row in inventory],
                    "timestamp": int(time.time())
                })
            else:
                send_json(self, {
                    "has_changes": False,
                    "timestamp": int(time.time())
                })
            return
        if parsed.path == "/api/backup":
            try:
                records = get_records()
            except SupabaseError:
                send_json(self, {"error": "No se pudo consultar Supabase"}, 503)
                return
            with get_connection() as connection:
                inventory = connection.execute(
                    "SELECT name, owner, borrower, non_operative, no_solution, updated_at FROM inventory ORDER BY name COLLATE NOCASE"
                ).fetchall()
            payload = {
                "backup_version": 1,
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "daily_records": records,
                "inventory": [dict(row) for row in inventory],
            }
            body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Disposition", "attachment; filename=respaldo-asistencia.json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/api/inventory":
            with get_connection() as connection:
                rows = connection.execute(
                    "SELECT name, owner, borrower, non_operative, no_solution, updated_at FROM inventory ORDER BY name COLLATE NOCASE"
                ).fetchall()
            send_json(self, [dict(row) for row in rows])
            return
        if parsed.path == "/api/records":
            query = parse_qs(parsed.query)
            date = query.get("date", [None])[0]
            try:
                payload = get_records(date)
            except SupabaseError:
                send_json(self, {"error": "No se pudo consultar Supabase"}, 503)
                return
            send_json(self, payload)
            return
        super().do_GET()

    def do_DELETE(self):
        path = urlparse(self.path).path
        if path == "/api/inventory":
            try:
                size = int(self.headers.get("Content-Length", "0"))
                data = json.loads(self.rfile.read(size).decode("utf-8"))
                name = str(data["name"]).strip()
                if not name:
                    raise ValueError("Nombre incompleto")
            except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                send_json(self, {"error": "Datos invalidos"}, 400)
                return
            with get_connection() as connection:
                connection.execute("DELETE FROM inventory WHERE name = ?", (name,))
            send_json(self, {"ok": True})
            return
        send_json(self, {"error": "Ruta no encontrada"}, 404)

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/inventory":
            try:
                size = int(self.headers.get("Content-Length", "0"))
                data = json.loads(self.rfile.read(size).decode("utf-8"))
                name = str(data["name"]).strip()
                owner = str(data.get("owner", "")).strip()
                borrower = str(data.get("borrower", "")).strip()
                non_operative = str(data.get("non_operative", "")).strip()
                no_solution = str(data.get("no_solution", "")).strip()
                if not name:
                    raise ValueError("Nombre incompleto")
            except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                send_json(self, {"error": "Datos de herramienta invalidos"}, 400)
                return
            with get_connection() as connection:
                connection.execute(
                    """
                    INSERT INTO inventory (name, owner, borrower, non_operative, no_solution, updated_at)
                    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(name) DO UPDATE SET
                        owner = excluded.owner,
                        borrower = excluded.borrower,
                        non_operative = excluded.non_operative,
                        no_solution = excluded.no_solution,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (name, owner, borrower, non_operative, no_solution),
                )
            send_json(self, {"ok": True})
            return
        if path != "/api/records":
            send_json(self, {"error": "Ruta no encontrada"}, 404)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(size).decode("utf-8"))
            record_date = str(data["date"])
            arrivals = data["arrivals"]
            report = str(data["report"])
            if not record_date or not isinstance(arrivals, list):
                raise ValueError("Datos incompletos")
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            send_json(self, {"error": "Datos de registro invalidos"}, 400)
            return

        try:
            save_record(record_date, arrivals, report)
        except SupabaseError:
            send_json(self, {"error": "No se pudo guardar en Supabase"}, 503)
            return
        send_json(self, {"ok": True})

    @staticmethod
    def serialize_row(row):
        result = {
            "date": row["record_date"],
            "arrivals": json.loads(row["arrivals"]),
            "report": row["report"],
        }
        if "updated_at" in row.keys():
            result["updated_at"] = row["updated_at"]
        return result

    def log_message(self, format_string, *args):
        print(f"[{self.log_date_time_string()}] {format_string % args}")


if __name__ == "__main__":
    initialize_database()
    show_startup_progress()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), lambda *args, **kwargs: ApplicationHandler(*args, directory=str(ROOT), **kwargs))
    network_url = f"http://{get_network_ip()}:{PORT}/index.html"
    print("========================================")
    print("     SPLASH SEDE LAS FLORES")
    print("     SERVIDOR LOCAL ACTIVO")
    print("========================================")
    print("Estado:        Conectado")
    print(f"Asistencias:    {'Supabase' if USE_SUPABASE else DATABASE.name}")
    print(f"Inventario:     {DATABASE.name}")
    print(f"Puerto:         {PORT}")
    print(f"En esta PC:     http://localhost:{PORT}/index.html")
    print(f"Para WiFi:      {network_url}")
    print("----------------------------------------")
    print("Los dispositivos deben usar la misma red WiFi.")
    print("Mantén esta ventana abierta.")
    print("Presiona Ctrl+C para apagar el servidor.")
    print("========================================")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido")
    finally:
        server.server_close()
