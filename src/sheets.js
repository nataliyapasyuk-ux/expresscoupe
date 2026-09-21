const fs = require('fs');
const { google } = require('googleapis');
const config = require('./config');

const DEFAULT_SETTINGS = {
  product: 'шкаф-купе',
  discount: '10%',
  promo: 'ДОБРО_ПОЖАЛОВАТЬ2016',
  msg_offer: 'Скидка {discount} на {product}. Забрать за 20 секунд.',
  msg_ask_phone: 'Ваша скидка {discount} уже закреплена за вами. Оставьте номер, чтобы менеджер её применил.',
  msg_promo: 'Готово! Ваш промокод: {promo} — скидка {discount}. Назовите его менеджеру при заказе.',
  msg_channel_welcome: 'Добро пожаловать! 🎉 Скидка {discount} на {product} ждёт вас — заберите её за 20 секунд.',
};

let sheetsClient = null;
let cache = { values: { ...DEFAULT_SETTINGS }, fetchedAt: 0 };

async function getAuth() {
  if (!fs.existsSync(config.googleServiceAccountFile)) {
    throw new Error(
      `Не найден файл ключа сервисного аккаунта: ${config.googleServiceAccountFile}. ` +
      `Создай его в Google Cloud Console (см. README) и укажи путь в GOOGLE_SERVICE_ACCOUNT_FILE.`
    );
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: config.googleServiceAccountFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth.getClient();
}

async function getSheets() {
  if (!sheetsClient) {
    const authClient = await getAuth();
    sheetsClient = google.sheets({ version: 'v4', auth: authClient });
  }
  return sheetsClient;
}

async function refreshSettings() {
  try {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.sheetId,
      range: `${config.settingsSheetName}!A2:B`,
    });
    const rows = res.data.values || [];
    const values = { ...DEFAULT_SETTINGS };
    for (const [key, value] of rows) {
      if (key && value !== undefined && value !== '') values[key.trim()] = value;
    }
    cache = { values, fetchedAt: Date.now() };
  } catch (err) {
    console.error('[sheets] не удалось обновить настройки, использую кэш/дефолты:', err.message);
  }
  return cache.values;
}

function getSettingsSync() {
  return cache.values;
}

function startSettingsPolling() {
  refreshSettings();
  setInterval(refreshSettings, config.settingsRefreshMs);
}

function render(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => (vars[key] !== undefined ? vars[key] : `{${key}}`));
}

// Возвращает номер строки, куда легла запись (нужен, чтобы позже дописать комментарий).
async function appendLead(lead) {
  const sheets = await getSheets();
  const now = new Date();
  const date = now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: config.sheetId,
    range: `${config.leadsSheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        date,
        lead.first_name || '',
        lead.phone || '',
        lead.channel || '',
        lead.promo || '',
        lead.username ? `@${lead.username}` : '',
        lead.comment || '',
      ]],
    },
  });
  const updatedRange = res.data.updates && res.data.updates.updatedRange; // напр. "Лиды!A5:G5"
  const match = updatedRange && updatedRange.match(/(\d+):/);
  return match ? Number(match[1]) : null;
}

async function updateLeadComment(rowNumber, comment) {
  if (!rowNumber) return;
  const sheets = await getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.sheetId,
    range: `${config.leadsSheetName}!G${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[comment]] },
  });
}

module.exports = {
  startSettingsPolling,
  refreshSettings,
  getSettingsSync,
  render,
  appendLead,
  updateLeadComment,
};
