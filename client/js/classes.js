// classes.js - Управление классами

class ClassesManager {
    constructor() {
        this.user = JSON.parse(localStorage.getItem('user') || '{}');
        this.classes = [];
        this.currentClass = null;
        this.init();
    }

    async init() {
        if (!this.notifications) return;

        const unread = this.notifications.filter(n => !n.is_read);
        unread.forEach(notification => {
            showNotification(notification.message, notification.type || 'info');

            // Отмечаем как прочитанное
            api.patch(`/assignments/notifications/${notification.id}/read`, {})
                .catch(console.error);
        });
        
        if (!checkAuth()) return;

        this.setupUI();
        await this.loadClasses();

        if (this.user.role === 'student') {
            await this.loadInvitations();
        }

        this.setupEventListeners();
    }

    setupUI() {
        document.getElementById('userName').textContent = this.user.name;

        // Показываем элементы в зависимости от роли
        if (this.user.role === 'teacher') {
            document.querySelectorAll('.teacher-only').forEach(el => el.style.display = 'block');
            document.getElementById('createClassBtn').style.display = 'block';
            document.getElementById('pageTitle').textContent = 'Мои классы (учитель)';
        } else if (this.user.role === 'student') {
            document.querySelectorAll('.student-only').forEach(el => el.style.display = 'block');
            document.getElementById('pageTitle').textContent = 'Мои классы';
        }

        // Логаут
        document.getElementById('logoutBtn').addEventListener('click', () => logout());
    }

    async loadClasses() {
        try {
            const endpoint = this.user.role === 'teacher'
                ? '/classes'
                : '/classes/student';

            this.classes = await api.get(endpoint);
            this.renderClasses();
        } catch (error) {
            console.error('Failed to load classes:', error);
            showNotification('Ошибка загрузки классов', 'error');
        }
    }

    async loadInvitations() {
        try {
            const invitations = await api.get('/classes/invitations/incoming');

            const section = document.getElementById('invitationsSection');
            const container = document.getElementById('invitationsList');

            if (invitations.length === 0) {
                section.style.display = 'none';
                return;
            }

            section.style.display = 'block';

            container.innerHTML = invitations.map(inv => `
                <div class="invitation-card">
                    <div class="invitation-info">
                        <span class="invitation-class">${inv.class_name} (${inv.subject})</span>
                        <span class="invitation-teacher">Приглашает: ${inv.teacher_name}</span>
                    </div>
                    <div class="invitation-actions">
                        <button class="btn btn-success" onclick="classesManager.handleInvitation(${inv.id}, 'accepted')">
                            Принять
                        </button>
                        <button class="btn btn-outline" onclick="classesManager.handleInvitation(${inv.id}, 'rejected')">
                            Отклонить
                        </button>
                    </div>
                </div>
            `).join('');
        } catch (error) {
            console.error('Failed to load invitations:', error);
        }
    }

