const { Telegraf, Markup } = require('telegraf');
const config = require('./config');
const { getLead, upsertLead } = require('./db');
const sheets = require('./sheets');
const { normalizePhone } = require('./phone');
const { consentKb, sharePhoneKb, takeInWorkKb } = require('./keyboards');

const bot = new Telegraf(config.botToken);

const INTERESTS = {
  wardrobe: { button: 'Хочу заказать гардеробную систему', label: 'Гардеробная система' },
  partition: { button: 'Хочу заказать межкомнатные перегородки', label: 'Межкомнатные перегородки' },
  doors: { button: 'Хочу заказать двери-купе', label: 'Двери-купе' },
  discount: { button: 'Хочу получить скидку', label: 'Скидка' },
};

function vars() {
  const s = sheets.getSettingsSync();
  return { discount: s.discount, product: s.product, promo: s.promo };
}
function t(key) {
  const s = sheets.getSettingsSync();
  return sheets.render(s[key] || '', vars());
}

const PORTFOLIO_URL = 'https://disk.yandex.ru/d/tRqzmtl9AHyNXw';

function menuKb() {
  return Markup.inlineKeyboard([
    ...Object.entries(INTERESTS).map(([key, i]) => [Markup.button.callback(i.button, `want:${key}`)]),
    [Markup.button.url('📸 Примеры работ', PORTFOLIO_URL)],
  ]);
}

function channelButtonKb() {
  return Markup.inlineKeyboard([
    Markup.button.url('🔥 Получить скидку', `https://t.me/${config.botUsername}?start=channel`),
  ]);
}

async function postToChannel(ctx, text, photoFileId) {
  if (!config.channelUsername || !config.botUsername) {
    await ctx.reply('Не настроены CHANNEL_USERNAME/BOT_USERNAME — не знаю, куда и с какой ссылкой постить.');
    return;
  }
  try {
    if (photoFileId) {
      await bot.telegram.sendPhoto(config.channelUsername, photoFileId, {
        caption: text || undefined,
        ...channelButtonKb(),
      });
    } else {
      if (!text) {
        await ctx.reply('Пустой текст поста — нечего публиковать.');
        return;
      }
      await bot.telegram.sendMessage(config.channelUsername, text, channelButtonKb());
    }
    await ctx.reply(`Опубликовано в ${config.channelUsername} ✅`);
  } catch (e) {
    await ctx.reply(`Не удалось опубликовать: ${e.message}`);
  }
}

bot.command('post_channel', async (ctx, next) => {
  if (!config.ownerId || ctx.from.id !== config.ownerId) return next();
  const text = ctx.message.text.replace(/^\/post_channel(@\w+)?\s*/s, '').trim();
  await postToChannel(ctx, text, null);
});

bot.on('photo', async (ctx, next) => {
  const caption = ctx.message.caption || '';
  if (!config.ownerId || ctx.from.id !== config.ownerId || !caption.startsWith('/post_channel')) {
    return next();
  }
  const text = caption.replace(/^\/post_channel(@\w+)?\s*/s, '').trim();
  const photos = ctx.message.photo;
  await postToChannel(ctx, text, photos[photos.length - 1].file_id);
});

// Экран 1: /start — полный текст о компании + меню из 4 кнопок
bot.start(async (ctx) => {
  const channel = (ctx.startPayload || '').trim() || null;
  const existing = getLead(ctx.from.id);
  upsertLead(ctx.from.id, {
    username: ctx.from.username || null,
    first_name: ctx.from.first_name || null,
    channel: channel || (existing && existing.channel) || null,
    stage: 'menu',
  });
  await ctx.reply(t('msg_about'), menuKb());
});

// Выбор пункта меню
bot.action(/want:(\w+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const interest = ctx.match[1];
  if (!INTERESTS[interest]) return;
  const lead = getLead(ctx.from.id);

  if (interest === 'discount' && lead && lead.promo) {
    await ctx.reply(
      `Вы уже получили скидку 🙂\nВаш промокод: ${lead.promo} — скидка ${vars().discount}.\n` +
      'Менеджер с вами свяжется. Вопросы можно писать прямо сюда.'
    );
    return;
  }

  // Новая заявка — сбрасываем поля прошлой, чтобы она легла отдельной строкой
  upsertLead(ctx.from.id, {
    username: ctx.from.username || null,
    first_name: ctx.from.first_name || null,
    interest,
    comment: null,
    sheet_row: null,
    group_msg_id: null,
    taken_by: null,
    taken_at: null,
    created_at: Date.now(),
    stage: interest === 'discount' ? 'awaiting_consent' : 'awaiting_wishes',
  });

  if (interest === 'discount') {
    await askConsent(ctx, 'Чтобы закрепить скидку, нам нужен ваш номер телефона.');
  } else {
    await ctx.reply(`${INTERESTS[interest].label} — отличный выбор!\n\n${t('msg_ask_wishes')}`);
  }
});

async function askConsent(ctx, lead) {
  await ctx.reply(
    `${lead}\n\nНажимая «Продолжить», вы соглашаетесь на обработку персональных данных согласно политике.`,
    consentKb()
  );
}

// Экран 2: согласие
bot.action('consent_yes', async (ctx) => {
  await ctx.answerCbQuery();
  const lead = getLead(ctx.from.id);
  if (!lead || !lead.interest) return ctx.reply('Начните с команды /start');
  upsertLead(ctx.from.id, { stage: 'awaiting_phone' });
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  const ask = lead.interest === 'discount' ? t('msg_ask_phone') : 'Оставьте номер, чтобы менеджер связался с вами и сделал расчёт.';
  await ctx.reply(
    `${ask}\n\nНажмите кнопку ниже — это безопасно, номер возьмётся из вашего аккаунта. ` +
    'Или введите вручную в формате +79991234567.',
    sharePhoneKb()
  );
});

