/**
 * Модуль списка задач Cram
 */
class TasksController {
    constructor() {
        this.user = Auth.getUser() || {};
        this.tasks = [];
        this.openCards = new Set();
        this.openDayGroups = new Set();
        window.tasksCtrl = this;
    }

    async init() {
        if (!Auth.requireAuth()) return;

        const today = new Date().toISOString().split('T')[0];
        if (!this.openDayGroups.size) {
            this.openDayGroups.add(today);
        }

        this.renderUserInfo();
        this.toggleTeacherUI();
        await this.loadTasks();
        this.bindEvents();
    }

    renderUserInfo() {
        const firstName = (this.user.name || 'Пользователь').split(' ')[0];

        const navFallback = document.getElementById('navAvatarFallback');
        if (navFallback) {
            navFallback.textContent = firstName.charAt(0).toUpperCase();
            navFallback.style.display = 'flex';
        }
    }

    toggleTeacherUI() {
        const addBtn = document.getElementById('addTaskBtn');
        if (addBtn && this.user.role === CONFIG.ROLES.TEACHER) {
            addBtn.style.display = 'flex';
        }
    }

    async loadTasks() {
        try {
            this.tasks = await api.get('/assignments');
            console.log('Tasks loaded:', this.tasks.length, 'Pending:', this.tasks.filter(t => t.status === 'pending').length, 'Done:', this.tasks.filter(t => t.status !== 'pending').length);
            this.renderAll();
        } catch (error) {
            showToast('Ошибка загрузки задач', 'error');
        }
    }

    renderAll() {
        this.renderActiveTasks();
        this.renderPastTasks();
    }

    // ===== АКТИВНЫЕ ЗАДАЧИ =====
    renderActiveTasks() {
        const container = document.getElementById('tasksContainer');

        if (this.user.role === 'teacher') {
            this.renderTeacherTasks(container);
            return;
        }

        const tasks = this.tasks.filter(t => t.status === 'pending');

        if (!tasks.length) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state__icon">🎉</div><p>Нет активных задач</p></div>';
            return;
        }

