/**
 * Утилиты приложения Cram
 */

/**
 * Форматирует дату для отображения
 */
function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Возвращает метку дня с учётом дедлайна
 */
function getDayLabel(dateString) {
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    if (dateString === today) return 'Сегодня';
    if (dateString === tomorrow) return 'Завтра';
    if (dateString === yesterday) return 'Вчера';

    return new Date(dateString).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        weekday: 'long'
    });
}

/**
 * Показывает toast-уведомление
 */
function showToast(message, type = 'success') {
    const container = document.querySelector('.toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * Склоняет слово "задача"
 */
function pluralizeTasks(count) {
    if (count === 1) return 'задача';
    if (count >= 2 && count <= 4) return 'задачи';
    return 'задач';
}

/**
 * Возвращает эмодзи предмета
 */
function getSubjectEmoji(subject) {
    const emojiMap = {
        'Математика': '📐',
        'Алгебра': '📐',
        'Русский язык': '📝',
        'Литература': '📚',
        'История': '🏛️',
        'Химия': '🧪',
        'Физика': '⚡'
    };
    return emojiMap[subject] || '📖';
}