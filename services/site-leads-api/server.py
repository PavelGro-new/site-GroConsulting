#!/usr/bin/env python3
import html
import json
import os
import sys
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


load_env(ROOT / ".env")
PORT = int(os.environ.get("PORT", "4310"))
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
SITE_ORIGIN = os.environ.get("SITE_ORIGIN", "https://gro-consult.ru")


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def client_ip(handler: BaseHTTPRequestHandler) -> str:
    forwarded = handler.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    return handler.client_address[0] if handler.client_address else ""


def format_message(payload: dict, handler: BaseHTTPRequestHandler) -> str:
    kind_map = {
        "payment": "Заявка на счет",
        "checklist": "Запрос чек-листа",
        "tariff": "Подбор тарифа",
        "common": "Заявка с сайта",
    }
    kind = kind_map.get(str(payload.get("kind", "common")), kind_map["common"])
    lang = "Китайская версия" if payload.get("lang") == "zh" else "Русская версия"
    page = payload.get("page") or SITE_ORIGIN
    fields = payload.get("fields") if isinstance(payload.get("fields"), dict) else {}

    rows = []
    for key, value in fields.items():
        value_text = str(value or "").strip()
        if value_text:
            rows.append(f"• <b>{html.escape(str(key))}:</b> {html.escape(value_text)}")

    return "\n".join([
        f"📩 <b>{html.escape(kind)}</b>",
        f"<b>Источник:</b> {html.escape(lang)}",
        f"<b>Страница:</b> {html.escape(str(page))}",
        "\n".join(rows) if rows else "• Данные формы не переданы",
        f"<b>IP:</b> {html.escape(client_ip(handler))}",
    ])


def send_telegram(message: str) -> None:
    if not BOT_TOKEN or not CHAT_ID:
        raise RuntimeError("telegram_env_missing")
    body = urllib.parse.urlencode({
        "chat_id": CHAT_ID,
        "text": message,
        "parse_mode": "HTML",
        "disable_web_page_preview": "true",
    }).encode("utf-8")
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        data = json.loads(response.read().decode("utf-8") or "{}")
        if not data.get("ok"):
            raise RuntimeError(data.get("description") or "telegram_error")


class Handler(BaseHTTPRequestHandler):
    server_version = "GroLeads/1.0"

    def do_OPTIONS(self):
        json_response(self, 204, {})

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/health":
            json_response(self, 200, {"ok": True, "telegramConfigured": bool(BOT_TOKEN and CHAT_ID)})
            return
        json_response(self, 404, {"ok": False, "error": "not_found"})

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/api/lead":
            json_response(self, 404, {"ok": False, "error": "not_found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 20000:
                json_response(self, 413, {"ok": False, "error": "payload_too_large"})
                return
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            send_telegram(format_message(payload, self))
            json_response(self, 200, {"ok": True})
        except Exception as error:
            print(f"Lead request failed: {error}", file=sys.stderr)
            json_response(self, 500, {"ok": False, "error": str(error)})

    def log_message(self, format: str, *args) -> None:
        print(f"{self.address_string()} - {format % args}", file=sys.stderr)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"GRO leads API listening on http://127.0.0.1:{PORT}")
    server.serve_forever()