    renderClasses() {
        const container = document.getElementById('classesContainer');

        if (this.classes.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>У вас пока нет классов</p>
                    ${this.user.role === 'teacher' ? '<p>Нажмите "Создать класс" чтобы начать</p>' : ''}
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="classes-grid">
                ${this.classes.map(c => this.createClassCard(c)).join('')}
            </div>
        `;
    }

    createClassCard(cls) {
        const studentCount = cls.student_count || 0;
        const assignmentCount = cls.assignment_count || 0;

        return `
            <div class="class-card" onclick="classesManager.openClassDetail(${cls.id})">
                <div class="class-header">
                    <div class="class-icon">${cls.name.charAt(0).toUpperCase()}</div>
                    <div class="class-info">
                        <h3>${cls.name}</h3>
                        <span class="class-subject">${cls.subject || 'Без предмета'}</span>
                    </div>
                </div>
                ${cls.description ? `<p class="class-description">${cls.description}</p>` : ''}
                <div class="class-stats">
                    <div class="stat-item">
                        <span class="stat-value">${studentCount}</span>
                        <span class="stat-label">Учеников</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">${assignmentCount}</span>
                        <span class="stat-label">Заданий</span>
                    </div>
                </div>
                <div class="class-footer">
                    ${cls.grade ? `<span class="class-grade">${cls.grade} класс</span>` : '<span></span>'}
                    ${this.user.role === 'teacher' ? `
                        <span class="class-actions">
                            <button class="btn-icon" onclick="event.stopPropagation(); classesManager.editClass(${cls.id})">✏️</button>
                        </span>
                    ` : ''}
                </div>
            </div>
        `;
    }

    async openClassDetail(classId) {
        this.currentClass = this.classes.find(c => c.id === classId);
        if (!this.currentClass) return;

        document.getElementById('detailModalTitle').textContent = this.currentClass.name;

        // Загружаем учеников
        await this.loadStudents(classId);

        // Загружаем задания
        await this.loadClassAssignments(classId);

        // Заполняем форму настроек
        document.getElementById('editClassName').value = this.currentClass.name;
        document.getElementById('editClassSubject').value = this.currentClass.subject || '';
        document.getElementById('editClassGrade').value = this.currentClass.grade || '';
        document.getElementById('editClassDescription').value = this.currentClass.description || '';

        document.getElementById('classDetailModal').style.display = 'flex';
    }

    async loadStudents(classId) {
        try {
            const students = await api.get(`/classes/${classId}/students`);
            const container = document.getElementById('studentsList');

            if (students.length === 0) {
                container.innerHTML = '<div class="empty-state">В классе пока нет учеников</div>';
                return;
            }

            container.innerHTML = students.map(s => `
                <div class="student-item">
                    <div class="student-info">
                        <span class="student-name">${s.name}</span>
                        <span class="student-email">${s.email}</span>
                    </div>
                    <div class="student-stats">
                        ${this.user.role === 'teacher' ? `
                            <div class="student-progress">
                                <span>${s.completed_assignments || 0}/${s.total_assignments || 0}</span>
                                <div class="progress-mini">
                                    <div class="progress-mini-fill" style="width: ${s.total_assignments ? (s.completed_assignments / s.total_assignments * 100) : 0}%"></div>
                                </div>
                            </div>
                            <div class="student-actions">
                                <button class="btn-icon" onclick="classesManager.removeStudent(${classId}, ${s.id})" title="Удалить из класса">❌</button>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `).join('');
        } catch (error) {
            console.error('Failed to load students:', error);
        }
    }

    async loadClassAssignments(classId) {
        try {
            console.log('Loading assignments for class:', classId);
            const assignments = await api.get(`/classes/${classId}/assignments`);
            console.log('Loaded assignments:', assignments);

            // Проверяем каждое задание на наличие ID
            assignments.forEach((a, i) => {
                console.log(`Assignment ${i}:`, {
                    id: a.id,
                    group_assignment_id: a.group_assignment_id,
                    title: a.title,
                    status: a.status
                });
            });

            const container = document.getElementById('classAssignmentsList');

            if (assignments.length === 0) {
                container.innerHTML = '<div class="empty-state">Нет заданий</div>';
                return;
            }

            container.innerHTML = assignments.map(a => this.createAssignmentItem(a)).join('');
        } catch (error) {
            console.error('Failed to load assignments:', error);
        }
    }

    createAssignmentItem(assignment) {
        console.log('Creating assignment item:', assignment); // ← ДОБАВЬТЕ ЭТО

        // Определяем ID задания
        const assignmentId = assignment.group_assignment_id || assignment.id;
        console.log('Assignment ID for button:', assignmentId); // ← ДОБАВЬТЕ ЭТО

        const isOverdue = assignment.status === 'pending' && new Date(assignment.deadline) < new Date();
        const statusClass = isOverdue ? 'overdue' : (assignment.status || 'pending');
        const statusText = {
            'pending': 'Ожидает',
            'submitted': 'Сдано',
            'graded': `Оценка: ${assignment.grade || '?'}`,
            'overdue': 'Просрочено'
        }[statusClass] || statusClass;

        const submittedCount = assignment.submitted_count || 0;
        const totalStudents = assignment.total_students || 0;

        return `
        <div class="class-assignment-item" data-assignment-id="${assignmentId}">
            <div class="assignment-header">
                <strong>${assignment.title}</strong>
                <span class="assignment-status ${statusClass}">${statusText}</span>
            </div>
            ${assignment.description ? `<p>${assignment.description}</p>` : ''}
            <div class="assignment-deadline">
                ⏰ Дедлайн: ${formatDate(assignment.deadline)}
            </div>
            ${this.user.role === 'teacher' ? `
                <div class="assignment-stats">
                    Сдано: ${submittedCount}/${totalStudents}
                </div>
                <div class="assignment-actions">
                    <button class="btn btn-small btn-outline remind-all-btn" data-assignment-id="${assignmentId}">
                        📢 Напомнить всем
                    </button>
                </div>
            ` : ''}
            ${this.user.role === 'student' && assignment.status === 'pending' ? `
                <div class="assignment-actions">
                    <button class="btn btn-small btn-success submit-assignment-btn" data-assignment-id="${assignmentId}">
                        Отметить выполненным
                    </button>
                </div>
            ` : ''}
        </div>
    `;
    }

