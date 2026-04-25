/**
 * SPA Router — навигация без перезагрузки
 */

// Кэш страниц
const pageCache = {};
let currentPage = 'dashboard';

// Инициализаторы страниц
const pageInit = {
    dashboard: null,
    tasks: null,
    students: null,
    statistics: null,
    ai: null,
    profile: null
};

// ===== ЗАГРУЗКА СТРАНИЦ =====

async function loadPage(pageName) {
    const appContent = document.getElementById('appContent');
    appContent.innerHTML = '<div style="text-align:center;padding:60px 20px;">Загрузка...</div>';

    try {
        if (!pageCache[pageName]) {
            const response = await fetch('pages/' + pageName + '-content.html');
            pageCache[pageName] = await response.text();
        }

        appContent.innerHTML = pageCache[pageName];

        document.querySelectorAll('.nav-item[data-page]').forEach(item => {
            item.classList.toggle('active', item.dataset.page === pageName);
        });

        currentPage = pageName;

        // Запускаем скрипты из загруженного контента
        const scripts = appContent.querySelectorAll('script');
        scripts.forEach(script => {
            try {
                const newScript = document.createElement('script');
                newScript.textContent = script.textContent;
                document.body.appendChild(newScript);
            } catch (e) {
                console.log('Script error:', e.message);
            }
        });

        // Принудительная инициализация
        setTimeout(() => {
            if (pageName === 'dashboard' && typeof DashboardController !== 'undefined') {
                if (window.currentDashboard) window.currentDashboard.destroyed = true;
                window.currentDashboard = new DashboardController();
                window.currentDashboard.init();
            }
            if (pageName === 'tasks' && typeof TasksController !== 'undefined') {
                if (window.currentTasks) window.currentTasks = null;
                window.currentTasks = new TasksController();
                window.currentTasks.init();
            }
        }, 300);

    } catch (error) {
        console.error('Load error:', error);
        appContent.innerHTML = '<div style="text-align:center;padding:40px;">Ошибка загрузки</div>';
    }
}

// ===== МОДАЛКА =====

function closeModal() {
    document.getElementById('taskModal').style.display = 'none';
    document.getElementById('taskForm')?.reset();
    const warning = document.getElementById('classWarning');
    if (warning) warning.style.display = 'none';
}

// ===== ФУНКЦИИ ДЛЯ МОДАЛКИ СОЗДАНИЯ ЗАДАНИЯ =====

async function openTaskModal() {
    const user = Auth.getUser();

    // Если учитель — загружаем классы
    if (user?.role === 'teacher') {
        await loadTeacherClasses();
    }

    document.getElementById('taskModal').style.display = 'flex';
}

async function loadTeacherClasses() {
    try {
        const classes = await api.get('/assignments/teacher-classes');
        const container = document.getElementById('classCheckboxes');

        if (!container) return;

        if (!classes.length) {
            container.innerHTML = '<p style="color:var(--color-text-muted);padding:8px;">Нет классов</p>';
            return;
        }

        container.innerHTML = '';

        classes.forEach(cls => {
            const label = document.createElement('label');
            label.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px;cursor:pointer;';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = cls.id;
            checkbox.style.cssText = 'width:18px;height:18px;accent-color:var(--color-primary);';
            checkbox.onchange = checkClasses;

            const div = document.createElement('div');
            div.innerHTML = `
                <div style="font-weight:600;font-size:13px;">${cls.name}</div>
                <div style="font-size:11px;color:var(--color-text-muted);">${cls.subject} · ${cls.student_count} уч.</div>
            `;

            label.appendChild(checkbox);
            label.appendChild(div);
            container.appendChild(label);
        });
    } catch (e) {
        const container = document.getElementById('classCheckboxes');
        if (container) container.innerHTML = '<p style="color:#EF4444;padding:8px;">Ошибка загрузки</p>';
    }
}

function checkClasses() {
    const checkboxes = document.querySelectorAll('#classCheckboxes input[type="checkbox"]');
    let count = 0;
    checkboxes.forEach(cb => { if (cb.checked) count++; });

    const btn = document.getElementById('submitTaskBtn');
    const warning = document.getElementById('classWarning');

    if (!btn) return;

    if (count > 0) {
        btn.disabled = false;
        btn.textContent = 'Создать задачу (' + count + ' класс)';
        if (warning) warning.style.display = 'none';
    } else {
        btn.disabled = true;
        btn.textContent = 'Выберите класс';
        if (warning) warning.style.display = 'block';
    }
}