bot.action('consent_no', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  await ctx.reply('Хорошо, если передумаете — просто напишите /start.', Markup.removeKeyboard());
});

bot.on('contact', async (ctx) => {
  const lead = getLead(ctx.from.id);
  if (!lead || lead.stage !== 'awaiting_phone') return;
  await finalizePhone(ctx, normalizePhone(ctx.message.contact.phone_number));
});

bot.on('text', async (ctx) => {
  const lead = getLead(ctx.from.id);
  if (!lead) return;
  const text = ctx.message.text.trim();

  if (lead.stage === 'awaiting_wishes') {
    upsertLead(ctx.from.id, { comment: text, stage: 'awaiting_consent' });
    await askConsent(ctx, 'Спасибо! Чтобы менеджер мог связаться с вами, нужен номер телефона.');
    return;
  }

  if (lead.stage === 'awaiting_phone') {
    const phone = normalizePhone(text);
    if (!phone) {
      await ctx.reply(
        'Хм, это не похоже на номер телефона 🤔\n' +
        'Введите его в формате +79991234567 или нажмите кнопку «Поделиться номером».'
      );
      return;
    }
    await finalizePhone(ctx, phone);
    return;
  }

  if (lead.stage === 'awaiting_comment_optional') {
    upsertLead(ctx.from.id, { comment: text, stage: 'done' });
    await sheets.updateLeadComment(lead.sheet_row, text).catch((e) =>
      console.error('[sheets] не удалось дописать комментарий:', e.message)
    );
    await updateGroupCardComment(getLead(ctx.from.id));
    await ctx.reply('Записала, передам менеджеру 👍', Markup.removeKeyboard());
  }
});

async function finalizePhone(ctx, phone) {
  const telegramId = ctx.from.id;
  const lead = getLead(telegramId);
  const isDiscount = lead.interest === 'discount';

  upsertLead(telegramId, {
    phone,
    promo: isDiscount ? vars().promo : lead.promo,
    stage: isDiscount ? 'awaiting_comment_optional' : 'done',
  });

  if (isDiscount) {
    await ctx.reply(
      `${t('msg_promo')}\n\nМенеджер свяжется с вами в ближайшее время. ` +
      'Если хотите ускорить — напишите площадь помещения или удобное время звонка прямо сюда 👇',
      Markup.removeKeyboard()
    );
  } else {
    await ctx.reply('Спасибо! Заявка принята — менеджер свяжется с вами в ближайшее время 🙌', Markup.removeKeyboard());
  }

  const updated = getLead(telegramId);
  let rowNumber = null;
  try {
    rowNumber = await sheets.appendLead({
      ...updated,
      promo: isDiscount ? updated.promo : '',
      interest: INTERESTS[updated.interest].label,
    });
  } catch (e) {
    console.error('[sheets] не удалось записать лид:', e.message);
  }
  if (rowNumber) upsertLead(telegramId, { sheet_row: rowNumber });

  await postLeadCard(getLead(telegramId));
}

function cardText(lead) {
  const dt = new Date(lead.created_at).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const interest = lead.interest && INTERESTS[lead.interest] ? INTERESTS[lead.interest].label : '—';
  return (
    `🔥 Новый лид · ${interest} · источник: ${lead.channel || '—'}\n` +
    `👤 ${lead.first_name || ''}${lead.username ? ` (@${lead.username})` : ''}\n` +
    `📱 ${lead.phone}\n` +
    `🕐 ${dt}` +
    (lead.comment ? `\n💬 ${lead.comment}` : '')
  );
}

async function postLeadCard(lead) {
  try {
    const msg = await bot.telegram.sendMessage(config.leadsChatId, cardText(lead), takeInWorkKb(lead.telegram_id));
    upsertLead(lead.telegram_id, { group_msg_id: msg.message_id });
  } catch (e) {
    console.error('[bot] не удалось отправить карточку лида в группу:', e.message);
  }
}

async function updateGroupCardComment(lead) {
  if (!lead.group_msg_id) return;
  try {
    await bot.telegram.editMessageText(
      config.leadsChatId, lead.group_msg_id, undefined, cardText(lead), takeInWorkKb(lead.telegram_id)
    );
  } catch (e) {
    console.error('[bot] не удалось обновить карточку лида комментарием:', e.message);
  }
}

// «Взять в работу»
bot.action(/take:(\d+)/, async (ctx) => {
  const leadTelegramId = Number(ctx.match[1]);
  const lead = getLead(leadTelegramId);
  if (!lead) return ctx.answerCbQuery('Лид не найден');
  if (lead.taken_by) return ctx.answerCbQuery(`Уже взял в работу: ${lead.taken_by}`);
  const takenBy = ctx.from.first_name + (ctx.from.username ? ` (@${ctx.from.username})` : '');
  const takenAt = Date.now();
  upsertLead(leadTelegramId, { taken_by: takenBy, taken_at: takenAt });
  const time = new Date(takenAt).toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit',
  });
  await ctx.editMessageText(`${cardText(lead)}\n\n✅ В работе — ${takenBy}, ${time}`);
  await ctx.answerCbQuery('Взято в работу');
});

module.exports = bot;
