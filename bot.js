const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// ============ НАСТРОЙКИ ============
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

// Очистка неактивных пользователей
const INACTIVE_TIMEOUT_MS = 30 * 60 * 1000;     // 30 минут без активности → удаляем
const MAX_USERS_IN_MEMORY = 5000;               // максимум пользователей в памяти
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;      // проверяем каждые 5 минут

// Хранилище
const userStates = {};
const userData = {};   // теперь будет содержать lastActivity

// Тренеры и цены
const COACHES = [
    'Байкалов Артём Владимирович',
    'Харюшин Всеволод Евгеньевич',
    'Прокофьев Максим Александрович'
];

const PRICES = {
    [COACHES[0]]: 'от 2000 руб.',
    [COACHES[1]]: 'от 1500 руб.',
    [COACHES[2]]: 'от 2000 руб.'
};

// ============ ЗАПУСК БОТА ============
const bot = new TelegramBot(TOKEN, { 
    polling: {
        interval: 300,
        autoStart: true,
        params: { timeout: 10 }
    }
});

// ============ ОБРАБОТКА ОШИБОК ============
bot.on('polling_error', (err) => {
    console.error('⚠️ Ошибка polling:', err.message);
    setTimeout(() => bot.startPolling(), 5000);
});

bot.on('error', (err) => {
    console.error('❌ Ошибка бота:', err.message);
});

// ============ ПЕРИОДИЧЕСКАЯ ЧИСТКА ПАМЯТИ ============
setInterval(() => {
    const now = Date.now();
    let deletedCount = 0;

    for (const chatId in userData) {
        const last = userData[chatId]?.lastActivity || 0;
        if (now - last > INACTIVE_TIMEOUT_MS) {
            delete userStates[chatId];
            delete userData[chatId];
            deletedCount++;
        }
    }

    // Если всё равно слишком много — удаляем самые старые
    const userCount = Object.keys(userData).length;
    if (userCount > MAX_USERS_IN_MEMORY) {
        const sortedByOldest = Object.entries(userData)
            .sort(([, a], [, b]) => (a.lastActivity || 0) - (b.lastActivity || 0));

        const toDelete = sortedByOldest.slice(0, userCount - MAX_USERS_IN_MEMORY + 100);
        toDelete.forEach(([chatId]) => {
            delete userStates[chatId];
            delete userData[chatId];
            deletedCount++;
        });
    }

    if (deletedCount > 0) {
        console.log(`🧹 Очищено ${deletedCount} неактивных пользователей. Осталось: ${Object.keys(userData).length}`);
    }
}, CLEANUP_INTERVAL_MS);

// ============ /START ============
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const name = msg.from.first_name || 'друг';
    
    delete userStates[chatId];
    delete userData[chatId];
    
    bot.sendMessage(chatId, 
        `👋 Привет, ${name}!\n\n` +
        `🥊 Добро пожаловать в клуб «СОДРУЖЕСТВО»!\n\n` +
        `📍 Абакан, ул. Стофато, 9\n` +
        `🏆 Бокс и кикбоксинг\n\n` +
        `Хочешь присоединиться? 👇`,
        {
            reply_markup: {
                keyboard: [[{ text: '✅ ПРИСОЕДИНИТЬСЯ' }]],
                resize_keyboard: true
            }
        }
    );
    
    userStates[chatId] = 'waiting_for_join';
    // Инициализируем lastActivity
    userData[chatId] = { lastActivity: Date.now() };
});

