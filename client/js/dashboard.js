// Цвета для активных задач
const DAY_COLORS = ['#A4FF55', '#FEBD59', '#FE5959', '#59AEFE'];
const DAY_COLOR_CLASSES = ['day-group--color-0', 'day-group--color-1', 'day-group--color-2', 'day-group--color-3'];

// Цвета для прошлых задач
const PAST_DAY_COLORS = ['#C5B9F7', '#F7B9E5', '#B9F7E5'];
const PAST_DAY_COLOR_CLASSES = ['day-group--past-0', 'day-group--past-1', 'day-group--past-2'];
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
        this.destroyed = false;
        window.dash = this;
    }

    destroy() {
        this.destroyed = true;
        window.dash = null;
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

        // Проверяем существование элементов перед обновлением
        const userNameEl = document.getElementById('userName');
        if (userNameEl) {
            userNameEl.textContent = firstName;
        }

        const avatarTextEl = document.getElementById('avatarText');
        if (avatarTextEl) {
            avatarTextEl.textContent = firstName.charAt(0).toUpperCase();
        }

        // Аватар в навбаре
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
            console.log('Все задачи:', this.tasks.length);
            console.log('Pending:', this.tasks.filter(t => t.status === 'pending').length);
            console.log('Выполненные:', this.tasks.filter(t => t.status !== 'pending').length);
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
            const tasks = grouped[day];
            const isOpen = this.openDayGroups.has(day);
            const colorIndex = index % DAY_COLORS.length;
            const colorClass = DAY_COLOR_CLASSES[colorIndex];

            let label = getDayLabel(day);
            if (day === today) label = 'Сегодня';
            else if (day === tomorrow) label = 'Завтра';
            else if (day === new Date(Date.now() - 86400000).toISOString().split('T')[0]) label = 'Вчера';

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

            if (!pastTasks.length) {
                container.innerHTML = '<div class="empty-state"><p>Нет завершённых заданий</p></div>';
                return;
            }

            const grouped = this._groupByDate(pastTasks);
            const sortedDays = Object.keys(grouped).sort().reverse();

            let html = '';
            sortedDays.forEach((day, index) => {
                const tasks = grouped[day];
                const isOpen = this.openDayGroups.has('past_' + day);
                const colorIndex = index % DAY_COLORS.length;
                const colorClass = DAY_COLOR_CLASSES[colorIndex];

                let label = getDayLabel(day);

                html += `
                <div class="day-group ${colorClass}">
                    <div class="day-group__header day-group__header--clickable" data-day="past_${day}">
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
            return;
        }

        // Для ученика
        const tasks = this.tasks.filter(t => t.status !== 'pending');

        console.log('Past tasks:', tasks.length, tasks.map(t => ({ id: t.id, title: t.title, status: t.status })));

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
            const colorIndex = index % DAY_COLORS.length;
            const colorClass = DAY_COLOR_CLASSES[colorIndex];

            let label = getDayLabel(day);

            html += `
            <div class="day-group ${colorClass}">
                <div class="day-group__header day-group__header--clickable" data-day="past_${day}">
                    <span class="day-group__label">${label}</span>
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

        const sortedDays = Object.keys(grouped).sort((a, b) => {
            if (a === today) return -1;
            if (b === today) return 1;
            if (a === tomorrow) return -1;
            if (b === tomorrow) return 1;
            return a.localeCompare(b);
        });

        let html = '';

        sortedDays.forEach((day, index) => {
            const tasks = grouped[day];
            const isOpen = this.openDayGroups.has(day);
            const colorIndex = index % DAY_COLORS.length;
            const colorClass = DAY_COLOR_CLASSES[colorIndex];

            let label = getDayLabel(day);
            if (day === today) label = 'Сегодня';
            else if (day === tomorrow) label = 'Завтра';
            else if (day === new Date(Date.now() - 86400000).toISOString().split('T')[0]) label = 'Вчера';

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

/**
 * Генерация расписания через AI
 */
async function generateSchedule() {
    const btn = document.getElementById('btnSchedule');
    const block = document.getElementById('aiScheduleBlock');
    const content = document.getElementById('aiScheduleContent');

    // Показываем загрузку
    btn.disabled = true;
    btn.textContent = '⏳ Составляю расписание...';
    block.style.display = 'block';
    content.innerHTML = `
        <div class="schedule-loading">
            <div class="spinner"></div>
            <p style="margin-top: 12px; font-weight: 600;">🤖 AI анализирует твои задачи...</p>
            <p style="font-size: 13px; color: var(--color-text-muted);">Это займёт 10-15 секунд</p>
        </div>
    `;

    try {
        // Получаем активные задачи
        const tasks = window.currentDashboard?.tasks || await api.get('/assignments');
        const pendingTasks = tasks.filter(t => t.status === 'pending');

        if (!pendingTasks.length) {
            content.innerHTML = `
                <div class="ai-schedule-content">
                    <h3>📅 Расписание на сегодня</h3>
                    <p style="color: var(--color-text-muted);">Нет активных задач! Ты всё сделал 🎉</p>
                </div>
            `;
            return;
        }

        // Отправляем запрос к AI
        const response = await api.post('/ai/chat', {
            message: `Составь расписание на сегодня для выполнения этих задач. 
            
Задачи:
${pendingTasks.map(t => `- ${t.subject}: "${t.title}" (дедлайн: ${t.deadline || 'не указан'})`).join('\n')}

Формат ответа (строго):
РАСПИСАНИЕ:
15:00-15:30 — Математика: Квадратные уравнения
15:35-16:05 — Литература: Анализ стихотворения
...

СОВЕТ: (один короткий совет)

МОТИВАЦИЯ: (одна фраза)

Пиши кратко, только по делу.`
        });

        // Парсим ответ
        const reply = response.reply || '';
        const lines = reply.split('\n').filter(l => l.trim());

        let scheduleItems = [];
        let tip = '';
        let motivation = '';
        let inSchedule = false;
        let inTip = false;
        let inMotivation = false;

        lines.forEach(line => {
            if (line.includes('СОВЕТ:') || line.includes('Совет:')) {
                inTip = true;
                inSchedule = false;
                inMotivation = false;
                tip = line.replace(/СОВЕТ:|Совет:/, '').trim();
            } else if (line.includes('МОТИВАЦИЯ:') || line.includes('Мотивация:')) {
                inMotivation = true;
                inSchedule = false;
                inTip = false;
                motivation = line.replace(/МОТИВАЦИЯ:|Мотивация:/, '').trim();
            } else if (line.includes('РАСПИСАНИЕ:') || line.includes('Расписание:')) {
                inSchedule = true;
                inTip = false;
                inMotivation = false;
            } else if (inSchedule && line.includes('—') || inSchedule && line.includes('-')) {
                const parts = line.split(/[—-]/);
                if (parts.length >= 2) {
                    scheduleItems.push({
                        time: parts[0].trim(),
                        task: parts[1].trim()
                    });
                }
            }
        });

        // Если не распарсилось — показываем как есть
        if (!scheduleItems.length) {
            scheduleItems = [{ time: 'Сегодня', task: reply }];
        }

        // Рендерим
        content.innerHTML = `
            <div class="ai-schedule-content">
                <h3>📅 Расписание на сегодня</h3>
                ${scheduleItems.map(item => `
                    <div class="schedule-item">
                        <span class="schedule-time">${item.time}</span>
                        <div class="schedule-info">
                            <div class="schedule-task">${item.task}</div>
                        </div>
                    </div>
                `).join('')}
                ${tip ? `<div class="schedule-break" style="margin-top: 12px;">💡 ${tip}</div>` : ''}
                ${motivation ? `<div class="schedule-motivation">💪 ${motivation}</div>` : ''}
            </div>
        `;

    } catch (e) {
        content.innerHTML = `
            <div class="ai-schedule-content">
                <h3>📅 Расписание на сегодня</h3>
                <p style="color: var(--color-text-muted);">Не удалось составить расписание 😔</p>
                <p style="font-size: 13px; color: var(--color-text-muted);">Попробуй позже</p>
            </div>
        `;
    } finally {
        btn.disabled = false;
        btn.textContent = '🤖 Расписание на сегодня';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const dashboard = new DashboardController();
    dashboard.init();
});