const { Markup } = require('telegraf');

const getDiscountKb = () =>
  Markup.inlineKeyboard([Markup.button.callback('Получить скидку', 'get_discount')]);

const consentKb = () =>
  Markup.inlineKeyboard([
    Markup.button.callback('✅ Продолжить', 'consent_yes'),
    Markup.button.callback('Отмена', 'consent_no'),
  ]);

const sharePhoneKb = () =>
  Markup.keyboard([Markup.button.contactRequest('📱 Поделиться номером телефона')])
    .oneTime()
    .resize();

const takeInWorkKb = (leadId) =>
  Markup.inlineKeyboard([Markup.button.callback('✅ Взять в работу', `take:${leadId}`)]);

module.exports = { getDiscountKb, consentKb, sharePhoneKb, takeInWorkKb };
