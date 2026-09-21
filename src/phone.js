// Нормализует телефон к формату +7XXXXXXXXXX (11 цифр). Возвращает null, если не похоже на номер.
function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    return '+7' + digits.slice(1);
  }
  if (digits.length === 10) {
    return '+7' + digits;
  }
  return null;
}

module.exports = { normalizePhone };
