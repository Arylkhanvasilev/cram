const express = require('express');
const db = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const router = express.Router();

// ============== УПРАВЛЕНИЕ КЛАССАМИ ==============

// Получить классы учителя
router.get('/', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        const result = await db.query(`
            SELECT c.*, 
                   COUNT(DISTINCT cs.student_id) as student_count,
                   COUNT(DISTINCT ga.id) as assignment_count
            FROM classes c
            LEFT JOIN class_students cs ON c.id = cs.class_id
            LEFT JOIN group_assignments ga ON c.id = ga.class_id
            WHERE c.teacher_id = $1
            GROUP BY c.id
            ORDER BY c.created_at DESC
        `, [req.user.id]);

        res.json(result.rows);
    } catch (error) {
        console.error('Get classes error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Получить классы ученика
router.get('/student', authenticateToken, authorizeRole('student'), async (req, res) => {
    try {
        const result = await db.query(`
            SELECT c.*, u.name as teacher_name
            FROM classes c
            JOIN class_students cs ON c.id = cs.class_id
            JOIN users u ON c.teacher_id = u.id
            WHERE cs.student_id = $1
            ORDER BY c.name
        `, [req.user.id]);

        res.json(result.rows);
    } catch (error) {
        console.error('Get student classes error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Создать класс
router.post('/', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        const { name, description, subject, grade } = req.body;

        const result = await db.query(`
            INSERT INTO classes (name, description, teacher_id, subject, grade)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [name, description, req.user.id, subject, grade]);

        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Класс с таким названием уже существует' });
        }
        console.error('Create class error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Обновить класс
router.put('/:id', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, subject, grade } = req.body;

        // Проверяем, что класс принадлежит учителю
        const checkResult = await db.query(
            'SELECT id FROM classes WHERE id = $1 AND teacher_id = $2',
            [id, req.user.id]
        );

        if (checkResult.rows.length === 0) {
            return res.status(404).json({ error: 'Класс не найден' });
        }

        const result = await db.query(`
            UPDATE classes 
            SET name = $1, description = $2, subject = $3, grade = $4, updated_at = CURRENT_TIMESTAMP
            WHERE id = $5
            RETURNING *
        `, [name, description, subject, grade, id]);

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Update class error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Удалить класс
router.delete('/:id', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        const { id } = req.params;

        await db.query('DELETE FROM classes WHERE id = $1 AND teacher_id = $2', [id, req.user.id]);

        res.json({ message: 'Класс удалён' });
    } catch (error) {
        console.error('Delete class error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============== УЧЕНИКИ В КЛАССЕ ==============

// Получить учеников класса
router.get('/:id/students', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        let query;
        let params = [id];

        if (req.user.role === 'teacher') {
            query = `
                SELECT u.id, u.name, u.email, u.grade, cs.joined_at,
                       COUNT(DISTINCT gat.id) as total_assignments,
                       COUNT(DISTINCT CASE WHEN gat.status = 'submitted' THEN gat.id END) as completed_assignments
                FROM class_students cs
                JOIN users u ON cs.student_id = u.id
                LEFT JOIN group_assignments ga ON ga.class_id = cs.class_id
                LEFT JOIN group_assignment_targets gat ON gat.group_assignment_id = ga.id AND gat.student_id = u.id
                WHERE cs.class_id = $1
                GROUP BY u.id, u.name, u.email, u.grade, cs.joined_at
                ORDER BY u.name
            `;
        } else if (req.user.role === 'student') {
            query = `
                SELECT u.id, u.name, u.email, u.grade, cs.joined_at
                FROM class_students cs
                JOIN users u ON cs.student_id = u.id
                WHERE cs.class_id = $1
                ORDER BY u.name
            `;
        } else {
            return res.status(403).json({ error: 'Access denied' });
        }

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Get students error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Пригласить ученика в класс
router.post('/:id/invite', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        const { id } = req.params;
        const { email } = req.body;

        // Проверяем, что класс существует
        const classResult = await db.query(
            'SELECT * FROM classes WHERE id = $1 AND teacher_id = $2',
            [id, req.user.id]
        );

        if (classResult.rows.length === 0) {
            return res.status(404).json({ error: 'Класс не найден' });
        }

        // Находим ученика
        const studentResult = await db.query(
            "SELECT id, name FROM users WHERE email = $1 AND role = 'student'",
            [email]
        );

        if (studentResult.rows.length === 0) {
            return res.status(404).json({ error: 'Ученик не найден' });
        }

        const studentId = studentResult.rows[0].id;
        const className = classResult.rows[0].name;

        // Создаём приглашение
        await db.query(`
            INSERT INTO class_invitations (class_id, student_id, teacher_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (class_id, student_id) 
            DO UPDATE SET status = 'pending', updated_at = CURRENT_TIMESTAMP
        `, [id, studentId, req.user.id]);

        // Создаём уведомление
        await db.query(`
            INSERT INTO notifications (user_id, message, type)
            VALUES ($1, $2, 'class_invitation')
        `, [studentId, `Вас пригласили в класс "${className}"`]);

        // Создаём связь учитель-ученик если её нет
        await db.query(`
            INSERT INTO student_teacher_links (student_id, teacher_id, subject)
            VALUES ($1, $2, $3)
            ON CONFLICT (student_id, teacher_id, subject) DO NOTHING
        `, [studentId, req.user.id, classResult.rows[0].subject]);

        res.json({ message: 'Приглашение отправлено' });
    } catch (error) {
        console.error('Invite student error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Пригласить нескольких учеников
router.post('/:id/invite-bulk', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        const { id } = req.params;
        const { emails } = req.body; // массив email

        const classResult = await db.query(
            'SELECT * FROM classes WHERE id = $1 AND teacher_id = $2',
            [id, req.user.id]
        );

        if (classResult.rows.length === 0) {
            return res.status(404).json({ error: 'Класс не найден' });
        }

        const className = classResult.rows[0].name;
        const results = [];

        for (const email of emails) {
            try {
                const studentResult = await db.query(
                    "SELECT id FROM users WHERE email = $1 AND role = 'student'",
                    [email]
                );

                if (studentResult.rows.length > 0) {
                    const studentId = studentResult.rows[0].id;

                    await db.query(`
                        INSERT INTO class_invitations (class_id, student_id, teacher_id)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (class_id, student_id) 
                        DO UPDATE SET status = 'pending', updated_at = CURRENT_TIMESTAMP
                    `, [id, studentId, req.user.id]);

                    await db.query(`
                        INSERT INTO notifications (user_id, message, type)
                        VALUES ($1, $2, 'class_invitation')
                    `, [studentId, `Вас пригласили в класс "${className}"`]);

                    results.push({ email, status: 'sent' });
                } else {
                    results.push({ email, status: 'not_found' });
                }
            } catch (e) {
                results.push({ email, status: 'error' });
            }
        }

        res.json({ results });
    } catch (error) {
        console.error('Bulk invite error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Удалить ученика из класса
router.delete('/:classId/students/:studentId', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        const { classId, studentId } = req.params;

        await db.query(
            'DELETE FROM class_students WHERE class_id = $1 AND student_id = $2',
            [classId, studentId]
        );

        res.json({ message: 'Ученик удалён из класса' });
    } catch (error) {
        console.error('Remove student error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============== ПРИГЛАШЕНИЯ (ДЛЯ УЧЕНИКА) ==============

// Получить входящие приглашения
router.get('/invitations/incoming', authenticateToken, authorizeRole('student'), async (req, res) => {
    try {
        const result = await db.query(`
            SELECT ci.*, c.name as class_name, c.subject, u.name as teacher_name
            FROM class_invitations ci
            JOIN classes c ON ci.class_id = c.id
            JOIN users u ON ci.teacher_id = u.id
            WHERE ci.student_id = $1 AND ci.status = 'pending'
            ORDER BY ci.created_at DESC
        `, [req.user.id]);

        res.json(result.rows);
    } catch (error) {
        console.error('Get invitations error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Ответить на приглашение
router.patch('/invitations/:id', authenticateToken, authorizeRole('student'), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // 'accepted' или 'rejected'

        const invitationResult = await db.query(
            'SELECT * FROM class_invitations WHERE id = $1 AND student_id = $2',
            [id, req.user.id]
        );

        if (invitationResult.rows.length === 0) {
            return res.status(404).json({ error: 'Приглашение не найдено' });
        }

        const invitation = invitationResult.rows[0];

        await db.query(
            'UPDATE class_invitations SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [status, id]
        );

        if (status === 'accepted') {
            // Добавляем ученика в класс
            await db.query(`
                INSERT INTO class_students (class_id, student_id)
                VALUES ($1, $2)
                ON CONFLICT (class_id, student_id) DO NOTHING
            `, [invitation.class_id, req.user.id]);

            // Уведомляем учителя
            const classResult = await db.query(
                'SELECT name, teacher_id FROM classes WHERE id = $1',
                [invitation.class_id]
            );

            if (classResult.rows.length > 0) {
                await db.query(`
                    INSERT INTO notifications (user_id, message, type)
                    VALUES ($1, $2, 'class_joined')
                `, [classResult.rows[0].teacher_id,
                `Ученик ${req.user.name} присоединился к классу "${classResult.rows[0].name}"`]);
            }
        }

        res.json({ message: `Приглашение ${status === 'accepted' ? 'принято' : 'отклонено'}` });
    } catch (error) {
        console.error('Handle invitation error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============== ГРУППОВЫЕ ЗАДАНИЯ ==============

// Создать групповое задание
router.post('/:classId/assignments', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        const { classId } = req.params;
        const { title, description, subject, deadline, notifyBefore } = req.body;

        // Проверяем класс
        const classResult = await db.query(
            'SELECT * FROM classes WHERE id = $1 AND teacher_id = $2',
            [classId, req.user.id]
        );

        if (classResult.rows.length === 0) {
            return res.status(404).json({ error: 'Класс не найден' });
        }

        // Начинаем транзакцию
        await db.query('BEGIN');

        // Создаём задание
        const assignmentResult = await db.query(`
            INSERT INTO group_assignments (teacher_id, class_id, title, description, subject, deadline, notify_before)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [req.user.id, classId, title, description, subject, deadline, notifyBefore || '1 day']);

        const assignment = assignmentResult.rows[0];

        // Получаем всех учеников класса
        const studentsResult = await db.query(
            'SELECT student_id FROM class_students WHERE class_id = $1',
            [classId]
        );

        console.log(`Найдено ${studentsResult.rows.length} учеников в классе`);

        if (studentsResult.rows.length === 0) {
            // Если учеников нет - откатываем и возвращаем ошибку
            await db.query('ROLLBACK');
            return res.status(400).json({
                error: 'В классе нет учеников. Сначала добавьте учеников в класс.'
            });
        }
        // Назначаем задание каждому ученику
        for (const student of studentsResult.rows) {
            await db.query(`
                INSERT INTO group_assignment_targets (group_assignment_id, student_id)
                VALUES ($1, $2)
            `, [assignment.id, student.student_id]);

            // Создаём уведомление
            await db.query(`
                INSERT INTO notifications (user_id, message, type)
                VALUES ($1, $2, 'new_group_assignment')
            `, [student.student_id,
            `Новое задание в классе "${classResult.rows[0].name}": ${title}`]);
        }

        await db.query('COMMIT');

        res.status(201).json(assignment);
    } catch (error) {
        await db.query('ROLLBACK');
        console.error('Create group assignment error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Получить групповые задания класса
router.get('/:classId/assignments', authenticateToken, async (req, res) => {
    try {
        const { classId } = req.params;

        let query;
        let queryParams;

        if (req.user.role === 'teacher') {
            query = `
                SELECT ga.*, 
                       COUNT(DISTINCT gat.student_id) as total_students,
                       COUNT(DISTINCT CASE WHEN gat.status = 'submitted' THEN gat.student_id END) as submitted_count,
                       COUNT(DISTINCT CASE WHEN gat.status = 'graded' THEN gat.student_id END) as graded_count
                FROM group_assignments ga
                LEFT JOIN group_assignment_targets gat ON ga.id = gat.group_assignment_id
                WHERE ga.class_id = $1
                GROUP BY ga.id
                ORDER BY ga.deadline ASC
            `;
            queryParams = [classId];
        } else if (req.user.role === 'student') {
            query = `
                SELECT 
                    ga.id as group_assignment_id,
                    ga.title,
                    ga.description,
                    ga.subject,
                    ga.deadline,
                    ga.created_at,
                    gat.status,
                    gat.submitted_at,
                    gat.grade,
                    gat.feedback,
                    c.name as class_name
                FROM group_assignments ga
                JOIN group_assignment_targets gat ON ga.id = gat.group_assignment_id
                JOIN classes c ON ga.class_id = c.id
                WHERE ga.class_id = $1 AND gat.student_id = $2
                ORDER BY 
                    CASE WHEN gat.status = 'pending' AND ga.deadline < NOW() THEN 0
                         WHEN gat.status = 'pending' THEN 1
                         ELSE 2
                    END,
                    ga.deadline ASC
            `;
            queryParams = [classId, req.user.id];
        } else if (req.user.role === 'parent') {
            query = `
                SELECT 
                    ga.id as group_assignment_id,
                    ga.title,
                    ga.description,
                    ga.subject,
                    ga.deadline,
                    ga.created_at,
                    gat.status,
                    gat.submitted_at,
                    gat.grade,
                    gat.feedback,
                    c.name as class_name,
                    u.name as student_name
                FROM group_assignments ga
                JOIN group_assignment_targets gat ON ga.id = gat.group_assignment_id
                JOIN classes c ON ga.class_id = c.id
                JOIN users u ON gat.student_id = u.id
                JOIN parent_student_links psl ON u.id = psl.student_id
                WHERE ga.class_id = $1 AND psl.parent_id = $2
                ORDER BY ga.deadline ASC
            `;
            queryParams = [classId, req.user.id];
        } else {
            return res.status(403).json({ error: 'Access denied' });
        }

        console.log(`Executing query with params:`, queryParams);
        const result = await db.query(query, queryParams);
        console.log(`Found ${result.rows.length} assignments for ${req.user.role} in class ${classId}`);

        res.json(result.rows);
    } catch (error) {
        console.error('Get assignments error:', error);
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});
// ============== УВЕДОМЛЕНИЯ О ДЕДЛАЙНАХ ==============

// Ручная отправка напоминания
router.post('/assignments/:assignmentId/remind', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const { studentId, message } = req.body;

        // Проверяем, что задание принадлежит учителю
        const assignmentResult = await db.query(`
            SELECT ga.*, c.name as class_name
            FROM group_assignments ga
            JOIN classes c ON ga.class_id = c.id
            WHERE ga.id = $1 AND ga.teacher_id = $2
        `, [assignmentId, req.user.id]);

        if (assignmentResult.rows.length === 0) {
            return res.status(404).json({ error: 'Задание не найдено' });
        }

        const assignment = assignmentResult.rows[0];

        // Создаём уведомление
        await db.query(`
            INSERT INTO notifications (user_id, message, type)
            VALUES ($1, $2, 'deadline_reminder')
        `, [studentId, message ||
            `Напоминание: задание "${assignment.title}" нужно сдать до ${new Date(assignment.deadline).toLocaleString('ru')}`]);

        // Записываем напоминание
        await db.query(`
            INSERT INTO deadline_reminders (assignment_id, assignment_type, student_id, reminder_type)
            VALUES ($1, 'group', $2, 'manual')
        `, [assignmentId, studentId]);

        res.json({ message: 'Напоминание отправлено' });
    } catch (error) {
        console.error('Send reminder error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Массовое напоминание всем должникам
router.post('/assignments/:assignmentId/remind-all', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        const { assignmentId } = req.params;

        // Находим всех учеников с непросроченными, но невыполненными заданиями
        const studentsResult = await db.query(`
            SELECT gat.student_id, u.name, ga.title, ga.deadline
            FROM group_assignment_targets gat
            JOIN users u ON gat.student_id = u.id
            JOIN group_assignments ga ON gat.group_assignment_id = ga.id
            WHERE ga.id = $1 
              AND gat.status = 'pending'
              AND ga.teacher_id = $2
        `, [assignmentId, req.user.id]);

        let count = 0;
        for (const student of studentsResult.rows) {
            await db.query(`
                INSERT INTO notifications (user_id, message, type)
                VALUES ($1, $2, 'deadline_reminder')
            `, [student.student_id,
            `⏰ Напоминание: задание "${student.title}" нужно сдать до ${new Date(student.deadline).toLocaleString('ru')}`]);

            await db.query(`
                INSERT INTO deadline_reminders (assignment_id, assignment_type, student_id, reminder_type)
                VALUES ($1, 'group', $2, 'manual')
            `, [assignmentId, student.student_id]);

            count++;
        }

        res.json({ message: `Отправлено ${count} напоминаний` });
    } catch (error) {
        console.error('Remind all error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Получить просроченные задания (для учителя)
router.get('/overdue', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                ga.id, ga.title, ga.subject, ga.deadline, c.name as class_name,
                COUNT(DISTINCT gat.student_id) as overdue_count,
                array_agg(DISTINCT u.name) as student_names
            FROM group_assignments ga
            JOIN classes c ON ga.class_id = c.id
            JOIN group_assignment_targets gat ON ga.id = gat.group_assignment_id
            JOIN users u ON gat.student_id = u.id
            WHERE ga.teacher_id = $1 
              AND gat.status = 'pending' 
              AND ga.deadline < NOW()
            GROUP BY ga.id, ga.title, ga.subject, ga.deadline, c.name
            ORDER BY ga.deadline ASC
        `, [req.user.id]);

        res.json(result.rows);
    } catch (error) {
        console.error('Get overdue error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Отметить групповое задание как выполненное (для ученика)
// Отметить групповое задание как выполненное
router.patch('/assignments/:assignmentId/submit', authenticateToken, authorizeRole('student'), async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const studentId = req.user.id;

        // Парсим ID
        const groupAssignmentId = parseInt(assignmentId);

        console.log('=== SUBMIT GROUP ASSIGNMENT ===');
        console.log('Raw assignmentId:', assignmentId);
        console.log('Parsed groupAssignmentId:', groupAssignmentId);
        console.log('Student ID:', studentId);

        if (isNaN(groupAssignmentId)) {
            return res.status(400).json({ error: 'Invalid assignment ID' });
        }

        // Проверяем, что задание назначено этому ученику
        const checkResult = await db.query(`
            SELECT gat.*, ga.title, ga.subject, ga.teacher_id, ga.deadline, c.name as class_name
            FROM group_assignment_targets gat
            JOIN group_assignments ga ON gat.group_assignment_id = ga.id
            JOIN classes c ON ga.class_id = c.id
            WHERE gat.group_assignment_id = $1 AND gat.student_id = $2
        `, [groupAssignmentId, studentId]);

        if (checkResult.rows.length === 0) {
            console.log('Group assignment not found');
            return res.status(404).json({ error: 'Задание не найдено' });
        }

        const assignment = checkResult.rows[0];
        console.log('Found group assignment:', assignment.title);

        // Определяем статус
        let status = 'submitted';
        if (new Date(assignment.deadline) < new Date()) {
            status = 'overdue';
            console.log('Assignment is overdue');
        }

        // Обновляем статус
        await db.query(`
            UPDATE group_assignment_targets 
            SET status = $1, submitted_at = NOW()
            WHERE group_assignment_id = $2 AND student_id = $3
        `, [status, groupAssignmentId, studentId]);

        // Уведомляем учителя
        await db.query(`
            INSERT INTO notifications (user_id, message, type)
            VALUES ($1, $2, $3)
        `, [
            assignment.teacher_id,
            `✅ Ученик сдал задание "${assignment.title}" в классе "${assignment.class_name}"`,
            'submission'
        ]);

        console.log('Group assignment submitted successfully');
        res.json({ message: 'Задание отмечено как выполненное', status });
    } catch (error) {
        console.error('Submit group assignment error:', error);
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});

module.exports = router;