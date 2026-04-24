/**
 * Модуль дашборда Cram
 */
class DashboardController {
    constructor() {
        this.user = Auth.getUser() || {};
        this.tasks = [];
        this.currentFilter = 'all';
        this.openCards = new Set();
        this.openDayGroups = new Set();

        window.dash = this;
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
        const fullName = this.user.name || 'Пользователь';
        const firstName = fullName.split(' ')[0];

        document.getElementById('userName').textContent = firstName;
        document.getElementById('avatarText').textContent = firstName.charAt(0).toUpperCase();

        const navAvatar = document.getElementById('navAvatar');
        const navFallback = document.getElementById('navAvatarFallback');
        if (navFallback) {
            navFallback.textContent = firstName.charAt(0).toUpperCase();
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
            this.renderAll();
        } catch (error) {
            showToast('Ошибка загрузки задач', 'error');
        }
    }

    renderAll() {
        this.renderDates();
        this.renderProgress();
        this.renderActiveTasks();
        this.renderPastTasks();
    }

    /**
     * Рендерит чипсы дат: число + день недели
     */
    renderDates() {
        const container = document.getElementById('dateScroll');

        // Собираем даты ДЕДЛАЙНОВ
        const dates = [...new Set(this.tasks
            .map(t => t.deadline?.split('T')[0])
            .filter(Boolean))]
            .sort(); // Ближайшие сверху

        const dayNames = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];

        // Кнопка "Все"
        let html = `
        <button class="chip chip--all chip--active" data-date="all">
            <span class="chip__date">Все</span>
        </button>
    `;

        dates.forEach(date => {
            const d = new Date(date);

            // Пропускаем даты в прошлом, если сегодня уже прошло
            // (опционально, можно оставить)

            html += `
            <button class="chip" data-date="${date}">
                <span class="chip__date">${d.getDate()}</span>
                <span class="chip__day">${dayNames[d.getDay()]}</span>
            </button>
        `;
        });

