const fs = require('fs');
const path = require('path');
const config = require('./config');

const dbDir = path.dirname(config.dbFile);
const storeFile = path.join(dbDir, 'leads.json');
fs.mkdirSync(dbDir, { recursive: true });

function load() {
  try {
    return JSON.parse(fs.readFileSync(storeFile, 'utf8'));
  } catch {
    return {};
  }
}

function saveAtomic(data) {
  const tmpFile = storeFile + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpFile, storeFile);
}

let store = load();

function getLead(telegramId) {
  return store[String(telegramId)];
}

function upsertLead(telegramId, fields) {
  const key = String(telegramId);
  const existing = store[key];
  const ts = Date.now();

  const base = existing || {
    telegram_id: telegramId,
    username: null,
    first_name: null,
    channel: null,
    stage: 'awaiting_consent',
    phone: null,
    comment: null,
    promo: null,
    sheet_row: null,
    group_msg_id: null,
    taken_by: null,
    taken_at: null,
    created_at: ts,
    updated_at: ts,
  };

  store[key] = { ...base, ...fields, updated_at: ts };
  saveAtomic(store);
  return store[key];
}

function deleteLead(telegramId) {
  delete store[String(telegramId)];
  saveAtomic(store);
}

module.exports = { getLead, upsertLead, deleteLead };
