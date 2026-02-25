const TelegramBot = require('node-telegram-bot-api');

// ============ НАСТРОЙКИ ============
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

// ============ ЗАПУСК БОТА ============
const bot = new TelegramBot(TOKEN, { 
    polling: {
        interval: 300,
        autoStart: true,
        params: { timeout: 10 }
    }
});

// Хранилище
const userStates = {};
const userData = {};

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

// ============ ОБРАБОТКА ОШИБОК ============
bot.on('polling_error', (err) => {
    console.error('⚠️ Ошибка polling:', err.message);
    setTimeout(() => bot.startPolling(), 5000);
});

bot.on('error', (err) => {
    console.error('❌ Ошибка бота:', err.message);
});

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
});

// ============ ОСНОВНАЯ ЛОГИКА ============
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const state = userStates[chatId];
    
    if (text === '/start') return;
    if (!text && !msg.contact) return;
    
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
                firstName, lastName,
                fullName: `${firstName} ${lastName}`,
                age,
                username: msg.from.username,
                userId: chatId
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