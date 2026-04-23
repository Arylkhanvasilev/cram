// profile.js - Profile page logic

class ProfileManager {
    constructor() {
        this.user = JSON.parse(localStorage.getItem('user') || '{}');
        this.originalData = {};
        this.connections = { teachers: [], students: [], parents: [] };
        this.requests = [];
        this.currentTheme = localStorage.getItem('theme') || 'light';
        this.init();
    }

    async init() {
        if (!checkAuth()) return;

        this.setupUI();
        this.applyTheme(this.currentTheme);
        await this.loadUserData();
        await this.loadConnections();
        await this.loadRequests();
        this.setupEventListeners();
    }

    setupUI() {
        // Устанавливаем имя пользователя
        const userNameElement = document.getElementById('userName');
        if (userNameElement) {
            userNameElement.textContent = this.user.name;
        }

        // Устанавливаем инициалы для аватара
        const avatarInitials = document.getElementById('avatarInitials');
        if (avatarInitials && this.user.name) {
            avatarInitials.textContent = this.user.name.charAt(0).toUpperCase();
        }

        // Настраиваем тип связи в зависимости от роли
        const connectionType = document.getElementById('connectionType');
        if (connectionType) {
            let options = '';

            if (this.user.role === 'student') {
                options = `
                    <option value="teacher_student">Связаться с учителем</option>
                    <option value="parent_student">Связаться с родителем</option>
                `;
            } else if (this.user.role === 'teacher') {
                options = `
                    <option value="teacher_student">Связаться с учеником</option>
                `;
            } else if (this.user.role === 'parent') {
                options = `
                    <option value="parent_student">Связаться с ребёнком</option>
                `;
            }

            connectionType.innerHTML = options;
        }

        // Показываем/скрываем поле класса
        const gradeGroup = document.getElementById('gradeGroup');
        if (gradeGroup && this.user.role === 'student') {
            gradeGroup.style.display = 'block';
        }

        // Настройка логаута
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => logout());
        }
    }

    async loadUserData() {
        try {
            // Загружаем свежие данные пользователя
            const userData = await api.get('/auth/me');
            this.user = { ...this.user, ...userData };
            this.originalData = { ...userData };

            localStorage.setItem('user', JSON.stringify(this.user));

            // Заполняем форму
            document.getElementById('name').value = this.user.name || '';
            document.getElementById('email').value = this.user.email || '';
            document.getElementById('role').value = this.getRoleName(this.user.role);

            if (this.user.role === 'student') {
                document.getElementById('grade').value = this.user.grade || '';
            }

            document.getElementById('phone').value = this.user.phone || '';
            document.getElementById('bio').value = this.user.bio || '';

            // Устанавливаем тему
            const theme = this.user.theme || 'light';
            const themeRadio = document.querySelector(`input[name="theme"][value="${theme}"]`);
            if (themeRadio) {
                themeRadio.checked = true;
            }

        } catch (error) {
            console.error('Failed to load user data:', error);
            showNotification('Ошибка загрузки данных профиля', 'error');
        }
    }

    async loadConnections() {
        try {
            const connections = await api.get('/auth/profile/connections');
            this.connections = connections;
            this.renderConnections();
        } catch (error) {
            console.error('Failed to load connections:', error);
        }
    }

    async loadRequests() {
        try {
            const requests = await api.get('/auth/profile/connection-requests');
            this.requests = requests;
            this.renderRequests();
        } catch (error) {
            console.error('Failed to load requests:', error);
        }
    }

    renderConnections() {
        const container = document.getElementById('connectionsList');
        if (!container) return;

        let html = '';

        // Учителя (для ученика)
        if (this.connections.teachers && this.connections.teachers.length > 0) {
            html += '<h4 style="margin: 1rem 0 0.5rem;">👨‍🏫 Учителя</h4>';
            this.connections.teachers.forEach(teacher => {
                html += this.createConnectionItem(teacher, 'teacher');
            });
        }

        // Ученики (для учителя и родителя)
        if (this.connections.students && this.connections.students.length > 0) {
            const title = this.user.role === 'teacher' ? '🎓 Ученики' : '👶 Дети';
            html += `<h4 style="margin: 1rem 0 0.5rem;">${title}</h4>`;
            this.connections.students.forEach(student => {
                html += this.createConnectionItem(student, 'student');
            });
        }

        // Родители (для ученика)
        if (this.connections.parents && this.connections.parents.length > 0) {
            html += '<h4 style="margin: 1rem 0 0.5rem;">👪 Родители</h4>';
            this.connections.parents.forEach(parent => {
                html += this.createConnectionItem(parent, 'parent');
            });
        }

        if (html === '') {
            html = '<div class="empty-state">Нет активных связей</div>';
        }

        container.innerHTML = html;
    }

    createConnectionItem(person, type) {
        const details = [];
        if (person.subject) details.push(person.subject);
        if (person.relationship) details.push(person.relationship);
        if (person.grade) details.push(`${person.grade} класс`);

        return `
            <div class="connection-item">
                <div class="connection-info">
                    <span class="connection-name">${person.name}</span>
                    <span class="connection-details">${person.email}${details.length ? ' • ' + details.join(' • ') : ''}</span>
                </div>
                <div class="connection-actions">
                    <button class="btn btn-small btn-outline" onclick="profile.removeConnection('${type}', ${person.id})">
                        Удалить
                    </button>
                </div>
            </div>
        `;
    }

    renderRequests() {
        const section = document.getElementById('requestsSection');
        const container = document.getElementById('requestsList');

        if (!section || !container) return;

        if (this.requests.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';

        container.innerHTML = this.requests.map(request => `
            <div class="request-item">
                <div class="request-info">
                    <span class="request-name">${request.name}</span>
                    <span class="request-email">${request.email} (${this.getRoleName(request.role)})</span>
                    ${request.message ? `<span class="request-message">💬 ${request.message}</span>` : ''}
                </div>
                <div class="request-actions">
                    <button class="btn btn-small btn-success" onclick="profile.handleRequest(${request.id}, 'accepted')">
                        Принять
                    </button>
                    <button class="btn btn-small btn-outline" onclick="profile.handleRequest(${request.id}, 'rejected')">
                        Отклонить
                    </button>
                </div>
            </div>
        `).join('');
    }

    async handleRequest(requestId, status) {
        try {
            await api.patch(`/auth/profile/connection-requests/${requestId}`, { status });
            showNotification(status === 'accepted' ? 'Запрос принят' : 'Запрос отклонён', 'success');
            await this.loadRequests();
            await this.loadConnections();
        } catch (error) {
            showNotification('Ошибка обработки запроса', 'error');
        }
    }

    async removeConnection(type, id) {
        if (!confirm('Вы уверены, что хотите удалить эту связь?')) return;

        try {
            await api.delete(`/auth/profile/connections/${type}/${id}`);
            showNotification('Связь удалена', 'success');
            await this.loadConnections();
        } catch (error) {
            showNotification('Ошибка удаления связи', 'error');
        }
    }

    getRoleName(role) {
        const roles = {
            'student': 'Ученик',
            'teacher': 'Учитель',
            'parent': 'Родитель'
        };
        return roles[role] || role;
    }

    setupEventListeners() {
        // Табы
        document.querySelectorAll('.profile-nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const tabName = item.dataset.tab;
                this.switchTab(tabName);
            });
        });

        // Обработчики для выбора темы
        document.querySelectorAll('.theme-option').forEach(option => {
            // Клик по всей карточке
            option.addEventListener('click', (e) => {
                // Не срабатывает если кликнули по radio (он сам обработается)
                if (e.target.type !== 'radio') {
                    const radio = option.querySelector('input[type="radio"]');
                    if (radio) {
                        radio.checked = true;
                        this.updateThemeSelection(option.dataset.theme);
                    }
                }
            });

            // Отдельно для radio
            const radio = option.querySelector('input[type="radio"]');
            if (radio) {
                radio.addEventListener('change', (e) => {
                    this.updateThemeSelection(option.dataset.theme);
                });
            }
        });

        // Форма профиля
        const profileForm = document.getElementById('profileForm');
        if (profileForm) {
            profileForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.saveProfile();
            });
        }

        // Форма пароля
        const passwordForm = document.getElementById('passwordForm');
        if (passwordForm) {
            passwordForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.changePassword();
            });
        }

        // Форма связи
        const connectionForm = document.getElementById('connectionForm');
        if (connectionForm) {
            connectionForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.sendConnectionRequest();
            });
        }

        // Подтверждение удаления
        const deleteConfirm = document.getElementById('deleteConfirm');
        if (deleteConfirm) {
            deleteConfirm.addEventListener('input', (e) => {
                const btn = document.getElementById('deleteConfirmBtn');
                btn.disabled = e.target.value !== 'УДАЛИТЬ';
            });
        }

        // Форма удаления
        const deleteForm = document.getElementById('deleteForm');
        if (deleteForm) {
            deleteForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.deleteAccount();
            });
        }

        // Аватар
        const avatarInput = document.getElementById('avatarInput');
        if (avatarInput) {
            avatarInput.addEventListener('change', (e) => {
                this.handleAvatarUpload(e.target.files[0]);
            });
        }
    }

    switchTab(tabName) {
        // Обновляем активный пункт меню
        document.querySelectorAll('.profile-nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.tab === tabName);
        });

        // Обновляем активную вкладку
        document.querySelectorAll('.profile-tab').forEach(tab => {
            tab.classList.toggle('active', tab.id === tabName);
        });
    }

    async saveProfile() {
        try {
            const data = {
                name: document.getElementById('name').value,
                phone: document.getElementById('phone').value,
                bio: document.getElementById('bio').value
            };

            if (this.user.role === 'student') {
                data.grade = parseInt(document.getElementById('grade').value);
            }

            const updated = await api.put('/auth/profile', data);
            this.user = { ...this.user, ...updated };
            localStorage.setItem('user', JSON.stringify(this.user));

            // Обновляем отображение имени
            document.getElementById('userName').textContent = this.user.name;
            document.getElementById('avatarInitials').textContent = this.user.name.charAt(0).toUpperCase();

            showNotification('Профиль обновлён', 'success');
        } catch (error) {
            showNotification('Ошибка сохранения профиля', 'error');
        }
    }

    resetForm() {
        document.getElementById('name').value = this.originalData.name || '';
        document.getElementById('phone').value = this.originalData.phone || '';
        document.getElementById('bio').value = this.originalData.bio || '';
        if (this.user.role === 'student') {
            document.getElementById('grade').value = this.originalData.grade || '';
        }
    }

    async changePassword() {
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const errorDiv = document.getElementById('passwordError');

        if (newPassword !== confirmPassword) {
            errorDiv.textContent = 'Пароли не совпадают';
            errorDiv.style.display = 'block';
            return;
        }

        if (newPassword.length < 6) {
            errorDiv.textContent = 'Пароль должен быть не менее 6 символов';
            errorDiv.style.display = 'block';
            return;
        }

        try {
            await api.put('/auth/profile/password', { currentPassword, newPassword });
            showNotification('Пароль изменён', 'success');
            document.getElementById('passwordForm').reset();
            errorDiv.style.display = 'none';
        } catch (error) {
            errorDiv.textContent = error.message || 'Ошибка изменения пароля';
            errorDiv.style.display = 'block';
        }
    }

    async sendConnectionRequest() {
        const requestType = document.getElementById('connectionType').value;
        const email = document.getElementById('connectionEmail').value;
        const message = document.getElementById('connectionMessage').value;

        try {
            await api.post('/auth/profile/connection-request', {
                toEmail: email,
                requestType,
                message
            });

            showNotification('Запрос отправлен', 'success');
            document.getElementById('connectionForm').reset();
        } catch (error) {
            showNotification(error.message || 'Ошибка отправки запроса', 'error');
        }
    }

    saveTheme() {
        const selectedTheme = document.querySelector('input[name="theme"]:checked')?.value || 'light';
        console.log('Saving theme:', selectedTheme);

        this.currentTheme = selectedTheme;
        this.applyTheme(selectedTheme);

        // Сохраняем на сервере
        api.put('/auth/profile', { theme: selectedTheme })
            .then(() => {
                showNotification('✅ Тема сохранена', 'success');

                // Анимация успешного применения
                this.animateThemeApplied();
            })
            .catch(() => {
                showNotification('❌ Ошибка сохранения темы', 'error');
            });

        localStorage.setItem('theme', selectedTheme);
    }

    // Добавьте новый метод для анимации
    animateThemeApplied() {
        const selectedCard = document.querySelector('.theme-option:has(input:checked) .theme-card');
        if (selectedCard) {
            selectedCard.style.transform = 'scale(0.95)';
            setTimeout(() => {
                selectedCard.style.transform = 'scale(1)';
            }, 150);
        }
    }

    applyTheme(theme) {
        // Используем глобальную функцию из app.js
        if (window.applyTheme) {
            window.applyTheme(theme);
        } else {
            // Fallback
            let actualTheme = theme;
            if (theme === 'system') {
                actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            }
            document.body.setAttribute('data-theme', actualTheme);
            localStorage.setItem('theme', theme);
        }

        this.currentTheme = theme;
    }

    handleAvatarUpload(file) {
        if (!file) return;

        // В реальном приложении здесь была бы загрузка на сервер
        const reader = new FileReader();
        reader.onload = (e) => {
            const avatarPlaceholder = document.querySelector('.avatar-placeholder');
            avatarPlaceholder.style.backgroundImage = `url(${e.target.result})`;
            avatarPlaceholder.style.backgroundSize = 'cover';
            avatarPlaceholder.style.backgroundPosition = 'center';
            document.getElementById('avatarInitials').style.display = 'none';

            showNotification('Фото обновлено (демо)', 'success');
        };
        reader.readAsDataURL(file);
    }

    showDeleteModal() {
        document.getElementById('deleteModal').style.display = 'flex';
    }

    closeDeleteModal() {
        document.getElementById('deleteModal').style.display = 'none';
        document.getElementById('deleteForm').reset();
        document.getElementById('deleteConfirmBtn').disabled = true;
    }

    async deleteAccount() {
        try {
            await api.delete('/auth/profile');
            showNotification('Аккаунт удалён', 'success');

            setTimeout(() => {
                logout();
            }, 1500);
        } catch (error) {
            showNotification('Ошибка удаления аккаунта', 'error');
        }
    }
}

// Инициализация
let profile;
document.addEventListener('DOMContentLoaded', () => {
    profile = new ProfileManager();
});

// Отслеживание системной темы
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    const currentTheme = localStorage.getItem('theme') || 'light';
    if (currentTheme === 'system' && profile) {
        profile.applyTheme('system');
    }
});