    async handleInvitation(invitationId, status) {
        try {
            await api.patch(`/classes/invitations/${invitationId}`, { status });
            showNotification(status === 'accepted' ? 'Приглашение принято' : 'Приглашение отклонено', 'success');
            await this.loadInvitations();
            await this.loadClasses();
        } catch (error) {
            showNotification('Ошибка обработки приглашения', 'error');
        }
    }

    async createClass(data) {
        try {
            await api.post('/classes', data);
            showNotification('Класс создан', 'success');
            this.closeModal('classModal');
            await this.loadClasses();
        } catch (error) {
            showNotification(error.message || 'Ошибка создания класса', 'error');
        }
    }

    async updateClass(classId, data) {
        try {
            await api.put(`/classes/${classId}`, data);
            showNotification('Класс обновлён', 'success');
            this.closeModal('classDetailModal');
            await this.loadClasses();
        } catch (error) {
            showNotification('Ошибка обновления класса', 'error');
        }
    }

    async deleteClass() {
        if (!confirm('Вы уверены? Это удалит класс и все связанные задания!')) return;

        try {
            await api.delete(`/classes/${this.currentClass.id}`);
            showNotification('Класс удалён', 'success');
            this.closeModal('classDetailModal');
            await this.loadClasses();
        } catch (error) {
            showNotification('Ошибка удаления класса', 'error');
        }
    }

    async inviteStudent(classId, email) {
        try {
            await api.post(`/classes/${classId}/invite`, { email });
            showNotification('Приглашение отправлено', 'success');
            this.closeModal('inviteModal');
        } catch (error) {
            showNotification(error.message || 'Ошибка отправки приглашения', 'error');
        }
    }

    async bulkInvite(classId, emailsText) {
        const emails = emailsText.split('\n').map(e => e.trim()).filter(e => e);

        try {
            const result = await api.post(`/classes/${classId}/invite-bulk`, { emails });

            const sent = result.results.filter(r => r.status === 'sent').length;
            const notFound = result.results.filter(r => r.status === 'not_found').length;

            showNotification(`Отправлено: ${sent}, не найдено: ${notFound}`, 'info');
            this.closeModal('bulkInviteModal');
        } catch (error) {
            showNotification('Ошибка отправки приглашений', 'error');
        }
    }

    async removeStudent(classId, studentId) {
        if (!confirm('Удалить ученика из класса?')) return;

        try {
            await api.delete(`/classes/${classId}/students/${studentId}`);
            showNotification('Ученик удалён', 'success');
            await this.loadStudents(classId);
        } catch (error) {
            showNotification('Ошибка удаления ученика', 'error');
        }
    }

    async createAssignment(classId, data) {
        try {
            await api.post(`/classes/${classId}/assignments`, data);
            showNotification('Задание создано и отправлено всем ученикам', 'success');
            this.closeModal('assignmentModal');
            await this.loadClassAssignments(classId);
        } catch (error) {
            showNotification('Ошибка создания задания', 'error');
        }
    }

    async submitAssignment(assignmentId) {
        console.log('=== SUBMIT GROUP ASSIGNMENT ===');
        console.log('Assignment ID:', assignmentId);

        if (!assignmentId || isNaN(assignmentId)) {
            console.error('Invalid assignment ID:', assignmentId);
            showNotification('Ошибка: неверный ID задания', 'error');
            return;
        }

        try {
            // Пробуем отправить как групповое задание
            const result = await api.patch(`/classes/assignments/${assignmentId}/submit`, {});
            console.log('Submit result:', result);

            showNotification('✅ Задание отмечено как выполненное', 'success');

            // Обновляем список заданий
            if (this.currentClass) {
                await this.loadClassAssignments(this.currentClass.id);
            }
        } catch (error) {
            console.error('Submit error:', error);

            // Если ошибка - пробуем как обычное задание
            try {
                console.log('Trying as individual assignment...');
                await api.patch(`/assignments/${assignmentId}/status`, { status: 'submitted' });
                showNotification('✅ Задание отмечено как выполненное', 'success');

                if (this.currentClass) {
                    await this.loadClassAssignments(this.currentClass.id);
                }
            } catch (e) {
                console.error('Both attempts failed:', e);
                showNotification('❌ Ошибка: ' + (error.message || 'Не удалось обновить статус'), 'error');
            }
        }
    }


    async remindAll(assignmentId) {
        try {
            const result = await api.post(`/classes/assignments/${assignmentId}/remind-all`, {});
            showNotification(result.message, 'success');
        } catch (error) {
            showNotification('Ошибка отправки напоминаний', 'error');
        }
    }

