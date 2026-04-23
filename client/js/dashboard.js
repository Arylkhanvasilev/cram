// dashboard.js

class Dashboard {
    constructor() {
        this.user = JSON.parse(localStorage.getItem('user') || '{}');
        this.tasks = [];
        this.progress = [];
        this.notifications = [];
        this.students = [];
        this.currentFilter = 'all';
        this.init();
    }

    async openTaskModal() {
        // Загружаем список учеников
        await this.loadStudents();
        document.getElementById('taskModal').style.display = 'flex';
    }

    async loadStudents() {
        try {
            // Загружаем учеников учителя
            this.students = await api.get('/assignments/my-students');
            console.log('Загружено учеников:', this.students.length);
            this.renderStudentsList();
        } catch (error) {
            console.error('Ошибка загрузки учеников:', error);
            // Если нет учеников в классах, загружаем всех
            try {
                this.students = await api.get('/assignments/students');
                this.renderStudentsList();
            } catch (e) {
                showNotification('Ошибка загрузки списка учеников', 'error');
            }
        }
    }

    renderStudentsList() {
        const container = document.getElementById('studentsList');

        if (this.students.length === 0) {
            container.innerHTML = '<div class="empty-state">Нет доступных учеников</div>';
            return;
        }

        // Группируем по классам
        const grouped = {};
        this.students.forEach(student => {
            const grade = student.grade || 'Без класса';
            if (!grouped[grade]) grouped[grade] = [];
            grouped[grade].push(student);
        });

        let html = '';
        for (const [grade, students] of Object.entries(grouped)) {
            html += `
            <div class="student-group">
                <div class="student-group-header">
                    <input type="checkbox" onchange="dashboard.toggleGroup('${grade}', this.checked)">
                    <span>${grade} класс (${students.length} учеников)</span>
                </div>
                <div class="student-group-items">
        `;

            students.forEach(student => {
                html += `
                <label class="student-checkbox-item">
                    <input type="checkbox" name="studentIds" value="${student.id}" 
                           data-grade="${grade}" onchange="dashboard.updateSelectedCount()">
                    <div class="student-info">
                        <span class="student-name">${student.name}</span>
                        <span class="student-details">
                            <span>📧 ${student.email}</span>
                            ${student.class_name ? `<span class="student-class">${student.class_name}</span>` : ''}
                        </span>
                    </div>
                </label>
            `;
            });

            html += `
                </div>
            </div>
        `;
        }

        container.innerHTML = html;
        this.updateSelectedCount();
    }

    toggleGroup(grade, checked) {
        document.querySelectorAll(`input[data-grade="${grade}"]`).forEach(cb => {
            cb.checked = checked;
        });
        this.updateSelectedCount();
    }

    selectAllStudents() {
        document.querySelectorAll('input[name="studentIds"]').forEach(cb => {
            cb.checked = true;
        });
        // Обновляем групповые чекбоксы
        document.querySelectorAll('.student-group-header input[type="checkbox"]').forEach(cb => {
            cb.checked = true;
        });
        this.updateSelectedCount();
    }

