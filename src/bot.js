const { Telegraf } = require('telegraf');
const config = require('./config');
const { getLead, upsertLead } = require('./db');
const sheets = require('./sheets');
const { normalizePhone } = require('./phone');
const { getDiscountKb, consentKb, sharePhoneKb, takeInWorkKb } = require('./keyboards');
const { Markup } = require('telegraf');

const bot = new Telegraf(config.botToken);

function vars() {
  const s = sheets.getSettingsSync();
  return { discount: s.discount, product: s.product, promo: s.promo };
}
function t(key) {
  const s = sheets.getSettingsSync();
  return sheets.render(s[key], vars());
}

function channelButtonKb() {
  return Markup.inlineKeyboard([
    Markup.button.url('🔥 Получить скидку', `https://t.me/${config.botUsername}?start=channel`),
  ]);
}

// Заявка на вступление в канал (канал переключён в режим «Одобрять заявки») —
// это единственный официально разрешённый Telegram случай, когда бот может
// написать в личку человеку, который никогда не жал /start. Одобряем заявку
// сразу (для человека это доля секунды) и присылаем персональное предложение.
bot.on('chat_join_request', async (ctx) => {
  const request = ctx.chatJoinRequest;
  if (!request || !config.channelUsername) return;
  const configuredUsername = config.channelUsername.replace(/^@/, '');
  if (request.chat.username !== configuredUsername) return;

  try {
    await bot.telegram.approveChatJoinRequest(request.chat.id, request.from.id);
  } catch (e) {
    console.error('[bot] не удалось одобрить заявку на вступление:', e.message);
  }

  const telegramId = request.from.id;
  const existing = getLead(telegramId);
  if (existing && existing.stage === 'done') return; // уже получал скидку — не спамим повторно

  upsertLead(telegramId, {
    username: request.from.username || null,
    first_name: request.from.first_name || null,
    channel: 'channel',
    stage: 'awaiting_consent',
  });

  try {
    await bot.telegram.sendMessage(
      telegramId,
      `${t('product')} со скидкой ${vars().discount} 👋\n\n${t('msg_channel_welcome')}\n\nЗаймёт 20 секунд.`,
      getDiscountKb()
    );
  } catch (e) {
    console.error('[bot] не удалось написать новому подписчику в личку:', e.message);
  }
});

async function postToChannel(ctx, text, photoFileId) {
  if (!config.channelUsername || !config.botUsername) {
    await ctx.reply(
      'Не настроены CHANNEL_USERNAME/BOT_USERNAME в .env — не знаю, куда и с какой ссылкой постить.'
    );
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

// Публикация поста в канал с кнопкой — только для владелицы бота
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
  const fileId = photos[photos.length - 1].file_id; // самое большое разрешение
  await postToChannel(ctx, text, fileId);
});

// Экран 1: /start [payload]
bot.start(async (ctx) => {
  const channel = (ctx.startPayload || '').trim() || null;
  const telegramId = ctx.from.id;
  const existing = getLead(telegramId);

  if (existing && existing.stage === 'done') {
    // Экран 5: повторный /start — дедуп, не плодим лид заново
    await ctx.reply(
      `Вы уже получили скидку 🙂\nВаш промокод: ${existing.promo} — скидка ${vars().discount}.\n` +
      `Менеджер с вами свяжется. Вопросы можно писать прямо сюда.`
    );
    return;
  }

  upsertLead(telegramId, {
    username: ctx.from.username || null,
    first_name: ctx.from.first_name || null,
    channel,
    stage: 'awaiting_consent',
  });

  await ctx.reply(
    `${t('product')} со скидкой ${vars().discount} 👋\n\n${t('msg_offer')}\n\nЗаймёт 20 секунд.`,
    getDiscountKb()
  );
});

// Экран 1 -> Экран 2
bot.action('get_discount', async (ctx) => {
  await ctx.answerCbQuery();
  const lead = getLead(ctx.from.id);
  if (!lead) return ctx.reply('Начните с команды /start');
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  await ctx.reply(
    'Чтобы закрепить скидку, нам нужен ваш номер телефона.\n\n' +
    'Нажимая «Продолжить», вы соглашаетесь на обработку персональных данных согласно политике.',
    consentKb()
  );
});

// Экран 2: согласие
bot.action('consent_yes', async (ctx) => {
  await ctx.answerCbQuery();
  const telegramId = ctx.from.id;
  upsertLead(telegramId, { stage: 'awaiting_phone' });
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  await ctx.reply(
    `${t('msg_ask_phone')}\n\nНажмите кнопку ниже — это безопасно, номер возьмётся из вашего аккаунта. ` +
    `Или введите вручную в формате +79991234567.`,
    sharePhoneKb()
  );
});