// ============ ОСНОВНАЯ ЛОГИКА ============
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const state = userStates[chatId];
    
    if (text === '/start') return;
    if (!text && !msg.contact) return;

    // Обновляем время активности при любом сообщении
    if (userData[chatId]) {
        userData[chatId].lastActivity = Date.now();
    }
    
    try {
        // ШАГ 1: Начало
        if (state === 'waiting_for_join' && text === '✅ ПРИСОЕДИНИТЬСЯ') {
            userStates[chatId] = 'waiting_for_name_age';
            bot.sendMessage(chatId,
                '📝 Напиши имя, фамилию и возраст:\nПример: Иван Петров 25',
                { reply_markup: { remove_keyboard: true } }
            );
            return;
        }
        
        // ШАГ 2: Имя и возраст
        if (state === 'waiting_for_name_age') {
            const parts = text.trim().split(/\s+/);
            
            if (parts.length < 3) {
                bot.sendMessage(chatId, '❌ Нужно: имя фамилия возраст');
                return;
            }
            
            const age = parseInt(parts.pop());
            const firstName = parts[0];
            const lastName = parts.slice(1).join(' ');
            
            if (isNaN(age) || age < 3 || age > 100) {
                bot.sendMessage(chatId, '❌ Возраст от 3 до 100 лет');
                return;
            }
            
            userData[chatId] = {
                ...(userData[chatId] || {}),
                firstName, 
                lastName,
                fullName: `${firstName} ${lastName}`,
                age,
                username: msg.from.username,
                userId: chatId,
                lastActivity: Date.now()
            };
            
            userStates[chatId] = 'waiting_for_phone';
            
            bot.sendMessage(chatId,
                `✅ ${firstName}, теперь телефон:`,
                {
                    reply_markup: {
                        keyboard: [[{ 
                            text: '📱 Отправить номер', 
                            request_contact: true 
                        }]],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                }
            );
            return;
        }
        
        // ШАГ 3: Телефон
        if (state === 'waiting_for_phone') {
            let phone = '';
            
            if (msg.contact) {
                phone = msg.contact.phone_number;
            } else if (/^[\d\s\+\-\(\)]{10,20}$/.test(text)) {
                phone = text.trim();
            } else {
                bot.sendMessage(chatId, '❌ Отправь номер кнопкой или введи');
                return;
            }
            
            userData[chatId].phone = phone;
            userData[chatId].lastActivity = Date.now();
            userStates[chatId] = 'waiting_for_training_type';
            
            bot.sendMessage(chatId,
                '✅ Выбери тип тренировки:',
                {
                    reply_markup: {
                        keyboard: [
                            [{ text: '🥊 Групповая' }],
                            [{ text: '👤 Индивидуальная' }]
                        ],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                }
            );
            return;
        }
        
        // ШАГ 4: Тип тренировки
        if (state === 'waiting_for_training_type') {
            if (text === '🥊 Групповая') {
                await sendGroupInfo(chatId);
            } else if (text === '👤 Индивидуальная') {
                userStates[chatId] = 'waiting_for_coach';
                const keyboard = COACHES.map(c => [{ text: c }]);
                bot.sendMessage(chatId, '👤 Выбери тренера:', {
                    reply_markup: { keyboard, resize_keyboard: true, one_time_keyboard: true }
                });
            } else {
                bot.sendMessage(chatId, '❌ Выбери из меню');
            }
            return;
        }
        
        // ШАГ 5: Выбор тренера
        if (state === 'waiting_for_coach') {
            if (!COACHES.includes(text)) {
                bot.sendMessage(chatId, '❌ Выбери тренера из списка');
                return;
            }
            await sendPersonalInfo(chatId, text);
            return;
        }
        
        // Неизвестная команда
        bot.sendMessage(chatId, '❓ Напиши /start для начала');
        
    } catch (err) {
        console.error('❌ Ошибка:', err);
        bot.sendMessage(chatId, '⚠️ Ошибка. Попробуй /start');
    }
});

// ============ ОТПРАВКА ИНФОРМАЦИИ ============

async function sendGroupInfo(chatId) {
    const user = userData[chatId];
    
    const text = 
        `✅ Групповые тренировки!\n\n` +
        `📅 Пн-Пт: 17:30-21:00\n` +
        `📅 Сб: 11:00-16:00\n` +
        `💰 От 4000 руб/мес\n\n` +
        `📍 ул. Стофато, 9\n` +
        `🎁 Первая тренировка БЕСПЛАТНО!`;
    
    await bot.sendMessage(chatId, text, { reply_markup: { remove_keyboard: true } });
    await notifyAdmin(user, 'Групповая');
    
    // Очистка после завершения
    delete userStates[chatId];
    delete userData[chatId];
}

async function sendPersonalInfo(chatId, coach) {
    const user = userData[chatId];
    
    const text = 
        `✅ Индивидуальные занятия!\n\n` +
        `👤 Тренер: ${coach}\n` +
        `💰 ${PRICES[coach]}\n\n` +
        `📍 ул. Стофато, 9\n` +
        `🎁 Первая тренировка БЕСПЛАТНО!`;
    
    await bot.sendMessage(chatId, text, { reply_markup: { remove_keyboard: true } });
    await notifyAdmin(user, 'Индивидуальная', coach);
    
    // Очистка после завершения
    delete userStates[chatId];
    delete userData[chatId];
}

// ============ УВЕДОМЛЕНИЕ АДМИНУ ============

async function notifyAdmin(user, type, coach = null) {
    const time = new Date().toLocaleString('ru-RU');
    
    let text = 
        `🔥 НОВАЯ ЗАЯВКА!\n\n` +
        `👤 ${user.fullName}\n` +
        `🎂 ${user.age} лет\n` +
        `📱 ${user.phone}\n` +
        `🥊 ${type}`;
    
    if (coach) text += `\n👨‍🏫 ${coach}`;
    
    text += `\n\n📱 @${user.username || 'нет'}\n🆔 ${user.userId}\n⏰ ${time}`;
    
    if (user.username) {
        text += `\n🔗 t.me/${user.username}`;
    }
    
    try {
        await bot.sendMessage(ADMIN_ID, text);
        console.log(`✅ Заявка: ${user.fullName}`);
    } catch (err) {
        console.error('❌ Ошибка отправки админу:', err.message);
    }
}

// ============ СТАРТ ============
console.log('🤖 Бот Содружество запущен!');
console.log(`⏰ ${new Date().toLocaleString('ru-RU')}`);

// ============ EXPRESS ДЛЯ RAILWAY ============
const app = express();

app.get('/', (req, res) => {
    res.send('🤖 Бот Содружество запущен! Память под контролем.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌍 Web server started on port ${PORT}`));