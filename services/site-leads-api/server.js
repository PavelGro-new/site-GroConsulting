import http from 'node:http';
import { readFileSync } from 'node:fs';

const env = loadEnv();
const PORT = Number(env.PORT || 4310);
const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = env.TELEGRAM_CHAT_ID || '';
const SITE_ORIGIN = env.SITE_ORIGIN || 'https://gro-consult.ru';

function loadEnv() {
  const result = {};
  const content = readFileSync(new URL('.env', import.meta.url), 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    result[key] = value;
  }
  return result;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

async function readJsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 20_000) throw new Error('payload_too_large');
  }
  return JSON.parse(body || '{}');
}

function formatLeadMessage(payload, req) {
  const kindMap = {
    payment: 'Заявка на счет',
    checklist: 'Запрос чек-листа',
    tariff: 'Подбор тарифа',
    common: 'Заявка с сайта'
  };
  const kind = kindMap[payload.kind] || kindMap.common;
  const page = payload.page || SITE_ORIGIN;
  const lang = payload.lang === 'zh' ? 'Китайская версия' : 'Русская версия';
  const fields = payload.fields && typeof payload.fields === 'object' ? payload.fields : {};

  const rows = Object.entries(fields)
    .filter(([, value]) => String(value ?? '').trim())
    .map(([key, value]) => `• <b>${escapeHtml(key)}:</b> ${escapeHtml(value)}`)
    .join('\n');

  return [
    `📩 <b>${escapeHtml(kind)}</b>`,
    `<b>Источник:</b> ${escapeHtml(lang)}`,
    `<b>Страница:</b> ${escapeHtml(page)}`,
    rows || '• Данные формы не переданы',
    `<b>IP:</b> ${escapeHtml(getClientIp(req))}`
  ].join('\n');
}

async function sendTelegram(message) {
  if (!BOT_TOKEN || !CHAT_ID) {
    throw new Error('telegram_env_missing');
  }

  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.description || `telegram_http_${response.status}`);
  }
  return data;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      return sendJson(res, 204, {});
    }

    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, {
        ok: true,
        telegramConfigured: Boolean(BOT_TOKEN && CHAT_ID)
      });
    }

    if (req.method === 'POST' && req.url === '/api/lead') {
      const payload = await readJsonBody(req);
      const message = formatLeadMessage(payload, req);
      await sendTelegram(message);
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    const status = message === 'payload_too_large' ? 413 : 500;
    return sendJson(res, status, { ok: false, error: message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`GRO leads API listening on http://127.0.0.1:${PORT}`);
});
