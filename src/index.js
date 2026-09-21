const bot = require('./bot');
const sheets = require('./sheets');

async function main() {
  await sheets.refreshSettings();
  sheets.startSettingsPolling();

  await bot.launch();
  console.log('Бот «Экспресскупе» запущен');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch((err) => {
  console.error('Не удалось запустить бота:', err);
  process.exit(1);
});
