const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Register
router.post('/register', [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('name').notEmpty().trim(),
    body('role').isIn(['teacher', 'student', 'parent'])
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password, name, role, grade } = req.body;

        // Check if user exists
        const userExists = await db.query('SELECT id FROM users WHERE email = $1', [email]);
        if (userExists.rows.length > 0) {
            return res.status(400).json({ error: 'User already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const result = await db.query(
            'INSERT INTO users (email, password, name, role, grade) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, name, role',
            [email, hashedPassword, name, role, grade || null]
        );

        const user = result.rows[0];

        // Generate token
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ token, user });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Login
router.post('/login', [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;

        // Get user
        const result = await db.query(
            'SELECT id, email, password, name, role, grade FROM users WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];

        // Check password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate token
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Remove password from response
        delete user.password;

        // Update last login
        await db.query('UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

        res.json({ token, user });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get current user
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT id, email, name, role, grade, created_at FROM users WHERE id = $1',
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ... (существующий код остаётся без изменений)

// ============== НОВЫЕ ЭНДПОИНТЫ ПРОФИЛЯ ==============

// Обновление профиля
router.put('/profile', authenticateToken, async (req, res) => {
    try {
        const { name, phone, bio, theme, grade } = req.body;
        const userId = req.user.id;
        
        const updates = [];
        const values = [];
        let paramIndex = 1;
        
        if (name !== undefined) {
            updates.push(`name = $${paramIndex++}`);
            values.push(name);
        }
        if (phone !== undefined) {
            updates.push(`phone = $${paramIndex++}`);
            values.push(phone);
        }
        if (bio !== undefined) {
            updates.push(`bio = $${paramIndex++}`);
            values.push(bio);
        }
        if (theme !== undefined) {
            updates.push(`theme = $${paramIndex++}`);
            values.push(theme);
        }
        if (grade !== undefined && req.user.role === 'student') {
            updates.push(`grade = $${paramIndex++}`);
            values.push(grade);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        
        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(userId);
        
        const query = `
            UPDATE users 
            SET ${updates.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING id, email, name, role, grade, phone, bio, theme, avatar_url
        `;
        
        const result = await db.query(query, values);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Изменение пароля
router.put('/profile/password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.id;
        
        // Проверяем текущий пароль
        const userResult = await db.query(
            'SELECT password FROM users WHERE id = $1',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const validPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid current password' });
        }
        
        // Хешируем новый пароль
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        await db.query(
            'UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [hashedPassword, userId]
        );
        
        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        console.error('Password update error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Удаление аккаунта
router.delete('/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Удаляем пользователя (каскадно удалятся все связи)
        await db.query('DELETE FROM users WHERE id = $1', [userId]);
        
        res.json({ message: 'Account deleted successfully' });
    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Получение связей пользователя
router.get('/profile/connections', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;
        
        let connections = { teachers: [], students: [], parents: [] };
        
        if (role === 'student') {
            // Учителя ученика
            const teachersResult = await db.query(`
                SELECT u.id, u.name, u.email, stl.subject
                FROM student_teacher_links stl
                JOIN users u ON stl.teacher_id = u.id
                WHERE stl.student_id = $1
            `, [userId]);
            connections.teachers = teachersResult.rows;
            
            // Родители ученика
            const parentsResult = await db.query(`
                SELECT u.id, u.name, u.email, psl.relationship
                FROM parent_student_links psl
                JOIN users u ON psl.parent_id = u.id
                WHERE psl.student_id = $1
            `, [userId]);
            connections.parents = parentsResult.rows;
        }
        
        if (role === 'teacher') {
            // Ученики учителя
            const studentsResult = await db.query(`
                SELECT u.id, u.name, u.email, u.grade, stl.subject
                FROM student_teacher_links stl
                JOIN users u ON stl.student_id = u.id
                WHERE stl.teacher_id = $1
                ORDER BY u.name
            `, [userId]);
            connections.students = studentsResult.rows;
        }
        
        if (role === 'parent') {
            // Дети родителя
            const childrenResult = await db.query(`
                SELECT u.id, u.name, u.email, u.grade, psl.relationship
                FROM parent_student_links psl
                JOIN users u ON psl.student_id = u.id
                WHERE psl.parent_id = $1
            `, [userId]);
            connections.students = childrenResult.rows;
        }
        
        res.json(connections);
    } catch (error) {
        console.error('Get connections error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Удаление связи
router.delete('/profile/connections/:type/:id', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { type, id } = req.params;
        
        if (type === 'teacher' && req.user.role === 'student') {
            await db.query(
                'DELETE FROM student_teacher_links WHERE student_id = $1 AND teacher_id = $2',
                [userId, id]
            );
        } else if (type === 'student' && req.user.role === 'teacher') {
            await db.query(
                'DELETE FROM student_teacher_links WHERE teacher_id = $1 AND student_id = $2',
                [userId, id]
            );
        } else if (type === 'parent' && req.user.role === 'student') {
            await db.query(
                'DELETE FROM parent_student_links WHERE student_id = $1 AND parent_id = $2',
                [userId, id]
            );
        } else if (type === 'student' && req.user.role === 'parent') {
            await db.query(
                'DELETE FROM parent_student_links WHERE parent_id = $1 AND student_id = $2',
                [userId, id]
            );
        } else {
            return res.status(400).json({ error: 'Invalid connection type' });
        }
        
        res.json({ message: 'Connection removed' });
    } catch (error) {
        console.error('Remove connection error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============== ЗАПРОСЫ НА СВЯЗЫВАНИЕ ==============

// Отправить запрос на связывание
router.post('/profile/connection-request', authenticateToken, async (req, res) => {
    try {
        const { toEmail, requestType, message } = req.body;
        const fromUserId = req.user.id;
        
        // Находим пользователя по email
        const userResult = await db.query(
            'SELECT id, role FROM users WHERE email = $1',
            [toEmail]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const toUser = userResult.rows[0];
        
        // Проверяем соответствие ролей
        if (requestType === 'parent_student') {
            if (!((req.user.role === 'parent' && toUser.role === 'student') ||
                  (req.user.role === 'student' && toUser.role === 'parent'))) {
                return res.status(400).json({ error: 'Invalid roles for parent-student connection' });
            }
        }
        
        if (requestType === 'teacher_student') {
            if (!((req.user.role === 'teacher' && toUser.role === 'student') ||
                  (req.user.role === 'student' && toUser.role === 'teacher'))) {
                return res.status(400).json({ error: 'Invalid roles for teacher-student connection' });
            }
        }
        
        // Создаём запрос
        const result = await db.query(`
            INSERT INTO connection_requests (from_user_id, to_user_id, request_type, message)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (from_user_id, to_user_id, request_type) 
            DO UPDATE SET status = 'pending', updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `, [fromUserId, toUser.id, requestType, message]);
        
        // Создаём уведомление
        await db.query(`
            INSERT INTO notifications (user_id, message, type)
            VALUES ($1, $2, 'connection_request')
        `, [toUser.id, `${req.user.name} хочет добавить вас в связи`]);
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Connection request error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Получить входящие запросы
router.get('/profile/connection-requests', authenticateToken, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT cr.*, u.name, u.email, u.role
            FROM connection_requests cr
            JOIN users u ON cr.from_user_id = u.id
            WHERE cr.to_user_id = $1 AND cr.status = 'pending'
            ORDER BY cr.created_at DESC
        `, [req.user.id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Get requests error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Ответить на запрос
router.patch('/profile/connection-requests/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // 'accepted' или 'rejected'
        
        // Получаем запрос
        const requestResult = await db.query(
            'SELECT * FROM connection_requests WHERE id = $1 AND to_user_id = $2',
            [id, req.user.id]
        );
        
        if (requestResult.rows.length === 0) {
            return res.status(404).json({ error: 'Request not found' });
        }
        
        const request = requestResult.rows[0];
        
        // Обновляем статус
        await db.query(
            'UPDATE connection_requests SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [status, id]
        );
        
        // Если принято - создаём связь
        if (status === 'accepted') {
            if (request.request_type === 'parent_student') {
                // Определяем кто родитель, кто ученик
                const fromUser = await db.query('SELECT role FROM users WHERE id = $1', [request.from_user_id]);
                const parentId = fromUser.rows[0].role === 'parent' ? request.from_user_id : request.to_user_id;
                const studentId = fromUser.rows[0].role === 'student' ? request.from_user_id : request.to_user_id;
                
                await db.query(`
                    INSERT INTO parent_student_links (parent_id, student_id)
                    VALUES ($1, $2)
                    ON CONFLICT (parent_id, student_id) DO NOTHING
                `, [parentId, studentId]);
            }
            
            if (request.request_type === 'teacher_student') {
                const fromUser = await db.query('SELECT role FROM users WHERE id = $1', [request.from_user_id]);
                const teacherId = fromUser.rows[0].role === 'teacher' ? request.from_user_id : request.to_user_id;
                const studentId = fromUser.rows[0].role === 'student' ? request.from_user_id : request.to_user_id;
                
                await db.query(`
                    INSERT INTO student_teacher_links (student_id, teacher_id)
                    VALUES ($1, $2)
                    ON CONFLICT (student_id, teacher_id) DO NOTHING
                `, [studentId, teacherId]);
            }
            
            // Уведомление отправителю
            await db.query(`
                INSERT INTO notifications (user_id, message, type)
                VALUES ($1, $2, 'connection_accepted')
            `, [request.from_user_id, 'Ваш запрос на связь принят!']);
        }
        
        res.json({ message: `Request ${status}` });
    } catch (error) {
        console.error('Handle request error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== ДВУХЭТАПНАЯ РЕГИСТРАЦИЯ =====

// Шаг 1: Отправка кода на почту
router.post('/send-code', async (req, res) => {
    try {
        const { email, name, password, role, grade } = req.body;
        
        // Проверяем что пользователя нет
        const exists = await db.query('SELECT id FROM users WHERE email = $1', [email]);
        if (exists.rows.length > 0) {
            return res.status(400).json({ error: 'Пользователь уже существует' });
        }
        
        // Генерируем 6-значный код
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60000); // 10 минут
        
        // Сохраняем во временную таблицу
        await db.query(`
            INSERT INTO verification_codes (email, code, name, password, role, grade, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (email) DO UPDATE 
            SET code = $2, name = $3, password = $4, role = $5, grade = $6, expires_at = $7
        `, [email, code, name, password, role, grade, expiresAt]);
        
        // Отправляем код (в консоль, потом можно на почту)
        console.log(`=== КОД ДЛЯ ${email}: ${code} ===`);
        
        res.json({ success: true, message: 'Код отправлен' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Шаг 2: Проверка кода и создание пользователя
router.post('/verify-code', async (req, res) => {
    try {
        const { email, code } = req.body;
        
        // Проверяем код
        const result = await db.query(
            'SELECT * FROM verification_codes WHERE email = $1 AND code = $2 AND expires_at > NOW()',
            [email, code]
        );
        
        if (!result.rows.length) {
            return res.status(400).json({ error: 'Неверный или истёкший код' });
        }
        
        const data = result.rows[0];
        
        // Хешируем пароль
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash(data.password, 10);
        
        // Создаём пользователя
        const user = await db.query(`
            INSERT INTO users (email, password, name, role, grade)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, email, name, role, grade
        `, [email, hashedPassword, data.name, data.role, data.grade]);
        
        // Удаляем код
        await db.query('DELETE FROM verification_codes WHERE email = $1', [email]);
        
        // Генерируем токен
        const jwt = require('jsonwebtoken');
        const token = jwt.sign(
            { id: user.rows[0].id, email: user.rows[0].email, role: user.rows[0].role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.json({ token, user: user.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

module.exports = router;