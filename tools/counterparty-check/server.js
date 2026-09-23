import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

loadEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 4189);
const CHECKO_API_KEY = process.env.CHECKO_API_KEY || "";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/company") {
      await handleCompany(req, res);
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Метод не поддерживается" });
      return;
    }

    const requestedPath = decodeURIComponent(url.pathname);
    const safePath = requestedPath === "/" || requestedPath.endsWith("/") ? `${requestedPath}index.html` : requestedPath;
    const filePath = path.normalize(path.join(publicDir, safePath));

    if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
      sendJson(res, 404, { error: "Файл не найден" });
      return;
    }

    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": path.basename(filePath) === "index.html" ? "no-store" : "public, max-age=86400"
    });
    res.end(body);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Внутренняя ошибка сервера" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Counterparty checker: http://127.0.0.1:${PORT}/`);
});

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function handleCompany(req, res) {
  if (!CHECKO_API_KEY) {
    sendJson(res, 500, {
      error: "API-ключ Чекко не настроен. Укажите CHECKO_API_KEY в файле .env и перезапустите сервер."
    });
    return;
  }

  const body = await readRequestBody(req);
  const inn = String(body.inn || "").replace(/\D/g, "");

  if (!/^(\d{10}|\d{12})$/.test(inn)) {
    sendJson(res, 400, { error: "Введите корректный ИНН: 10 цифр для организации или 12 цифр для ИП." });
    return;
  }

  const entityType = inn.length === 12 ? "entrepreneur" : "company";
  let response;
  let checko;

  try {
    response = await fetch(`https://api.checko.ru/v2/${entityType}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ key: CHECKO_API_KEY, inn })
    });
    checko = await response.json().catch(() => null);
  } catch (error) {
    console.error("Checko request failed:", error);
    sendJson(res, 502, { error: "Сервис проверки временно недоступен. Попробуйте позже." });
    return;
  }

  if (!response.ok || !checko) {
    sendJson(res, 502, { error: "Сервис проверки временно недоступен. Попробуйте позже." });
    return;
  }

  if (checko.meta?.status === "error") {
    sendJson(res, 400, { error: checko.meta.message || "Контрагент не найден." });
    return;
  }

  sendJson(res, 200, entityType === "entrepreneur" ? normalizeEntrepreneur(checko) : normalizeCompany(checko));
}

function normalizeCompany(payload) {
  const data = payload.data || {};
  const leaders = Array.isArray(data["Руковод"]) ? data["Руковод"] : [];
  const leader = leaders[0] || null;
  const founders = normalizeFounders(data["Учред"]);
  const contacts = data["Контакты"] || {};
  const address = data["ЮрАдрес"] || {};
  const okved = data["ОКВЭД"] || {};
  const taxes = data["Налоги"] || {};
  const registration = {
    registrar: data["РегФНС"]?.["НаимОрг"] || "",
    currentTaxOffice: data["ТекФНС"]?.["НаимОрг"] || "",
    pfr: data["РегПФР"]?.["НаимОрг"] || "",
    fss: data["РегФСС"]?.["НаимОрг"] || ""
  };
  const risks = collectRisks(data, leader, founders, address);
  const summary = buildSummary(data, risks);

  return {
    entityType: "company",
    summary,
    company: {
      shortName: data["НаимСокр"] || "",
      fullName: data["НаимПолн"] || "",
      englishName: data["НаимАнгл"] || "",
      status: data["Статус"]?.["Наим"] || "Нет данных",
      statusDate: data["Статус"]?.["ДатаЗаписи"] || "",
      liquidation: data["Ликвид"] ? {
        date: data["Ликвид"]["Дата"] || "",
        reason: data["Ликвид"]["Наим"] || ""
      } : null,
      inn: data["ИНН"] || "",
      kpp: data["КПП"] || "",
      ogrn: data["ОГРН"] || "",
      okpo: data["ОКПО"] || "",
      registrationDate: data["ДатаРег"] || data["ДатаОГРН"] || "",
      extractDate: data["ДатаВып"] || "",
      region: data["Регион"]?.["Наим"] || "",
      opf: data["ОКОПФ"]?.["Наим"] || "",
      capital: capitalText(data["УстКап"]),
      msp: data["РМСП"]?.["Кат"] || data["РМСП"]?.["Наим"] || "",
      staffCount: data["СЧР"] || null
    },
    address: {
      text: address["АдресРФ"] || "",
      locality: address["НасПункт"] || "",
      unreliable: Boolean(address["Недост"]),
      unreliableReason: address["НедостОпис"] || "",
      massCount: Array.isArray(address["МассАдрес"]) ? address["МассАдрес"].length : 0
    },
    okved: {
      code: okved["Код"] || "",
      name: okved["Наим"] || "",
      additional: (data["ОКВЭДДоп"] || []).slice(0, 6).map(item => ({
        code: item["Код"] || "",
        name: item["Наим"] || ""
      }))
    },
    leader: leader
      ? {
          name: leader["ФИО"] || "",
          inn: leader["ИНН"] || "",
          position: leader["НаимДолжн"] || leader["ВидДолжн"] || "",
          unreliable: Boolean(leader["Недост"]),
          unreliableReason: leader["НедостОпис"] || "",
          massLeader: Boolean(leader["МассРуковод"]),
          disqualified: Boolean(leader["ДисквЛицо"]),
          relatedAsLeader: Array.isArray(leader["СвязРуковод"]) ? leader["СвязРуковод"].length : 0,
          relatedAsFounder: Array.isArray(leader["СвязУчред"]) ? leader["СвязУчред"].length : 0
        }
      : null,
    founders,
    contacts: {
      phones: Array.isArray(contacts["Тел"]) ? contacts["Тел"] : [],
      emails: Array.isArray(contacts["Емэйл"]) ? contacts["Емэйл"] : [],
      website: contacts["ВебСайт"] || ""
    },
    taxes: {
      regimes: Array.isArray(taxes["ОсобРежим"]) ? taxes["ОсобРежим"] : [],
      arrears: taxes["СумНедоим"] ?? null,
      penalties: taxes["СумШтраф"] ?? null
    },
    registration,
    assets: {
      licenses: Array.isArray(data["Лиценз"]) ? data["Лиценз"].length : 0,
      trademarks: Array.isArray(data["ТоварЗнак"]) ? data["ТоварЗнак"].length : 0,
      branches: Array.isArray(data["Подразд"]?.["Филиал"]) ? data["Подразд"]["Филиал"].length : 0,
      representativeOffices: Array.isArray(data["Подразд"]?.["Представ"]) ? data["Подразд"]["Представ"].length : 0
    },
    risks,
    meta: {
      requestCount: payload.meta?.today_request_count ?? null,
      balance: payload.meta?.balance ?? null
    }
  };
}

function normalizeEntrepreneur(payload) {
  const data = payload.data || {};
  const contacts = typeof data["Контакты"] === "object" && data["Контакты"] ? data["Контакты"] : {};
  const rawAddress = data["Адрес"] || data["ЮрАдрес"] || {};
  const address = typeof rawAddress === "object" && rawAddress ? rawAddress : {};
  const okved = typeof data["ОКВЭД"] === "object" && data["ОКВЭД"] ? data["ОКВЭД"] : {};
  const taxes = typeof data["Налоги"] === "object" && data["Налоги"] ? data["Налоги"] : {};
  const risks = collectRisks(data, null, [], address);
  const summary = buildSummary(data, risks);
  const fullName = data["ФИО"] || data["НаимПолн"] || data["НаимСокр"] || "";

  return {
    entityType: "entrepreneur",
    summary,
    company: {
      shortName: fullName && !fullName.startsWith("ИП ") ? `ИП ${fullName}` : fullName,
      fullName,
      englishName: "",
      status: data["Статус"]?.["Наим"] || "Нет данных",
      statusDate: data["Статус"]?.["ДатаЗаписи"] || "",
      liquidation: data["Ликвид"] ? {
        date: data["Ликвид"]["Дата"] || "",
        reason: data["Ликвид"]["Наим"] || ""
      } : null,
      inn: data["ИНН"] || "",
      kpp: "",
      ogrn: data["ОГРНИП"] || data["ОГРН"] || "",
      okpo: data["ОКПО"] || "",
      registrationDate: data["ДатаРег"] || data["ДатаОГРНИП"] || data["ДатаОГРН"] || "",
      extractDate: data["ДатаВып"] || "",
      region: data["Регион"]?.["Наим"] || "",
      opf: data["Тип"] || data["ТипСокр"] || "Индивидуальный предприниматель",
      capital: "",
      msp: data["РМСП"]?.["Кат"] || data["РМСП"]?.["Наим"] || "",
      staffCount: data["СЧР"] || null
    },
    address: {
      text: address["АдресРФ"] || address["Адрес"] || "",
      locality: address["НасПункт"] || "",
      unreliable: Boolean(address["Недост"]),
      unreliableReason: address["НедостОпис"] || "",
      massCount: Array.isArray(address["МассАдрес"]) ? address["МассАдрес"].length : 0
    },
    okved: {
      code: okved["Код"] || "",
      name: okved["Наим"] || "",
      additional: []
    },
    leader: null,
    founders: [],
    contacts: {
      phones: Array.isArray(contacts["Тел"]) ? contacts["Тел"] : [],
      emails: Array.isArray(contacts["Емэйл"]) ? contacts["Емэйл"] : [],
      website: contacts["ВебСайт"] || ""
    },
    taxes: {
      regimes: Array.isArray(taxes["ОсобРежим"]) ? taxes["ОсобРежим"] : [],
      arrears: taxes["СумНедоим"] ?? null,
      penalties: taxes["СумШтраф"] ?? null
    },
    registration: {
      registrar: data["РегФНС"]?.["НаимОрг"] || "",
      currentTaxOffice: data["ТекФНС"]?.["НаимОрг"] || "",
      pfr: data["РегПФР"]?.["НаимОрг"] || "",
      fss: data["РегФСС"]?.["НаимОрг"] || ""
    },
    assets: {
      licenses: Array.isArray(data["Лиценз"]) ? data["Лиценз"].length : 0,
      trademarks: Array.isArray(data["ТоварЗнак"]) ? data["ТоварЗнак"].length : 0,
      branches: 0,
      representativeOffices: 0
    },
    risks,
    meta: {
      requestCount: payload.meta?.today_request_count ?? null,
      balance: payload.meta?.balance ?? null
    }
  };
}

function collectRisks(data, leader, founders, address) {
  const risks = [];

  addRisk(risks, Boolean(data["Ликвид"]), "bad", "Компания ликвидирована", data["Ликвид"]?.["Наим"] || "");
  addRisk(risks, /ликвид|прекращ|недейств/i.test(data["Статус"]?.["Наим"] || ""), "bad", "Проблемный статус", data["Статус"]?.["Наим"] || "");
  addRisk(risks, Boolean(address["Недост"]), "bad", "Недостоверный юридический адрес", address["НедостОпис"] || "В ЕГРЮЛ есть признак недостоверности адреса.");
  addRisk(risks, Array.isArray(address["МассАдрес"]) && address["МассАдрес"].length > 0, "warn", "Массовый адрес", `${address["МассАдрес"]?.length || 0} организаций с тем же адресом.`);
  addRisk(risks, Boolean(leader?.["Недост"]), "bad", "Недостоверные сведения о руководителе", leader?.["НедостОпис"] || "");
  addRisk(risks, Boolean(leader?.["ДисквЛицо"]), "bad", "Дисквалифицированное лицо в руководстве", [leader?.["ДисквДатаНач"], leader?.["ДисквДатаОконч"]].filter(Boolean).join(" - "));
  addRisk(risks, Boolean(data["МассРуковод"]) || Boolean(leader?.["МассРуковод"]), "warn", "Массовый руководитель", "Руководитель связан с большим количеством организаций.");
  addRisk(risks, Boolean(data["МассУчред"]), "warn", "Массовый учредитель", "В составе участников есть массовый учредитель.");
  addRisk(risks, Boolean(data["НелегалФин"]), "bad", "Признак нелегальной финансовой деятельности", data["НелегалФинСтатус"] || "По данным Банка России.");
  addRisk(risks, Boolean(data["Санкции"]), "bad", "Санкционные списки", Array.isArray(data["СанкцииСтраны"]) ? data["СанкцииСтраны"].join(", ") : "");
  addRisk(risks, Boolean(data["СанкцУчр"]), "bad", "Санкции в отношении учредителя", "Есть признак санкций по учредителю или правилу 50%.");
  addRisk(risks, Boolean(data["НедобПост"]), "bad", "Реестр недобросовестных поставщиков", "Есть сведения в реестре недобросовестных поставщиков.");
  addRisk(risks, Boolean(data["ЕФРСБ"]), "warn", "Сообщения о банкротстве", "Есть сведения в ЕФРСБ.");
  addRisk(risks, Array.isArray(data["ДисквЛица"]) && data["ДисквЛица"].length > 0, "bad", "Дисквалифицированные лица", `${data["ДисквЛица"]?.length || 0} записей.`);

  for (const founder of founders) {
    if (founder.unreliable) addRisk(risks, true, "bad", "Недостоверные сведения об учредителе", founder.name);
    if (founder.massFounder) addRisk(risks, true, "warn", "Массовый учредитель", founder.name);
  }

  if (!risks.length) {
    risks.push({
      level: "ok",
      title: "Критичных признаков не найдено",
      text: "По выбранному набору проверок явных факторов риска нет. Перед сделкой всё равно проверьте документы и условия договора."
    });
  }

  return risks;
}

function addRisk(risks, condition, level, title, text = "") {
  if (!condition) return;
  if (risks.some(risk => risk.title === title && risk.text === text)) return;
  risks.push({ level, title, text });
}

function buildSummary(data, risks) {
  const bad = risks.filter(risk => risk.level === "bad").length;
  const warn = risks.filter(risk => risk.level === "warn").length;
  let level = "ok";
  let title = "Видимых критичных рисков нет";
  let text = "Компания требует обычной проверки документов перед сделкой.";

  if (bad > 0) {
    level = "bad";
    title = "Есть существенные факторы риска";
    text = `Найдено критичных признаков: ${bad}. Рекомендуется ручная проверка перед сотрудничеством.`;
  } else if (warn > 0) {
    level = "warn";
    title = "Есть признаки, требующие внимания";
    text = `Найдено предупреждений: ${warn}. Проверьте детали перед оплатой или подписанием договора.`;
  }

  if (/ликвид|прекращ/i.test(data["Статус"]?.["Наим"] || "")) {
    level = "bad";
    title = "Компания не выглядит действующей";
    text = data["Статус"]?.["Наим"] || text;
  }

  return { level, title, text, bad, warn };
}

function normalizeFounders(founderData = {}) {
  founderData ||= {};
  const rows = [];

  for (const item of founderData["ФЛ"] || []) {
    rows.push({
      type: "Физическое лицо",
      name: item["ФИО"] || "Без имени",
      inn: item["ИНН"] || "",
      share: shareText(item["Доля"]),
      unreliable: Boolean(item["Недост"]),
      unreliableReason: item["НедостОпис"] || "",
      massFounder: Boolean(item["МассУчред"]),
      relatedAsLeader: Array.isArray(item["СвязРуковод"]) ? item["СвязРуковод"].length : 0,
      relatedAsFounder: Array.isArray(item["СвязУчред"]) ? item["СвязУчред"].length : 0
    });
  }

  for (const item of founderData["РосОрг"] || []) {
    rows.push({
      type: "Организация",
      name: item["НаимСокр"] || item["НаимПолн"] || "Без названия",
      inn: item["ИНН"] || "",
      share: shareText(item["Доля"]),
      unreliable: Boolean(item["Недост"]),
      unreliableReason: item["НедостОпис"] || "",
      massFounder: false,
      relatedAsLeader: 0,
      relatedAsFounder: Array.isArray(item["СвязУчред"]) ? item["СвязУчред"].length : 0
    });
  }

  for (const item of founderData["ИнОрг"] || []) {
    rows.push({
      type: "Иностранная организация",
      name: item["НаимПолн"] || "Без названия",
      inn: "",
      share: shareText(item["Доля"]),
      unreliable: Boolean(item["Недост"]),
      unreliableReason: item["НедостОпис"] || "",
      massFounder: false,
      relatedAsLeader: 0,
      relatedAsFounder: 0
    });
  }

  for (const item of founderData["РФ"] || []) {
    rows.push({
      type: item["Тип"] || "Государственный участник",
      name: item["Регион"]?.["Наим"] || item["Тип"] || "Государственный участник",
      inn: "",
      share: shareText(item["Доля"]),
      unreliable: Boolean(item["Недост"]),
      unreliableReason: item["НедостОпис"] || "",
      massFounder: false,
      relatedAsLeader: 0,
      relatedAsFounder: Array.isArray(item["СвязУчред"]) ? item["СвязУчред"].length : 0
    });
  }

  return rows;
}

function capitalText(capital = {}) {
  if (!capital || !Number.isFinite(Number(capital["Сумма"]))) return "";
  return `${capital["Тип"] || "Уставный капитал"}: ${formatMoney(Number(capital["Сумма"]))}`;
}

function shareText(share = {}) {
  const parts = [];
  if (Number.isFinite(Number(share["Процент"]))) parts.push(`${formatNumber(Number(share["Процент"]))}%`);
  if (Number.isFinite(Number(share["Номинал"]))) parts.push(formatMoney(Number(share["Номинал"])));
  return parts.join(" / ") || "Доля не указана";
}

function formatMoney(value) {
  return `${formatNumber(value)} ₽`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 }).format(value);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 2048) {
        req.destroy();
        reject(new Error("Слишком большой запрос"));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Некорректный JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}
