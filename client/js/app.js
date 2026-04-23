// app.js - Common application functions
const API_URL = 'http://localhost:3000/api';

class ApiClient {
    constructor() {
        this.token = localStorage.getItem('token');
    }

    setToken(token) {
        this.token = token;
        localStorage.setItem('token', token);
    }

    clearToken() {
        this.token = null;
        localStorage.removeItem('token');
    }

    async request(endpoint, options = {}) {
        const url = `${API_URL}${endpoint}`;

        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        const config = {
            ...options,
            headers
        };

        try {
            const response = await fetch(url, config);

            if (response.status === 401) {
                this.clearToken();
                window.location.href = '/login.html';
                throw new Error('Unauthorized');
            }

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Request failed');
            }

            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }

    get(endpoint) {
        return this.request(endpoint);
    }

    post(endpoint, body) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(body)
        });
    }

    put(endpoint, body) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(body)
        });
    }

    patch(endpoint, body) {
        return this.request(endpoint, {
            method: 'PATCH',
            body: JSON.stringify(body),
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }

    delete(endpoint) {
        return this.request(endpoint, {
            method: 'DELETE'
        });
    }
}

// Создаём экземпляр и делаем его глобально доступным
const api = new ApiClient();
window.api = api;

// Utility functions
window.formatDate = function (dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

window.isOverdue = function (deadline) {
    return new Date(deadline) < new Date();
};

window.showNotification = function (message, type = 'info') {
    // В начале файла добавьте:
    const shownNotifications = new Set();

    window.showNotification = function (message, type = 'info') {
        // Создаём уникальный ключ для уведомления
        const key = `${message}-${type}-${Date.now()}`;

        // Проверяем, не показывали ли мы такое же уведомление недавно
        const recentKey = `${message}-${type}`;
        if (shownNotifications.has(recentKey)) {
            console.log('Notification already shown recently:', message);
            return;
        }

        // Запоминаем, что показали
        shownNotifications.add(recentKey);

        // Очищаем через 10 секунд
        setTimeout(() => {
            shownNotifications.delete(recentKey);
        }, 10000);

        const container = document.getElementById('notificationContainer');
        if (!container) {
            console.log('Notification container not found:', message);
            return;
        }

        const notification = document.createElement('div');
        notification.className = `notification-toast ${type}`;
        notification.textContent = message;

        container.appendChild(notification);

        // Анимация появления
        setTimeout(() => notification.classList.add('show'), 10);

        // Автоматическое скрытие
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 5000);

        // Закрытие по клику
        notification.addEventListener('click', () => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        });
    };
    
    const container = document.getElementById('notificationContainer');
    if (!container) return;

    const notification = document.createElement('div');
    notification.className = `notification-toast ${type}`;
    notification.textContent = message;

    container.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 300);
    }, 5000);

    notification.addEventListener('click', () => notification.remove());
};

window.checkAuth = function () {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login.html';
        return false;
    }
    return true;
};

window.logout = function () {
    api.clearToken();
    window.location.href = '/login.html';
};

// ========== УПРАВЛЕНИЕ ТЕМОЙ ==========

// Применяет тему ко всему сайту
window.applyTheme = function (theme) {
    let actualTheme = theme;

    // Если тема "system" - определяем по системе
    if (theme === 'system') {
        actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    // Применяем тему к body
    document.body.setAttribute('data-theme', actualTheme);

    // Сохраняем в localStorage
    localStorage.setItem('theme', theme);

    console.log('Theme applied:', theme, '→', actualTheme);
};

// Загружает сохранённую тему при старте
window.loadTheme = function () {
    const savedTheme = localStorage.getItem('theme') || 'light';
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    // Приоритет: тема из профиля пользователя > сохранённая тема > light
    const theme = user.theme || savedTheme;

    applyTheme(theme);

    // Слушаем изменения системной темы
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        const currentTheme = localStorage.getItem('theme');
        if (currentTheme === 'system') {
            applyTheme('system');
        }
    });
};

// Вызываем при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
});

// Экспортируем для использования в других модулях
window.themeManager = {
    apply: applyTheme,
    load: loadTheme,
    getCurrent: () => localStorage.getItem('theme') || 'light'
};