        const grouped = this._groupByDate(tasks);
        container.innerHTML = this._renderGroupedTasks(grouped);
        this._bindCardEvents();
        this._bindDayGroupEvents();
    }

    // ===== ДЛЯ УЧИТЕЛЯ =====
    renderTeacherTasks(container) {
        const activeTasks = this.tasks.filter(t => {
            const total = parseInt(t.total_students) || 0;
            const completed = parseInt(t.completed_count) || 0;
            return completed < total;
        });

        if (activeTasks.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>Все задания выполнены</p></div>';
            return;
        }

        const grouped = this._groupByDate(activeTasks);
        const today = new Date().toISOString().split('T')[0];
        const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

        const sortedDays = Object.keys(grouped).sort((a, b) => {
            if (a === today) return -1;
            if (b === today) return 1;
            if (a === tomorrow) return -1;
            if (b === tomorrow) return 1;
            return a.localeCompare(b);
        });

        let html = '';
        sortedDays.forEach((day, index) => {
            const dayTasks = grouped[day];
            const isOpen = this.openDayGroups.has(day);
            const colorClass = DAY_COLOR_CLASSES[index % 4];

            let label = getDayLabel(day);
            if (day === today) label = 'Сегодня';
            else if (day === tomorrow) label = 'Завтра';

            html += `
                <div class="day-group ${colorClass}">
                    <div class="day-group__header day-group__header--clickable" data-day="${day}">
                        <span class="day-group__label">${label}</span>
                        <span class="day-group__count">${dayTasks.length} ${pluralizeTasks(dayTasks.length)}</span>
                    </div>
                    <div class="day-group__content" style="${isOpen ? '' : 'display: none;'}">
                        ${dayTasks.map(t => this._createTeacherTaskCard(t)).join('')}
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
        this._bindTeacherCardEvents();
        this._bindDayGroupEvents();
    }

    _createTeacherTaskCard(task) {
        const total = parseInt(task.total_students) || 0;
        const completed = parseInt(task.completed_count) || 0;
        const isOpen = this.openCards.has(task.id);

        let studentsList = [];
        try {
            studentsList = typeof task.students === 'string' ? JSON.parse(task.students) : (task.students || []);
        } catch (e) { }

        return `
            <div class="task-card ${isOpen ? 'task-card--open' : ''}" data-id="${task.id}">
                <div class="task-card__header">
                    <div class="task-card__info">
                        <div class="task-card__title">${task.title}</div>
                        <div class="task-card__deadline">📚 ${task.subject} · ⏰ ${formatDate(task.deadline)} · ✅ ${completed}/${total}</div>
                    </div>
                    <svg class="task-card__arrow" width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </div>
                <div class="task-card__body">
                    ${task.description ? `<div style="margin-bottom:12px;font-size:14px;">${task.description}</div>` : ''}
                    <div style="font-weight:600;font-size:13px;margin-bottom:8px;">Ученики (${completed}/${total}):</div>
                    ${studentsList.map(s => `
                        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.06);">
                            <span>${s.student_name || 'Ученик'}</span>
                            <span style="font-weight:600;">
                                ${s.status === 'submitted' || s.status === 'graded' ? '✅ Сдано' : new Date(task.deadline) < new Date() ? '⚠️ Просрочено' : '⏳ Ожидает'}
                            </span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // ===== ПРОШЛЫЕ ЗАДАЧИ =====
    renderPastTasks() {
        const container = document.getElementById('pastTasksContainer');

        if (this.user.role === 'teacher') {
            const pastTasks = this.tasks.filter(t => {
                const total = parseInt(t.total_students) || 0;
                const completed = parseInt(t.completed_count) || 0;
                return completed >= total && total > 0;
            });

            if (!pastTasks.length) {
                container.innerHTML = '<div class="empty-state"><p>Нет завершённых заданий</p></div>';
                return;
            }

            const grouped = this._groupByDate(pastTasks);
            const sortedDays = Object.keys(grouped).sort().reverse();

            let html = '';
            sortedDays.forEach((day, index) => {
                const dayTasks = grouped[day];
                const isOpen = this.openDayGroups.has('past_' + day);
                const colorIndex = index % PAST_DAY_COLORS.length;
                const colorClass = PAST_DAY_COLOR_CLASSES[colorIndex];

                html += `
                    <div class="day-group ${colorClass}">
                        <div class="day-group__header day-group__header--clickable" data-day="past_${day}">
                            <span class="day-group__label">${getDayLabel(day)}</span>
                            <span class="day-group__count">${dayTasks.length} ${pluralizeTasks(dayTasks.length)}</span>
                        </div>
                        <div class="day-group__content" style="${isOpen ? '' : 'display: none;'}">
                            ${dayTasks.map(t => this._createTeacherTaskCard(t)).join('')}
                        </div>
                    </div>
                `;
            });

            container.innerHTML = html;
            this._bindTeacherCardEvents();
            this._bindDayGroupEvents();
            return;
        }

        const tasks = this.tasks.filter(t => t.status !== 'pending');

        if (!tasks.length) {
            container.innerHTML = '<div class="empty-state"><p>Нет прошлых задач</p></div>';
            return;
        }

        const grouped = this._groupByDate(tasks);
        const sortedDays = Object.keys(grouped).sort().reverse();

        let html = '';
        sortedDays.forEach((day, index) => {
            const dayTasks = grouped[day];
            const isOpen = this.openDayGroups.has('past_' + day);
            const colorClass = DAY_COLOR_CLASSES[index % 4];

            html += `
                <div class="day-group ${colorClass}">
                    <div class="day-group__header day-group__header--clickable" data-day="past_${day}">
                        <span class="day-group__label">${getDayLabel(day)}</span>
                        <span class="day-group__count">${dayTasks.length} ${pluralizeTasks(dayTasks.length)}</span>
                    </div>
                    <div class="day-group__content" style="${isOpen ? '' : 'display: none;'}">
                        ${dayTasks.map(t => this._createTaskCard(t)).join('')}
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
        this._bindCardEvents();
        this._bindDayGroupEvents();
    }

    // ===== ГРУППИРОВКА =====
    _groupByDate(tasks) {
        const grouped = {};
        tasks.forEach(t => {
            const day = t.deadline?.split('T')[0] || 'unknown';
            if (!grouped[day]) grouped[day] = [];
            grouped[day].push(t);
        });
        return grouped;
    }

    _renderGroupedTasks(grouped) {
        const today = new Date().toISOString().split('T')[0];
        const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

        const sortedDays = Object.keys(grouped).sort((a, b) => {
            if (a === today) return -1;
            if (b === today) return 1;
            if (a === tomorrow) return -1;
            if (b === tomorrow) return 1;
            return a.localeCompare(b);
        });

        let html = '';
        sortedDays.forEach((day, index) => {
            const dayTasks = grouped[day];
            const isOpen = this.openDayGroups.has(day);
            const colorClass = DAY_COLOR_CLASSES[index % 4];

            let label = getDayLabel(day);
            if (day === today) label = 'Сегодня';
            else if (day === tomorrow) label = 'Завтра';

            html += `
                <div class="day-group ${colorClass}">
                    <div class="day-group__header day-group__header--clickable" data-day="${day}">
                        <span class="day-group__label">${label}</span>
                        <span class="day-group__count">${dayTasks.length} ${pluralizeTasks(dayTasks.length)}</span>
                    </div>
                    <div class="day-group__content" style="${isOpen ? '' : 'display: none;'}">
                        ${dayTasks.map(t => this._createTaskCard(t)).join('')}
                    </div>
                </div>
            `;
        });

        return html;
    }

    // ===== КАРТОЧКИ =====
    _createTaskCard(task) {
        const isChecked = task.status !== 'pending';
        const isOpen = this.openCards.has(task.id);

        return `
            <div class="task-card ${isOpen ? 'task-card--open' : ''}" data-id="${task.id}">
                <div class="task-card__header">
                    <div class="checkbox-circle ${isChecked ? 'checkbox-circle--checked' : ''}" data-action="toggle" data-id="${task.id}"></div>
                    <span class="badge badge--success">${task.subject}</span>
                    <div class="task-card__info">
                        <div class="task-card__title">${task.title}</div>
                        <div class="task-card__deadline">⏰ Сдать: ${formatDate(task.deadline)}</div>
                    </div>
                    <svg class="task-card__arrow" width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </div>
                <div class="task-card__body">
                    <div class="task-card__description">${task.description || 'Нет описания'}</div>
                </div>
            </div>
        `;
    }

    // ===== ДЕЙСТВИЯ =====
    async toggleTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task || task.status !== 'pending') return;
        try {
            await api.patch(`/assignments/${taskId}/status`, { status: 'submitted' });
            showToast('✅ Задача выполнена!');
            await this.loadTasks();
        } catch {
            showToast('❌ Ошибка', 'error');
        }
    }

    toggleCard(taskId) {
        this.openCards.has(taskId) ? this.openCards.delete(taskId) : this.openCards.add(taskId);
        this.renderActiveTasks();
        this.renderPastTasks();
    }

    // ===== СОБЫТИЯ =====
    _bindCardEvents() {
        document.querySelectorAll('.checkbox-circle[data-action="toggle"]').forEach(el => {
            el.onclick = (e) => { e.stopPropagation(); this.toggleTask(parseInt(el.dataset.id)); };
        });
        document.querySelectorAll('.task-card__header').forEach(el => {
            el.onclick = (e) => { e.stopPropagation(); this.toggleCard(parseInt(el.parentElement.dataset.id)); };
        });
    }

    _bindTeacherCardEvents() {
        document.querySelectorAll('.task-card__header').forEach(el => {
            el.onclick = (e) => { e.stopPropagation(); this.toggleCard(parseInt(el.parentElement.dataset.id)); };
        });
    }

    _bindDayGroupEvents() {
        document.querySelectorAll('.day-group__header--clickable').forEach(header => {
            header.onclick = function (e) {
                e.stopPropagation();
                const day = this.dataset.day;
                const content = this.nextElementSibling;
                if (content.style.display === 'none') {
                    content.style.display = 'block';
                    if (window.tasksCtrl) window.tasksCtrl.openDayGroups.add(day);
                } else {
                    content.style.display = 'none';
                    if (window.tasksCtrl) window.tasksCtrl.openDayGroups.delete(day);
                }
            };
        });
    }

    bindEvents() {
        document.getElementById('addTaskBtn')?.addEventListener('click', () => {
            document.getElementById('taskModal').style.display = 'flex';
        });
        document.querySelector('.modal__backdrop')?.addEventListener('click', closeTaskModal);
        document.getElementById('taskForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = {
                title: document.getElementById('taskTitle').value,
                description: document.getElementById('taskDesc').value,
                subject: document.getElementById('taskSubject').value,
                deadline: document.getElementById('taskDeadline').value,
                studentIds: [2]
            };
            try {
                await api.post('/assignments', data);
                showToast('✅ Задача создана!');
                closeTaskModal();
                await this.loadTasks();
            } catch {
                showToast('❌ Ошибка', 'error');
            }
        });
    }
}

function closeTaskModal() {
    document.getElementById('taskModal').style.display = 'none';
    document.getElementById('taskForm')?.reset();
}

document.addEventListener('DOMContentLoaded', () => {
    const tasksPage = new TasksController();
    tasksPage.init();
});