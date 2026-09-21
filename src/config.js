require('dotenv').config();
const path = require('path');

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Не задана переменная окружения ${name} (см. .env.example)`);
  return v;
}

module.exports = {
  botToken: required('BOT_TOKEN'),
  leadsChatId: required('LEADS_CHAT_ID'),
  sheetId: required('SHEET_ID'),
  googleServiceAccountFile: path.resolve(process.env.GOOGLE_SERVICE_ACCOUNT_FILE || './service-account.json'),
  leadsSheetName: process.env.LEADS_SHEET_NAME || 'Лиды',
  settingsSheetName: process.env.SETTINGS_SHEET_NAME || 'Настройки',
  settingsRefreshMs: Number(process.env.SETTINGS_REFRESH_MS || 120000),
  dbFile: path.resolve(process.env.DB_FILE || './data/bot.db'),
  ownerId: process.env.OWNER_ID ? Number(process.env.OWNER_ID) : null,
  channelUsername: process.env.CHANNEL_USERNAME || null,
  botUsername: process.env.BOT_USERNAME || null,
};