    editClass(classId) {
        const cls = this.classes.find(c => c.id === classId);
        if (!cls) return;

        document.getElementById('className').value = cls.name;
        document.getElementById('classSubject').value = cls.subject || '';
        document.getElementById('classGrade').value = cls.grade || '';
        document.getElementById('classDescription').value = cls.description || '';
        document.getElementById('modalTitle').textContent = 'Редактировать класс';
        document.getElementById('classModal').dataset.editId = classId;

        document.getElementById('classModal').style.display = 'flex';
    }

    closeModal(modalId) {
        document.getElementById(modalId).style.display = 'none';
        if (modalId === 'classModal') {
            document.getElementById('classForm').reset();
            document.getElementById('modalTitle').textContent = 'Создать новый класс';
            delete document.getElementById('classModal').dataset.editId;
        }
    }

    setupEventListeners() {
        // Обновление
        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.loadClasses();
            if (this.user.role === 'student') {
                this.loadInvitations();
            }
        });

        // Создание класса
        document.getElementById('createClassBtn').addEventListener('click', () => {
            document.getElementById('classModal').style.display = 'flex';
        });

        // Форма класса
        document.getElementById('classForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const data = {
                name: document.getElementById('className').value,
                subject: document.getElementById('classSubject').value,
                grade: parseInt(document.getElementById('classGrade').value) || null,
                description: document.getElementById('classDescription').value
            };

            const editId = document.getElementById('classModal').dataset.editId;
            if (editId) {
                await this.updateClass(editId, data);
            } else {
                await this.createClass(data);
            }
        });

        // Сохранение настроек класса
        document.getElementById('classSettingsForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const data = {
                name: document.getElementById('editClassName').value,
                subject: document.getElementById('editClassSubject').value,
                grade: parseInt(document.getElementById('editClassGrade').value) || null,
                description: document.getElementById('editClassDescription').value
            };

            await this.updateClass(this.currentClass.id, data);
        });

        // Удаление класса
        document.getElementById('deleteClassBtn').addEventListener('click', () => this.deleteClass());

        // Приглашение ученика
        document.getElementById('inviteStudentBtn')?.addEventListener('click', () => {
            document.getElementById('inviteModal').style.display = 'flex';
        });

        document.getElementById('inviteForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('studentEmail').value;
            await this.inviteStudent(this.currentClass.id, email);
        });

        // Массовое приглашение
        document.getElementById('bulkInviteBtn')?.addEventListener('click', () => {
            document.getElementById('bulkInviteModal').style.display = 'flex';
        });

        document.getElementById('bulkInviteForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const emails = document.getElementById('studentEmails').value;
            await this.bulkInvite(this.currentClass.id, emails);
        });

        // Создание задания
        document.getElementById('createAssignmentBtn')?.addEventListener('click', () => {
            document.getElementById('assignmentModal').style.display = 'flex';
        });

        document.getElementById('assignmentForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();

            const data = {
                title: document.getElementById('assignmentTitle').value,
                description: document.getElementById('assignmentDescription').value,
                subject: this.currentClass.subject,
                deadline: document.getElementById('assignmentDeadline').value,
                notifyBefore: document.getElementById('notifyBefore').value
            };

            await this.createAssignment(this.currentClass.id, data);
        });

        // Вкладки
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

                btn.classList.add('active');
                document.getElementById(btn.dataset.tab + 'Tab').classList.add('active');
            });
        });

        // Закрытие модальных окон
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                this.closeModal(modal.id);
            });
        });

        // Закрытие по клику вне окна
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.closeModal(e.target.id);
            }
        });
        document.addEventListener('click', async (e) => {
            if (e.target.classList.contains('submit-assignment-btn')) {
                const assignmentId = e.target.dataset.assignmentId;
                console.log('Submit button clicked, assignmentId:', assignmentId);

                if (assignmentId && assignmentId !== 'undefined') {
                    await this.submitAssignment(parseInt(assignmentId));
                } else {
                    console.error('Invalid assignment ID:', assignmentId);
                    showNotification('Ошибка: неверный ID задания', 'error');
                }
            }

            if (e.target.classList.contains('remind-all-btn')) {
                const assignmentId = e.target.dataset.assignmentId;
                console.log('Remind all button clicked, assignmentId:', assignmentId);
                if (assignmentId) {
                    await this.remindAll(parseInt(assignmentId));
                }
            }
        });
    }
}

let classesManager;
document.addEventListener('DOMContentLoaded', () => {
    classesManager = new ClassesManager();
});