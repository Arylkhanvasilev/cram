/**
 * Модуль авторизации
 */
const Auth = {
    /**
     * Проверяет, авторизован ли пользователь
     */
    isAuthenticated() {
        return !!localStorage.getItem('token');
    },

    /**
     * Получает текущего пользователя
     */
    getUser() {
        const user = localStorage.getItem('user');
        return user ? JSON.parse(user) : null;
    },

    /**
     * Сохраняет данные авторизации
     */
    saveAuth(token, user) {
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
    },

    /**
     * Выход из системы
     */
    logout() {
        localStorage.clear();
        window.location.href = '/login.html';
    },

    /**
     * Редирект если не авторизован
     */
    requireAuth() {
        if (!this.isAuthenticated()) {
            window.location.href = '/login.html';
            return false;
        }
        return true;
    },

    /**
     * Редирект на дашборд если уже авторизован
     */
    redirectIfAuth() {
        if (this.isAuthenticated()) {
            window.location.href = '/dashboard.html';
        }
    }
};