    deselectAllStudents() {
        document.querySelectorAll('input[name="studentIds"]').forEach(cb => {
            cb.checked = false;
        });
        document.querySelectorAll('.student-group-header input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
        });
        this.updateSelectedCount();
    }

    updateSelectedCount() {
        const selected = document.querySelectorAll('input[name="studentIds"]:checked');
        document.getElementById('selectedCount').textContent = selected.length;
    }

    async createAssignment(formData) {
        const title = document.getElementById('taskTitle').value.trim();
        const description = document.getElementById('taskDescription').value.trim();
        const subject = document.getElementById('taskSubject').value.trim();
        const deadline = document.getElementById('taskDeadline').value;

        // Получаем выбранных учеников
        const selectedCheckboxes = document.querySelectorAll('input[name="studentIds"]:checked');
        const studentIds = Array.from(selectedCheckboxes).map(cb => parseInt(cb.value));

        // Валидация
        if (!title || !subject || !deadline) {
            this.showFormError('Заполните все обязательные поля');
            return;
        }

        if (studentIds.length === 0) {
            this.showFormError('Выберите хотя бы одного ученика');
            return;
        }

        try {
            const result = await api.post('/assignments', {
                title,
                description,
                subject,
                deadline,
                studentIds
            });

            showNotification(`✅ Задание создано и назначено ${studentIds.length} ученикам`, 'success');
            this.closeTaskModal();
            await this.loadData(); // Обновляем список заданий
        } catch (error) {
            this.showFormError(error.message || 'Ошибка создания задания');
        }
    }

    showFormError(message) {
        const errorDiv = document.getElementById('taskFormError');
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        setTimeout(() => errorDiv.style.display = 'none', 5000);
    }

    closeTaskModal() {
        document.getElementById('taskModal').style.display = 'none';
        document.getElementById('taskForm').reset();
        document.getElementById('taskFormError').style.display = 'none';
    }

    async init() {
        if (window.loadTheme) {
            window.loadTheme();
        }
        if (!checkAuth()) return;

        this.setupUI();
        await this.loadData();
        this.setupEventListeners();
        this.startPeriodicUpdates();
    }

    setupUI() {
        // Устанавливаем имя пользователя
        document.getElementById('userName').textContent = this.user.name;

        // Приветствие
        const greeting = document.getElementById('greeting');
        const hour = new Date().getHours();
        const greetingText = hour < 6 ? 'Доброй ночи' :
            hour < 12 ? 'Доброе утро' :
                hour < 18 ? 'Добрый день' : 'Добрый вечер';
        greeting.textContent = `${greetingText}, ${this.user.name}!`;

        // Текущая дата
        const dateElement = document.getElementById('currentDate');
        const options = { weekday: 'long', day: 'numeric', month: 'long' };
        dateElement.textContent = new Date().toLocaleDateString('ru-RU', options);

        // Показываем кнопку создания задания для учителя
        if (this.user.role === 'teacher') {
            document.getElementById('createTaskBtn').style.display = 'block';
        }

        // Логаут
        document.getElementById('logoutBtn').addEventListener('click', () => logout());
    }

    async loadData() {
        try {
            // Параллельная загрузка данных
            const [tasks, progress, notifications] = await Promise.all([
                api.get('/assignments'),
                api.get('/assignments/progress'),
                api.get('/assignments/notifications')
            ]);

            this.tasks = tasks;
            this.progress = progress;
            this.notifications = notifications;

            this.renderAll();
            this.loadAIInsights();
            this.showUnreadNotifications();
        } catch (error) {
            console.error('Failed to load data:', error);
            showNotification('Ошибка загрузки данных', 'error');
        }
    }

    renderAll() {
        this.renderQuickStats();
        this.renderOverallProgress();
        this.renderSubjectsProgress();
        this.renderTasksStats();
        this.renderTasks();
    }

    renderQuickStats() {
        const container = document.getElementById('quickStats');
        const stats = this.calculateStats();

        container.innerHTML = `
            <div class="quick-stat">
                <div class="value">${stats.pending}</div>
                <div class="label">Ожидают</div>
            </div>
            <div class="quick-stat">
                <div class="value">${stats.completed}</div>
                <div class="label">Выполнено</div>
            </div>
            <div class="quick-stat">
                <div class="value">${Math.round(stats.overallProgress)}%</div>
                <div class="label">Прогресс</div>
            </div>
        `;
    }

    renderOverallProgress() {
        const stats = this.calculateStats();
        document.getElementById('overallProgressValue').textContent = `${Math.round(stats.overallProgress)}%`;
        document.getElementById('overallProgressBar').style.width = `${stats.overallProgress}%`;
    }

    renderSubjectsProgress() {
        const container = document.getElementById('subjectsProgress');

        if (this.progress.length === 0) {
            container.innerHTML = '<div class="empty-state">Нет данных о прогрессе</div>';
            return;
        }

        // Группируем по предметам
        const subjectIcons = {
            'Алгебра': '📐',
            'Геометрия': '📏',
            'Литература': '📚',
            'История': '🏛️',
            'Химия': '🧪',
            'Физика': '⚡',
            'Биология': '🌿',
            'Общий': '📊'
        };

        container.innerHTML = this.progress.map(p => {
            const percentage = p.percentage || 0;
            const subject = p.subject || 'Общий';
            const icon = subjectIcons[subject] || '📖';

            return `
                <div class="subject-progress-card">
                    <div class="subject-name">
                        <span class="subject-icon">${icon}</span>
                        ${subject}
                    </div>
                    <div class="progress-bar-container">
                        <div class="progress-bar-fill" style="width: ${percentage}%">${percentage}%</div>
                    </div>
                    <div class="subject-stats">
                        <span>${p.completed_tasks || 0}/${p.total_tasks || 0} заданий</span>
                        ${p.average_grade ? `<span>⭐ ${p.average_grade}</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    renderTasksStats() {
        const stats = this.calculateStats();
        const container = document.getElementById('tasksStats');

        container.innerHTML = `
            <div class="task-stat-card ${this.currentFilter === 'all' ? 'active' : ''}" data-filter="all">
                <div class="task-stat-value">${stats.total}</div>
                <div class="task-stat-label">Всего</div>
            </div>
            <div class="task-stat-card pending ${this.currentFilter === 'pending' ? 'active' : ''}" data-filter="pending">
                <div class="task-stat-value">${stats.pending}</div>
                <div class="task-stat-label">Ожидают</div>
            </div>
            <div class="task-stat-card submitted ${this.currentFilter === 'submitted' ? 'active' : ''}" data-filter="submitted">
                <div class="task-stat-value">${stats.submitted}</div>
                <div class="task-stat-label">Сданы</div>
            </div>
            <div class="task-stat-card overdue ${this.currentFilter === 'overdue' ? 'active' : ''}" data-filter="overdue">
                <div class="task-stat-value">${stats.overdue}</div>
                <div class="task-stat-label">Просрочены</div>
            </div>
        `;

        // Добавляем обработчики клика
        container.querySelectorAll('.task-stat-card').forEach(card => {
            card.addEventListener('click', () => {
                const filter = card.dataset.filter;
                this.currentFilter = filter;
                document.getElementById('taskFilter').value = filter;
                this.renderTasksStats();
                this.renderTasks();
            });
        });
    }

    renderTasks() {
        const container = document.getElementById('tasksContainer');
        let filteredTasks = this.tasks;

        // Применяем фильтр
        if (this.currentFilter !== 'all') {
            filteredTasks = this.tasks.filter(t => {
                if (this.currentFilter === 'overdue') {
                    return t.status === 'pending' && new Date(t.deadline) < new Date();
                }
                return t.status === this.currentFilter;
            });
        }

        if (filteredTasks.length === 0) {
            container.innerHTML = `<div class="empty-state"><p>🎉 Нет заданий в этой категории</p></div>`;
            return;
        }

        // Очищаем контейнер
        container.innerHTML = '';

        // Создаём карточки через createElement для лучшего контроля
        filteredTasks.forEach(task => {
            const card = this.createTaskElement(task);
            container.appendChild(card);
        });
    }

    // НОВЫЙ МЕТОД - создание элемента через DOM
    createTaskElement(task) {
        const card = document.createElement('div');
        card.className = `task-card ${task.status}`;

        const taskId = task.id || task.group_assignment_id;
        console.log('Creating element for task:', taskId, task.title);

        // Сохраняем ID в data-атрибуте
        card.dataset.taskId = taskId;

        const isOverdue = task.status === 'pending' && new Date(task.deadline) < new Date();
        if (isOverdue) card.classList.add('overdue');

        const statusText = {
            'pending': '⏳ Ожидает',
            'submitted': '✅ Сдано',
            'graded': `⭐ ${task.grade || 'Оценено'}`,
            'overdue': '⚠️ Просрочено'
        }[isOverdue ? 'overdue' : task.status] || task.status;

        card.innerHTML = `
        <div class="task-header">
            <span class="task-title">${task.title}</span>
            <span class="task-subject">${task.subject}</span>
        </div>
        ${task.description ? `<div class="task-description">${task.description}</div>` : ''}
        <div class="task-meta">
            <div class="task-deadline ${isOverdue ? 'urgent' : ''}">
                ⏰ ${formatDate(task.deadline)}
            </div>
            <div class="task-actions">
                <span class="status-badge ${isOverdue ? 'overdue' : task.status}">${statusText}</span>
            </div>
        </div>
    `;

        // Добавляем кнопку если нужно
        if (this.user.role === 'student' && task.status === 'pending') {
            const actionsDiv = card.querySelector('.task-actions');
            const button = document.createElement('button');
            button.className = 'btn btn-small btn-success';
            button.textContent = '✓ Отметить';
            button.onclick = (e) => {
                e.stopPropagation();
                console.log('Button clicked for taskId:', taskId);
                this.markAsDone(taskId);
            };
            actionsDiv.appendChild(button);
        }

        // Клик по карточке
        card.addEventListener('click', () => this.showTaskDetail(task.id || task.group_assignment_id));

        return card;
    }
    createTaskCard(task) {
        console.log('Creating card for task:', task.id, task.group_assignment_id, task.title);
        const isOverdue = task.status === 'pending' && new Date(task.deadline) < new Date();
        const statusClass = isOverdue ? 'overdue' : task.status;
        const statusText = {
            'pending': '⏳ Ожидает',
            'submitted': '✅ Сдано',
            'graded': `⭐ ${task.grade || 'Оценено'}`,
            'overdue': '⚠️ Просрочено'
        }[isOverdue ? 'overdue' : task.status] || task.status;

        return `
            <div class="task-card ${statusClass}" onclick="dashboard.showTaskDetail(${task.id})">
                <div class="task-header">
                    <span class="task-title">${task.title}</span>
                    <span class="task-subject">${task.subject}</span>
                </div>
                ${task.description ? `<div class="task-description">${task.description}</div>` : ''}
                <div class="task-meta">
                    <div class="task-deadline ${isOverdue ? 'urgent' : ''}">
                        ⏰ ${formatDate(task.deadline)}
                    </div>
                    <div class="task-actions" onclick="event.stopPropagation()">
                        <span class="status-badge ${statusClass}">${statusText}</span>
                        ${this.getTaskActions(task)}
                    </div>
                </div>
            </div>
        `;
    }

    getTaskActions(task) {
        if (this.user.role === 'student' && task.status === 'pending') {
            const buttonId = task.group_assignment_id || task.id;
            console.log('Creating button with taskId:', buttonId);

            return `
            <button class="btn btn-small btn-success mark-done-btn" data-task-id="(${buttonId})">
                ✓ Отметить
            </button>
        `;
        }

        if (this.user.role === 'teacher' && task.status === 'submitted') {
            return `
            <button class="btn btn-small btn-primary grade-btn" data-task-id="(${task.id})">
                Проверить
            </button>
        `;
        }

        return '';
    }


    calculateStats() {
        const now = new Date();

        const pending = this.tasks.filter(t =>
            t.status === 'pending' && new Date(t.deadline) >= now
        ).length;

        const overdue = this.tasks.filter(t =>
            t.status === 'pending' && new Date(t.deadline) < now
        ).length;

        const submitted = this.tasks.filter(t =>
            t.status === 'submitted' || t.status === 'graded'
        ).length;

        const total = this.tasks.length;
        const overallProgress = total > 0 ? (submitted / total) * 100 : 0;

        return {
            total,
            pending,
            overdue,
            submitted,
            completed: submitted,
            overallProgress
        };
    }

    async markAsDone(taskId) {
        console.log('=== MARK AS DONE ===');
        console.log('TaskId:', taskId);

        if (!taskId) {
            console.error('TaskId is undefined or null');
            showNotification('Ошибка: ID задания не найден', 'error');
            return;
        }

        try {
            // Пробуем оба эндпоинта
            let success = false;

            // Сначала пробуем как обычное задание
            try {
                console.log('Trying individual assignment endpoint...');
                await api.patch(`/assignments/${taskId}/status`, { status: 'submitted' });
                success = true;
                console.log('Success with individual assignment');
            } catch (e) {
                console.log('Not an individual assignment, trying group...');
            }

            // Если не получилось, пробуем как групповое
            if (!success) {
                try {
                    console.log('Trying group assignment endpoint...');
                    await api.patch(`/classes/assignments/${taskId}/submit`, {});
                    success = true;
                    console.log('Success with group assignment');
                } catch (e) {
                    console.log('Not a group assignment either');
                }
            }

            if (success) {
                showNotification('✅ Задание отмечено как выполненное', 'success');
                await this.loadData();
            } else {
                showNotification('❌ Не удалось отметить задание', 'error');
            }
        } catch (error) {
            console.error('Error:', error);
            showNotification('❌ Ошибка: ' + error.message, 'error');
        }
    }

    async loadAIInsights() {
        try {
            const insights = await api.post('/ai/insights', {
                tasks: this.tasks,
                progress: this.progress
            });

            document.getElementById('aiMessage').textContent = insights.motivation || 'Продолжай в том же духе!';

            if (insights.suggestions) {
                document.getElementById('aiSuggestions').innerHTML = `
                    <h4>💡 Рекомендации:</h4>
                    <ul>${insights.suggestions.map(s => `<li>${s}</li>`).join('')}</ul>
                `;
            }
        } catch (error) {
            console.error('AI insights error:', error);
        }
    }

    async refreshProgress() {
        try {
            this.progress = await api.get('/assignments/progress');
            this.renderOverallProgress();
            this.renderSubjectsProgress();
            showNotification('Прогресс обновлён', 'success');
        } catch (error) {
            showNotification('Ошибка обновления', 'error');
        }
    }

    showTaskDetail(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;

        document.getElementById('detailTaskTitle').textContent = task.title;
        document.getElementById('taskDetailContent').innerHTML = `
            <div class="task-detail">
                <p><strong>Предмет:</strong> ${task.subject}</p>
                <p><strong>Описание:</strong> ${task.description || 'Нет описания'}</p>
                <p><strong>Дедлайн:</strong> ${formatDate(task.deadline)}</p>
                <p><strong>Статус:</strong> ${task.status}</p>
                ${task.grade ? `<p><strong>Оценка:</strong> ${task.grade}</p>` : ''}
                ${task.feedback ? `<p><strong>Комментарий:</strong> ${task.feedback}</p>` : ''}
            </div>
        `;

        document.getElementById('taskDetailModal').style.display = 'flex';
    }

    closeTaskModal() {
        document.getElementById('taskModal').style.display = 'none';
        document.getElementById('taskForm').reset();
    }

    setupEventListeners() {
        document.addEventListener('click', (e) => {
            // Кнопка "Отметить"
            if (e.target.classList.contains('mark-done-btn')) {
                const taskId = e.target.dataset.taskId;
                console.log('Mark done button clicked, taskId from dataset:', taskId);

                if (taskId && taskId !== 'undefined') {
                    this.markAsDone(parseInt(taskId));
                } else {
                    console.error('Invalid taskId:', taskId);
                    showNotification('Ошибка: неверный ID задания', 'error');
                }
            }

            // Кнопка "Проверить" (для учителя)
            if (e.target.classList.contains('grade-btn')) {
                const taskId = e.target.dataset.taskId;
                console.log('Grade button clicked, taskId:', taskId);
                if (taskId) {
                    this.showGradeModal(parseInt(taskId));
                }
            }
        });
        // Фильтр заданий
        document.getElementById('taskFilter').addEventListener('change', (e) => {
            this.currentFilter = e.target.value;
            this.renderTasksStats();
            this.renderTasks();
        });

        // Обновление AI
        document.getElementById('refreshAI').addEventListener('click', () => this.loadAIInsights());

        // Закрытие модалок
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.target.closest('.modal').style.display = 'none';
            });
        });

        // Клик вне модалки
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.style.display = 'none';
            }
        });
        const createBtn = document.getElementById('createTaskBtn');
        if (createBtn) {
            createBtn.addEventListener('click', () => this.openTaskModal());
        }

        // Форма создания задания
        const taskForm = document.getElementById('taskForm');
        if (taskForm) {
            taskForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.createAssignment();
            });
        }
    }

    startPeriodicUpdates() {
        // Обновляем данные каждые 30 секунд
        setInterval(() => {
            this.loadData().catch(console.error);
        }, 30000);

        // Проверяем новые уведомления каждые 10 секунд
        setInterval(async () => {
            try {
                const notifications = await api.get('/assignments/notifications');

                // Находим только НОВЫЕ непрочитанные уведомления
                const existingIds = this.notifications.map(n => n.id);
                const newUnreadNotifications = notifications.filter(n =>
                    !n.is_read && !existingIds.includes(n.id)
                );

                // Показываем только новые
                newUnreadNotifications.forEach(notification => {
                    showNotification(notification.message, notification.type || 'info');

                    // Отмечаем как прочитанное
                    api.patch(`/assignments/notifications/${notification.id}/read`, {})
                        .catch(console.error);
                });

                // Обновляем список уведомлений
                if (newUnreadNotifications.length > 0) {
                    this.notifications = notifications;
                }
            } catch (error) {
                console.error('Failed to check notifications:', error);
            }
        }, 10000);
    }

    showUnreadNotifications() {
        // Фильтруем только непрочитанные уведомления
        const unreadNotifications = this.notifications.filter(n => !n.is_read);

        console.log(`Total notifications: ${this.notifications.length}, Unread: ${unreadNotifications.length}`);

        // Показываем только непрочитанные
        unreadNotifications.forEach(notification => {
            showNotification(notification.message, notification.type || 'info');

            // Отмечаем как прочитанное на сервере
            api.patch(`/assignments/notifications/${notification.id}/read`, {})
                .then(() => {
                    console.log(`Notification ${notification.id} marked as read`);
                    // Обновляем локальное состояние
                    notification.is_read = true;
                })
                .catch(error => {
                    console.error('Failed to mark notification as read:', error);
                });
        });
    }
}

let dashboard;
document.addEventListener('DOMContentLoaded', () => {
    dashboard = new Dashboard();
});