#!/usr/bin/env python3
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


load_env(ROOT / ".env")
PORT = int(os.environ.get("PORT", "4190"))
CHECKO_API_KEY = os.environ.get("CHECKO_API_KEY", "")


class Handler(SimpleHTTPRequestHandler):
    server_version = "GroChecking/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_DIR), **kwargs)

    def do_POST(self):
        if self.path.split("?", 1)[0] == "/api/company":
            self.handle_company()
            return
        self.send_json(404, {"error": "Метод не найден"})

    def do_GET(self):
        if self.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        super().end_headers()

    def handle_company(self):
        if not CHECKO_API_KEY:
            self.send_json(500, {
                "error": "API-ключ Чекко не настроен. Укажите CHECKO_API_KEY в файле .env и перезапустите сервис."
            })
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 2048:
                self.send_json(413, {"error": "Слишком большой запрос"})
                return
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except Exception:
            self.send_json(400, {"error": "Некорректный запрос"})
            return

        inn = re.sub(r"\D", "", str(payload.get("inn", "")))
        if not re.fullmatch(r"\d{10}|\d{12}", inn):
            self.send_json(400, {"error": "Введите корректный ИНН: 10 цифр для организации или 12 цифр для ИП."})
            return
        entity_type = "entrepreneur" if len(inn) == 12 else "company"

        try:
            checko_payload = request_checko(inn, entity_type)
        except Exception as error:
            print(f"Checko request failed: {error}", file=sys.stderr)
            self.send_json(502, {"error": "Сервис проверки временно недоступен. Попробуйте позже."})
            return

        meta = checko_payload.get("meta") or {}
        if meta.get("status") == "error":
            self.send_json(400, {"error": meta.get("message") or "Контрагент не найден."})
            return

        if entity_type == "entrepreneur":
            self.send_json(200, normalize_entrepreneur(checko_payload))
        else:
            self.send_json(200, normalize_company(checko_payload))

    def send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def request_checko(inn: str, entity_type: str) -> dict:
    body = urllib.parse.urlencode({"key": CHECKO_API_KEY, "inn": inn}).encode("utf-8")
    path = "entrepreneur" if entity_type == "entrepreneur" else "company"
    request = urllib.request.Request(
        f"https://api.checko.ru/v2/{path}",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def normalize_company(payload: dict) -> dict:
    data = payload.get("data") or {}
    leaders = data.get("Руковод") if isinstance(data.get("Руковод"), list) else []
    leader = leaders[0] if leaders else None
    founders = normalize_founders(data.get("Учред") or {})
    contacts = data.get("Контакты") or {}
    address = data.get("ЮрАдрес") or {}
    okved = data.get("ОКВЭД") or {}
    taxes = data.get("Налоги") or {}
    risks = collect_risks(data, leader, founders, address)
    summary = build_summary(data, risks)

    return {
        "entityType": "company",
        "summary": summary,
        "company": {
            "shortName": data.get("НаимСокр") or "",
            "fullName": data.get("НаимПолн") or "",
            "englishName": data.get("НаимАнгл") or "",
            "status": (data.get("Статус") or {}).get("Наим") or "Нет данных",
            "statusDate": (data.get("Статус") or {}).get("ДатаЗаписи") or "",
            "liquidation": normalize_liquidation(data.get("Ликвид")),
            "inn": data.get("ИНН") or "",
            "kpp": data.get("КПП") or "",
            "ogrn": data.get("ОГРН") or "",
            "okpo": data.get("ОКПО") or "",
            "registrationDate": data.get("ДатаРег") or data.get("ДатаОГРН") or "",
            "extractDate": data.get("ДатаВып") or "",
            "region": (data.get("Регион") or {}).get("Наим") or "",
            "opf": (data.get("ОКОПФ") or {}).get("Наим") or "",
            "capital": capital_text(data.get("УстКап") or {}),
            "msp": (data.get("РМСП") or {}).get("Кат") or (data.get("РМСП") or {}).get("Наим") or "",
            "staffCount": data.get("СЧР"),
        },
        "address": {
            "text": address.get("АдресРФ") or "",
            "locality": address.get("НасПункт") or "",
            "unreliable": bool(address.get("Недост")),
            "unreliableReason": address.get("НедостОпис") or "",
            "massCount": len(address.get("МассАдрес") or []),
        },
        "okved": {
            "code": okved.get("Код") or "",
            "name": okved.get("Наим") or "",
        },
        "leader": normalize_leader(leader),
        "founders": founders,
        "contacts": {
            "phones": contacts.get("Тел") if isinstance(contacts.get("Тел"), list) else [],
            "emails": contacts.get("Емэйл") if isinstance(contacts.get("Емэйл"), list) else [],
            "website": contacts.get("ВебСайт") or "",
        },
        "taxes": {
            "regimes": taxes.get("ОсобРежим") if isinstance(taxes.get("ОсобРежим"), list) else [],
            "arrears": taxes.get("СумНедоим"),
            "penalties": taxes.get("СумШтраф"),
        },
        "registration": {
            "registrar": (data.get("РегФНС") or {}).get("НаимОрг") or "",
            "currentTaxOffice": (data.get("ТекФНС") or {}).get("НаимОрг") or "",
            "pfr": (data.get("РегПФР") or {}).get("НаимОрг") or "",
            "fss": (data.get("РегФСС") or {}).get("НаимОрг") or "",
        },
        "assets": {
            "licenses": len(data.get("Лиценз") or []),
            "trademarks": len(data.get("ТоварЗнак") or []),
            "branches": len((data.get("Подразд") or {}).get("Филиал") or []),
            "representativeOffices": len((data.get("Подразд") or {}).get("Представ") or []),
        },
        "risks": risks,
        "meta": {
            "requestCount": (payload.get("meta") or {}).get("today_request_count"),
            "balance": (payload.get("meta") or {}).get("balance"),
        },
    }


def normalize_entrepreneur(payload: dict) -> dict:
    data = payload.get("data") or {}
    contacts = data.get("Контакты") if isinstance(data.get("Контакты"), dict) else {}
    address = data.get("Адрес") or data.get("ЮрАдрес") or {}
    address = address if isinstance(address, dict) else {}
    okved = data.get("ОКВЭД") if isinstance(data.get("ОКВЭД"), dict) else {}
    taxes = data.get("Налоги") if isinstance(data.get("Налоги"), dict) else {}
    risks = collect_risks(data, None, [], address)
    summary = build_summary(data, risks)
    full_name = data.get("ФИО") or data.get("НаимПолн") or data.get("НаимСокр") or ""

    return {
        "entityType": "entrepreneur",
        "summary": summary,
        "company": {
            "shortName": f"ИП {full_name}".strip() if full_name and not full_name.startswith("ИП ") else full_name,
            "fullName": full_name,
            "englishName": "",
            "status": (data.get("Статус") or {}).get("Наим") or "Нет данных",
            "statusDate": (data.get("Статус") or {}).get("ДатаЗаписи") or "",
            "liquidation": normalize_liquidation(data.get("Ликвид")),
            "inn": data.get("ИНН") or "",
            "kpp": "",
            "ogrn": data.get("ОГРНИП") or data.get("ОГРН") or "",
            "okpo": data.get("ОКПО") or "",
            "registrationDate": data.get("ДатаРег") or data.get("ДатаОГРНИП") or data.get("ДатаОГРН") or "",
            "extractDate": data.get("ДатаВып") or "",
            "region": (data.get("Регион") or {}).get("Наим") or "",
            "opf": data.get("Тип") or data.get("ТипСокр") or "Индивидуальный предприниматель",
            "capital": "",
            "msp": (data.get("РМСП") or {}).get("Кат") or (data.get("РМСП") or {}).get("Наим") or "",
            "staffCount": data.get("СЧР"),
        },
        "address": {
            "text": address.get("АдресРФ") or address.get("Адрес") or "",
            "locality": address.get("НасПункт") or "",
            "unreliable": bool(address.get("Недост")),
            "unreliableReason": address.get("НедостОпис") or "",
            "massCount": len(address.get("МассАдрес") or []),
        },
        "okved": {
            "code": okved.get("Код") or "",
            "name": okved.get("Наим") or "",
        },
        "leader": None,
        "founders": [],
        "contacts": {
            "phones": contacts.get("Тел") if isinstance(contacts.get("Тел"), list) else [],
            "emails": contacts.get("Емэйл") if isinstance(contacts.get("Емэйл"), list) else [],
            "website": contacts.get("ВебСайт") or "",
        },
        "taxes": {
            "regimes": taxes.get("ОсобРежим") if isinstance(taxes.get("ОсобРежим"), list) else [],
            "arrears": taxes.get("СумНедоим"),
            "penalties": taxes.get("СумШтраф"),
        },
        "registration": {
            "registrar": (data.get("РегФНС") or {}).get("НаимОрг") or "",
            "currentTaxOffice": (data.get("ТекФНС") or {}).get("НаимОрг") or "",
            "pfr": (data.get("РегПФР") or {}).get("НаимОрг") or "",
            "fss": (data.get("РегФСС") or {}).get("НаимОрг") or "",
        },
        "assets": {
            "licenses": len(data.get("Лиценз") or []),
            "trademarks": len(data.get("ТоварЗнак") or []),
            "branches": 0,
            "representativeOffices": 0,
        },
        "risks": risks,
        "meta": {
            "requestCount": (payload.get("meta") or {}).get("today_request_count"),
            "balance": (payload.get("meta") or {}).get("balance"),
        },
    }


def normalize_liquidation(value):
    if not isinstance(value, dict):
        return None
    return {
        "date": value.get("Дата") or "",
        "reason": value.get("Наим") or "",
    }


def normalize_leader(leader):
    if not isinstance(leader, dict):
        return None
    return {
        "name": leader.get("ФИО") or "",
        "inn": leader.get("ИНН") or "",
        "position": leader.get("НаимДолжн") or leader.get("ВидДолжн") or "",
        "unreliable": bool(leader.get("Недост")),
        "unreliableReason": leader.get("НедостОпис") or "",
        "massLeader": bool(leader.get("МассРуковод")),
        "disqualified": bool(leader.get("ДисквЛицо")),
        "relatedAsLeader": len(leader.get("СвязРуковод") or []),
        "relatedAsFounder": len(leader.get("СвязУчред") or []),
    }


def normalize_founders(founder_data: dict) -> list:
    rows = []

    for item in founder_data.get("ФЛ") or []:
        rows.append(founder_row("Физическое лицо", item.get("ФИО"), item))

    for item in founder_data.get("РосОрг") or []:
        rows.append(founder_row("Организация", item.get("НаимСокр") or item.get("НаимПолн"), item))

    for item in founder_data.get("ИнОрг") or []:
        rows.append(founder_row("Иностранная организация", item.get("НаимПолн"), item))

    for item in founder_data.get("РФ") or []:
        name = (item.get("Регион") or {}).get("Наим") or item.get("Тип") or "Государственный участник"
        rows.append(founder_row(item.get("Тип") or "Государственный участник", name, item))

    return rows


def founder_row(founder_type: str, name: str, item: dict) -> dict:
    return {
        "type": founder_type,
        "name": name or "Без названия",
        "inn": item.get("ИНН") or "",
        "share": share_text(item.get("Доля") or {}),
        "unreliable": bool(item.get("Недост")),
        "unreliableReason": item.get("НедостОпис") or "",
        "massFounder": bool(item.get("МассУчред")),
        "relatedAsLeader": len(item.get("СвязРуковод") or []),
        "relatedAsFounder": len(item.get("СвязУчред") or []),
    }


def collect_risks(data: dict, leader: dict | None, founders: list, address: dict) -> list:
    risks = []
    status = (data.get("Статус") or {}).get("Наим") or ""

    add_risk(risks, bool(data.get("Ликвид")), "bad", "Компания ликвидирована", (data.get("Ликвид") or {}).get("Наим") or "")
    add_risk(risks, bool(re.search(r"ликвид|прекращ|недейств", status, re.I)), "bad", "Проблемный статус", status)
    add_risk(risks, bool(address.get("Недост")), "bad", "Недостоверный юридический адрес", address.get("НедостОпис") or "В ЕГРЮЛ есть признак недостоверности адреса.")
    add_risk(risks, bool(address.get("МассАдрес")), "warn", "Массовый адрес", f"{len(address.get('МассАдрес') or [])} организаций с тем же адресом.")
    add_risk(risks, bool(leader and leader.get("Недост")), "bad", "Недостоверные сведения о руководителе", (leader or {}).get("НедостОпис") or "")
    add_risk(risks, bool(leader and leader.get("ДисквЛицо")), "bad", "Дисквалифицированное лицо в руководстве", "Есть признак дисквалификации.")
    add_risk(risks, bool(data.get("МассРуковод") or (leader and leader.get("МассРуковод"))), "warn", "Массовый руководитель", "Руководитель связан с большим количеством организаций.")
    add_risk(risks, bool(data.get("МассУчред")), "warn", "Массовый учредитель", "В составе участников есть массовый учредитель.")
    add_risk(risks, bool(data.get("НелегалФин")), "bad", "Признак нелегальной финансовой деятельности", data.get("НелегалФинСтатус") or "По данным Банка России.")
    add_risk(risks, bool(data.get("Санкции")), "bad", "Санкционные списки", ", ".join(data.get("СанкцииСтраны") or []))
    add_risk(risks, bool(data.get("СанкцУчр")), "bad", "Санкции в отношении учредителя", "Есть признак санкций по учредителю или правилу 50%.")
    add_risk(risks, bool(data.get("НедобПост")), "bad", "Реестр недобросовестных поставщиков", "Есть сведения в реестре недобросовестных поставщиков.")
    add_risk(risks, bool(data.get("ЕФРСБ")), "warn", "Сообщения о банкротстве", "Есть сведения в ЕФРСБ.")
    add_risk(risks, bool(data.get("ДисквЛица")), "bad", "Дисквалифицированные лица", f"{len(data.get('ДисквЛица') or [])} записей.")

    for founder in founders:
        add_risk(risks, founder.get("unreliable"), "bad", "Недостоверные сведения об учредителе", founder.get("name") or "")
        add_risk(risks, founder.get("massFounder"), "warn", "Массовый учредитель", founder.get("name") or "")

    if not risks:
        risks.append({
            "level": "ok",
            "title": "Критичных признаков не найдено",
            "text": "По выбранному набору проверок явных факторов риска нет. Перед сделкой всё равно проверьте документы и условия договора.",
        })

    return risks


def add_risk(risks: list, condition, level: str, title: str, text: str = "") -> None:
    if not condition:
        return
    item = {"level": level, "title": title, "text": text}
    if item not in risks:
        risks.append(item)


def build_summary(data: dict, risks: list) -> dict:
    bad = len([risk for risk in risks if risk.get("level") == "bad"])
    warn = len([risk for risk in risks if risk.get("level") == "warn"])
    status = (data.get("Статус") or {}).get("Наим") or ""

    if re.search(r"ликвид|прекращ|недейств", status, re.I):
        return {
            "level": "bad",
            "title": "Контрагент не выглядит действующим",
            "text": status,
            "bad": bad,
            "warn": warn,
        }
    if bad:
        return {
            "level": "bad",
            "title": "Есть существенные факторы риска",
            "text": f"Найдено критичных признаков: {bad}. Рекомендуется ручная проверка перед сотрудничеством.",
            "bad": bad,
            "warn": warn,
        }
    if warn:
        return {
            "level": "warn",
            "title": "Есть признаки, требующие внимания",
            "text": f"Найдено предупреждений: {warn}. Проверьте детали перед оплатой или подписанием договора.",
            "bad": bad,
            "warn": warn,
        }
    return {
        "level": "ok",
        "title": "Видимых критичных рисков нет",
        "text": "Контрагент требует обычной проверки документов перед сделкой.",
        "bad": bad,
        "warn": warn,
    }


def capital_text(capital: dict) -> str:
    amount = capital.get("Сумма")
    if amount is None:
        return ""
    return f"{capital.get('Тип') or 'Уставный капитал'}: {format_money(amount)}"


def share_text(share: dict) -> str:
    parts = []
    if share.get("Процент") is not None:
        parts.append(f"{format_number(share.get('Процент'))}%")
    if share.get("Номинал") is not None:
        parts.append(format_money(share.get("Номинал")))
    return " / ".join(parts) or "Доля не указана"


def format_money(value) -> str:
    return f"{format_number(value)} ₽"


def format_number(value) -> str:
    try:
        return f"{float(value):,.4f}".rstrip("0").rstrip(".").replace(",", " ")
    except Exception:
        return str(value)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Checking service: http://127.0.0.1:{PORT}/")
    server.serve_forever()