async function submitTaskForm() {
    const checkboxes = document.querySelectorAll('#classCheckboxes input[type="checkbox"]:checked');
    const classIds = [];
    checkboxes.forEach(cb => classIds.push(parseInt(cb.value)));

    if (classIds.length === 0) {
        checkClasses();
        return;
    }

    const data = {
        title: document.getElementById('taskTitle').value,
        description: document.getElementById('taskDesc').value,
        subject: document.getElementById('taskSubject').value,
        deadline: document.getElementById('taskDeadline').value,
        classIds: classIds
    };

    try {
        await api.post('/assignments/for-class', data);
        showToast('✅ Задача создана!');
        closeModal();
        loadPage(currentPage);
    } catch (error) {
        showToast('❌ Ошибка', 'error');
    }
}

// ===== AI ФУНКЦИИ =====

async function generateTaskIdea() {
    const subject = document.getElementById('taskSubject')?.value || 'Математика';
    const topic = prompt('На какую тему нужно задание?', 'Квадратные уравнения');
    if (!topic) return;

    try {
        showToast('⏳ Генерирую идеи...');
        const response = await api.post('/ai/chat', {
            message: `Придумай 3 варианта домашнего задания по предмету "${subject}" на тему "${topic}" для 9 класса. Для каждого укажи название и краткое описание.`
        });

        const container = document.getElementById('aiTaskIdeas');
        if (container) {
            container.innerHTML = '<p style="font-weight:600;margin-bottom:8px;">💡 Идеи от AI:</p>';
            container.innerHTML += `<div style="background:#E9FFD6;border-radius:var(--radius-md);padding:12px;white-space:pre-line;">${response.reply}</div>`;
        }
    } catch (e) {
        showToast('❌ Ошибка', 'error');
    }
}

async function refreshAIInsights() {
    try {
        const tasks = await api.get('/assignments');
        const pendingTasks = tasks.filter(t => t.status === 'pending');
        const response = await api.post('/ai/chat', {
            message: `У меня ${pendingTasks.length} активных задач. Дай короткий совет что делать.`
        });
        showToast(response.reply, 'success');
    } catch (e) {
        showToast('AI недоступен', 'error');
    }
}

async function generateSchedule() {
    const btn = document.getElementById('btnSchedule');
    if (btn) { btn.textContent = 'Составляю...'; btn.disabled = true; }

    try {
        const tasks = await api.get('/assignments');
        const pendingTasks = tasks.filter(t => t.status === 'pending');
        const response = await api.post('/ai/chat', {
            message: `Составь расписание на сегодня: ${pendingTasks.map(t => t.subject + ': ' + t.title).join(', ')}`
        });
        showToast('Расписание готово!');
        alert(response.reply);
    } catch (e) {
        showToast('Ошибка', 'error');
    } finally {
        if (btn) { btn.textContent = 'Расписание на сегодня'; btn.disabled = false; }
    }
}

function selectIdea(title, desc) {
    document.getElementById('taskTitle').value = title;
    document.getElementById('taskDesc').value = desc;
    showToast('Идея выбрана!');
}

function updateNavAvatar() {
    const user = Auth.getUser();
    if (!user) return;

    const photo = document.getElementById('navUserPhoto');
    if (photo) {
        // Если у пользователя есть фото — показываем его
        if (user.avatar_url) {
            photo.src = user.avatar_url;
        }
    }
}

// ===== ОБРАБОТЧИК ПЛЮСИКА =====

document.addEventListener('click', function (e) {
    if (e.target.closest('#addTaskBtn')) {
        openTaskModal();
    }
});

// ===== ЗАПУСК =====

document.addEventListener('DOMContentLoaded', () => {
    if (!Auth.isAuthenticated()) {
        window.location.href = 'login.html';
        return;
    }

    const user = Auth.getUser();
    if (user) {
        const fallback = document.getElementById('navAvatarFallback');
        if (fallback) {
            fallback.textContent = (user.name || '?')[0].toUpperCase();
            fallback.style.display = 'flex';
        }
    }

    updateNavAvatar()

    // Загружаем дашборд
    loadPage('dashboard');

    // Навбар
    document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
        btn.addEventListener('click', () => loadPage(btn.dataset.page));
    });
});