        container.innerHTML = html;
    }

    /**
  * Рендерит прогресс: показывает все активные задачи, а не только сегодня
  */
    renderProgress() {
        // Все pending задачи
        const pendingTasks = this.tasks.filter(t => t.status === 'pending');
        const total = pendingTasks.length;

        // Всего задач (для статистики)
        const allTotal = this.tasks.length;
        const done = this.tasks.filter(t =>
            t.status === 'submitted' || t.status === 'graded'
        ).length;
        const percent = allTotal ? Math.round((done / allTotal) * 100) : 0;
        const remaining = total;

        document.getElementById('progressStats').textContent = `${done} из ${allTotal} задач`;
        document.getElementById('progressFill').style.width = `${percent}%`;
        document.getElementById('progressPercent').textContent = `Прогресс ${percent}%`;
        document.getElementById('progressRemaining').textContent = `Осталось ${remaining} ${pluralizeTasks(remaining)}`;
    }

    /**
     * Рендерит активные задачи (pending)
     */
    renderActiveTasks() {
        const container = document.getElementById('tasksContainer');

        if (this.user.role === 'teacher') {
            this.renderTeacherTasks(container);
            return;
        }

        // ТОЛЬКО pending задачи
        let tasks = this.tasks.filter(t => {
            console.log(`Task ${t.id} "${t.title}": status="${t.status}"`);
            return t.status === 'pending';
        });

        if (this.currentFilter !== 'all') {
            tasks = tasks.filter(t => t.deadline?.startsWith(this.currentFilter));
        }

        if (!tasks.length) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state__icon">🎉</div><p>Нет активных задач</p></div>';
            return;
        }

        const grouped = this._groupByDate(tasks);
        container.innerHTML = this._renderGroupedTasks(grouped);
        this._bindCardEvents();
    }

    renderTeacherTasks(container) {
        const activeTasks = this.tasks.filter(t => {
            const total = parseInt(t.total_students) || 0;
            const completed = parseInt(t.completed_count) || 0;
            return completed < total;
        });

        if (activeTasks.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state__icon">🎉</div><p>Все задания выполнены</p></div>';
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

        sortedDays.forEach(day => {
            const tasks = grouped[day];
            const isOpen = this.openDayGroups.has(day);

            const today = new Date().toISOString().split('T')[0];
            const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
            const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

            let colorClass = 'day-group--other';
            let label = getDayLabel(day);

            if (day === today) {
                colorClass = 'day-group--today';
                label = 'Сегодня';
            } else if (day === tomorrow) {
                colorClass = 'day-group--tomorrow';
                label = 'Завтра';
            } else if (day === yesterday) {
                colorClass = 'day-group--yesterday';
                label = 'Вчера';
            }

            html += `
        <div class="day-group ${colorClass}">
            <div class="day-group__header day-group__header--clickable" data-day="${day}">
                <span class="day-group__label">${label}</span>
                <span class="day-group__count">${tasks.length} ${pluralizeTasks(tasks.length)}</span>
            </div>
            <div class="day-group__content" style="${isOpen ? '' : 'display: none;'}">
                ${tasks.map(t => this._createTeacherTaskCard(t)).join('')}
            </div>
        </div>
    `;
        });

        container.innerHTML = html;
        this._bindTeacherCardEvents();
        this._bindDayGroupEvents();
    }

    /**
 * Обработчики для сворачивания/разворачивания групп дней
 */
    _bindDayGroupEvents() {
        document.querySelectorAll('.day-group__header--clickable').forEach(header => {
            header.onclick = function (e) {
                e.stopPropagation();

                const day = this.dataset.day;
                const content = this.nextElementSibling;

                if (content.style.display === 'none') {
                    content.style.display = 'block';
                    if (window.dash) window.dash.openDayGroups.add(day);
                } else {
                    content.style.display = 'none';
                    if (window.dash) window.dash.openDayGroups.delete(day);
                }
            };
        });
    }

    /**
     * Карточка задания для учителя
    */
    _createTeacherTaskCard(task) {
        const total = parseInt(task.total_students) || 0;
        const completed = parseInt(task.completed_count) || 0;
        const isOpen = this.openCards.has(task.id);

        // Парсим список учеников
        let studentsList = [];
        try {
            studentsList = typeof task.students === 'string' ? JSON.parse(task.students) : (task.students || []);
        } catch (e) {
            studentsList = [];
        }

        return `
        <div class="task-card ${isOpen ? 'task-card--open' : ''}" data-id="${task.id}">
            <div class="task-card__header">
                <div class="task-card__info">
                    <div class="task-card__title">${task.title}</div>
                    <div class="task-card__deadline">
                        📚 ${task.subject} · ⏰ Сдать: ${formatDate(task.deadline)} · 
                        ✅ ${completed}/${total} сдали
                    </div>
                </div>
                <svg class="task-card__arrow" width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
            </div>
            <div class="task-card__body">
                ${task.description ? `<div style="margin-bottom: 12px; font-size: 14px; color: var(--color-text-secondary);">${task.description}</div>` : ''}
                <div style="font-weight: 600; font-size: 13px; margin-bottom: 8px;">
                    Ученики (${completed}/${total}):
                </div>
                ${studentsList.map(s => `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--color-border-light);">
                        <span style="font-size: 14px;">${s.student_name || 'Ученик'}</span>
                        <span style="font-size: 12px; font-weight: 600; 
                            color: ${s.status === 'submitted' || s.status === 'graded' ? 'var(--color-success)' :
                new Date(task.deadline) < new Date() && s.status === 'pending' ? 'var(--color-danger)' : 'var(--color-text-muted)'};">
                            ${s.status === 'submitted' || s.status === 'graded' ? '✅ Сдано' :
                new Date(task.deadline) < new Date() ? '⚠️ Просрочено' : '⏳ Ожидает'}
                        </span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    }



    /**
     * Группировка по дате создания
     */
    _groupByDate(tasks) {
        const grouped = {};
        tasks.forEach(t => {
            // Группируем по дате создания
            const day = t.created_at?.split('T')[0] || t.deadline?.split('T')[0] || 'unknown';
            if (!grouped[day]) grouped[day] = [];
            grouped[day].push(t);
        });
        return grouped;
    }

    /**
     * Создаёт карточку задачи
     */
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

    renderActiveTasks() {
        const container = document.getElementById('tasksContainer');

        if (this.user.role === 'teacher') {
            this.renderTeacherTasks(container);
            return;
        }

        let tasks = this._filterTasks('pending');

        if (!tasks.length) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state__icon">🎉</div><p>Нет активных задач</p></div>';
            return;
        }

        const grouped = this._groupByDate(tasks);
        container.innerHTML = this._renderGroupedTasks(grouped);
        this._bindCardEvents();
        this._bindDayGroupEvents(); // ← ДОБАВИТЬ
    }
    /**
     * Прошлые задания учителя (все сдали) — тоже группируем
     */
    renderPastTasks() {
        const container = document.getElementById('pastTasksContainer');

        if (this.user.role === 'teacher') {
            const pastTasks = this.tasks.filter(t => {
                const total = parseInt(t.total_students) || 0;
                const completed = parseInt(t.completed_count) || 0;
                return completed >= total && total > 0;
            });

            if (pastTasks.length === 0) {
                container.innerHTML = '<div class="empty-state"><p>Нет завершённых заданий</p></div>';
                return;
            }

            // Группируем прошлые задания
            const grouped = this._groupByDate(pastTasks);
            const sortedDays = Object.keys(grouped).sort().reverse();

            let html = '';
            sortedDays.forEach(day => {
                const tasks = grouped[day];
                html += `
                <div class="day-group">
                    <div class="day-group__header">
                        <span class="day-group__label">📅 ${getDayLabel(day)}</span>
                        <span class="day-group__count">${tasks.length} ${pluralizeTasks(tasks.length)}</span>
                    </div>
                    ${tasks.map(t => this._createTeacherTaskCard(t)).join('')}
                </div>
            `;
            });

            container.innerHTML = html;
            this._bindTeacherCardEvents();
            return;
        }

        // Для ученика — старый код
        const tasks = this.tasks.filter(t => t.status !== 'pending');
        container.innerHTML = tasks.length
            ? tasks.map(t => this._createTaskCard(t)).join('')
            : '<div class="empty-state"><p>Нет прошлых задач</p></div>';
        this._bindCardEvents();
    }

    _bindTeacherCardEvents() {
        document.querySelectorAll('.task-card__header').forEach(el => {
            el.onclick = () => {
                const id = parseInt(el.parentElement.dataset.id);
                this.toggleCard(id);
            };
        });
    }

    _filterTasks(status) {
        let tasks = this.tasks.filter(t => t.status === status);

        if (this.currentFilter !== 'all') {
            tasks = tasks.filter(t => t.deadline?.startsWith(this.currentFilter));
        }

        return tasks;
    }

    _groupByDate(tasks) {
        const grouped = {};
        tasks.forEach(t => {
            // Группируем по дате ДЕДЛАЙНА
            const day = t.deadline?.split('T')[0] || 'unknown';
            if (!grouped[day]) grouped[day] = [];
            grouped[day].push(t);
        });
        return grouped;
    }

    _renderGroupedTasks(grouped) {
        const today = new Date().toISOString().split('T')[0];
        const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

        const sortedDays = Object.keys(grouped).sort((a, b) => {
            if (a === today) return -1;
            if (b === today) return 1;
            if (a === tomorrow) return -1;
            if (b === tomorrow) return 1;
            return a.localeCompare(b);
        });

        let html = '';

        sortedDays.forEach(day => {
            const tasks = grouped[day];
            const isOpen = this.openDayGroups.has(day);

            let colorClass = 'day-group--other';
            let label = getDayLabel(day);

            if (day === today) {
                colorClass = 'day-group--today';
                label = 'Сегодня';
            } else if (day === tomorrow) {
                colorClass = 'day-group--tomorrow';
                label = 'Завтра';
            } else if (day === yesterday) {
                colorClass = 'day-group--yesterday';
                label = 'Вчера';
            }

            html += `
            <div class="day-group ${colorClass}">
                <div class="day-group__header day-group__header--clickable" data-day="${day}">
                    <span class="day-group__label">${label}</span>
                    <span class="day-group__count">${tasks.length} ${pluralizeTasks(tasks.length)}</span>
                </div>
                <div class="day-group__content" style="${isOpen ? '' : 'display: none;'}">
                    ${tasks.map(t => this._createTaskCard(t)).join('')}
                </div>
            </div>
        `;
        });

        return html;
    }

    _createTaskCard(task) {
        const isChecked = task.status !== CONFIG.TASK_STATUS.PENDING;
        const isOpen = this.openCards.has(task.id);

        return `
            <div class="task-card ${isOpen ? 'task-card--open' : ''}" data-id="${task.id}">
                <div class="task-card__header">
                    <div class="checkbox-circle ${isChecked ? 'checkbox-circle--checked' : ''}" data-action="toggle" data-id="${task.id}"></div>
                    <span class="badge badge--success">${task.subject}</span>
                    <div class="task-card__info">
                        <div class="task-card__title">${task.title}</div>
                        <div class="task-card__deadline">⏰ ${formatDate(task.deadline)}</div>
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

    async toggleTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task || task.status !== CONFIG.TASK_STATUS.PENDING) return;

        try {
            await api.patch(`/assignments/${taskId}/status`, { status: CONFIG.TASK_STATUS.SUBMITTED });
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
    /**
 * Загружает классы учителя для выбора
 */
    async loadTeacherClasses() {
        try {
            const classes = await api.get('/assignments/teacher-classes');

            const container = document.getElementById('classCheckboxes');

            if (classes.length === 0) {
                container.innerHTML = '<p style="color: var(--color-text-muted);">Нет классов. Создайте класс во вкладке "Классы".</p>';
                return;
            }

            container.innerHTML = classes.map(cls => `
            <label style="display: flex; align-items: center; gap: 10px; padding: 8px; cursor: pointer; border-radius: 8px; transition: var(--transition-fast);">
                <input type="checkbox" value="${cls.id}" style="width: 18px; height: 18px; accent-color: var(--color-primary);">
                <div>
                    <div style="font-weight: var(--font-semibold); font-size: var(--font-size-sm);">${cls.name}</div>
                    <div style="font-size: var(--font-size-xs); color: var(--color-text-muted);">${cls.subject} · ${cls.grade} класс · ${cls.student_count} учеников</div>
                </div>
            </label>
        `).join('');
        } catch (error) {
            console.error('Load classes error:', error);
            document.getElementById('classCheckboxes').innerHTML = '<p style="color: var(--color-danger);">Ошибка загрузки классов</p>';
        }
    }

    _bindCardEvents() {
        // Чекбоксы
        document.querySelectorAll('.checkbox-circle[data-action="toggle"]').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                this.toggleTask(parseInt(el.dataset.id));
            };
        });

        // Карточки задач — останавливаем всплытие
        document.querySelectorAll('.task-card__header').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                const taskId = parseInt(el.parentElement.dataset.id);
                this.toggleCard(taskId);
            };
        });
    }

    bindEvents() {
        document.getElementById('dateScroll').addEventListener('click', (e) => {
            const chip = e.target.closest('.chip');
            if (!chip) return;

            document.querySelectorAll('.chip').forEach(c => c.classList.remove('chip--active'));
            chip.classList.add('chip--active');
            this.currentFilter = chip.dataset.date;
            this.renderActiveTasks();
        });

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
        // Кнопка создания — загружаем классы
        document.getElementById('addTaskBtn')?.addEventListener('click', async () => {
            if (this.user.role === 'teacher') {
                await this.loadTeacherClasses();
            }
            document.getElementById('taskModal').style.display = 'flex';
        });

        // Форма создания задачи
        document.getElementById('taskForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();

            const selectedClasses = [];
            document.querySelectorAll('#classCheckboxes input:checked').forEach(cb => {
                selectedClasses.push(parseInt(cb.value));
            });

            const data = {
                title: document.getElementById('taskTitle').value,
                description: document.getElementById('taskDesc').value,
                subject: document.getElementById('taskSubject').value,
                deadline: document.getElementById('taskDeadline').value,
                classIds: selectedClasses
            };

            try {
                // Отправляем задание классам
                await api.post('/assignments/for-class', data);
                showToast('✅ Задача создана и отправлена!');
                closeTaskModal();
                await this.loadTasks();
            } catch (error) {
                showToast('❌ Ошибка: ' + error.message, 'error');
            }
        });
    }
}

function closeTaskModal() {
    document.getElementById('taskModal').style.display = 'none';
    document.getElementById('taskForm')?.reset();
}

document.addEventListener('DOMContentLoaded', () => {
    const dashboard = new DashboardController();
    dashboard.init();
});