bot.action('consent_no', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  await ctx.reply('Хорошо, если передумаете — просто напишите /start.', Markup.removeKeyboard());
});

// Получение телефона кнопкой «Поделиться номером»
bot.on('contact', async (ctx) => {
  const lead = getLead(ctx.from.id);
  if (!lead || lead.stage !== 'awaiting_phone') return;
  const phone = normalizePhone(ctx.message.contact.phone_number);
  await finalizePhone(ctx, phone);
});

// Текстовые сообщения: ручной ввод телефона (Экран 3/3а) или комментарий (Экран 4, добор)
bot.on('text', async (ctx) => {
  const lead = getLead(ctx.from.id);
  if (!lead) return; // не в сценарии — молчим, чтобы не мешать другим сообщениям в чат
  const text = ctx.message.text.trim();

  if (lead.stage === 'awaiting_phone') {
    const phone = normalizePhone(text);
    if (!phone) {
      // Экран 3а: ошибка валидации
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
    await updateGroupCardComment(lead, text);
    await ctx.reply('Записала, передам менеджеру 👍', Markup.removeKeyboard());
    return;
  }
  // stage === 'done' и т.п. — свободный текст вне сценария, не реагируем
});

async function finalizePhone(ctx, phone) {
  const telegramId = ctx.from.id;
  const lead = getLead(telegramId);
  const promo = vars().promo;

  upsertLead(telegramId, { phone, promo, stage: 'awaiting_comment_optional' });

  await ctx.reply(
    `${t('msg_promo')}\n\nМенеджер свяжется с вами в ближайшее время. ` +
    `Если хотите ускорить — напишите площадь помещения или удобное время звонка прямо сюда 👇`,
    Markup.removeKeyboard()
  );

  const updated = getLead(telegramId);
  let rowNumber = null;
  try {
    rowNumber = await sheets.appendLead(updated);
  } catch (e) {
    console.error('[sheets] не удалось записать лид:', e.message);
  }
  if (rowNumber) upsertLead(telegramId, { sheet_row: rowNumber });

  await postLeadCard(getLead(telegramId));
}

async function postLeadCard(lead) {
  const dt = new Date(lead.created_at).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const text =
    `🔥 Новый лид · источник: ${lead.channel || '—'}\n` +
    `👤 ${lead.first_name || ''}${lead.username ? ` (@${lead.username})` : ''}\n` +
    `📱 ${lead.phone}\n` +
    `🕐 ${dt}`;
  try {
    const msg = await bot.telegram.sendMessage(config.leadsChatId, text, takeInWorkKb(lead.telegram_id));
    upsertLead(lead.telegram_id, { group_msg_id: msg.message_id });
  } catch (e) {
    console.error('[bot] не удалось отправить карточку лида в группу:', e.message);
  }
}

async function updateGroupCardComment(lead, comment) {
  if (!lead.group_msg_id) return;
  try {
    await bot.telegram.editMessageText(
      config.leadsChatId,
      lead.group_msg_id,
      undefined,
      `${await cardBaseText(lead)}\n💬 ${comment}`,
      takeInWorkKb(lead.telegram_id)
    );
  } catch (e) {
    console.error('[bot] не удалось обновить карточку лида комментарием:', e.message);
  }
}

async function cardBaseText(lead) {
  const dt = new Date(lead.created_at).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return (
    `🔥 Новый лид · источник: ${lead.channel || '—'}\n` +
    `👤 ${lead.first_name || ''}${lead.username ? ` (@${lead.username})` : ''}\n` +
    `📱 ${lead.phone}\n` +
    `🕐 ${dt}`
  );
}

// Экран 6: «Взять в работу»
bot.action(/take:(\d+)/, async (ctx) => {
  const leadTelegramId = Number(ctx.match[1]);
  const lead = getLead(leadTelegramId);
  if (!lead) return ctx.answerCbQuery('Лид не найден');
  if (lead.taken_by) {
    await ctx.answerCbQuery(`Уже взял в работу: ${lead.taken_by}`);
    return;
  }
  const takenBy = ctx.from.first_name + (ctx.from.username ? ` (@${ctx.from.username})` : '');
  const takenAt = Date.now();
  upsertLead(leadTelegramId, { taken_by: takenBy, taken_at: takenAt });

  const time = new Date(takenAt).toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit',
  });
  const base = await cardBaseText(lead);
  const commentLine = lead.comment ? `\n💬 ${lead.comment}` : '';
  await ctx.editMessageText(
    `${base}${commentLine}\n\n✅ В работе — ${takenBy}, ${time}`
  );
  await ctx.answerCbQuery('Взято в работу');
});

module.exports = bot;
