const express = require('express');
const db = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

// Get assignments for current user
router.get('/', authenticateToken, async (req, res) => {
    try {
        let query;
        let params = [];

        if (req.user.role === 'teacher') {
            query = `
                SELECT a.*, 
                       COUNT(DISTINCT at.student_id) as total_students,
                       COUNT(DISTINCT CASE WHEN at.status = 'submitted' THEN at.student_id END) as submitted_count
                FROM assignments a
                LEFT JOIN assignment_targets at ON a.id = at.assignment_id
                WHERE a.teacher_id = $1
                GROUP BY a.id
                ORDER BY a.deadline ASC
            `;
            params = [req.user.id];
        } else if (req.user.role === 'student') {
            query = `
        SELECT 
            a.id, 
            a.title,
            a.description,
            a.subject,
            a.deadline,
            a.created_at,
            at.status, 
            at.submitted_at, 
            at.grade, 
            at.feedback
        FROM assignments a
        JOIN assignment_targets at ON a.id = at.assignment_id
        WHERE at.student_id = $1
        ORDER BY 
            CASE WHEN at.status = 'pending' AND a.deadline < NOW() THEN 0
                 WHEN at.status = 'pending' THEN 1
                 ELSE 2
            END,
            a.deadline ASC
    `;
            params = [req.user.id];
        } else if (req.user.role === 'parent') {
            query = `
                SELECT a.*, at.status, at.submitted_at, at.grade, 
                       u.name as student_name, u.id as student_id
                FROM assignments a
                JOIN assignment_targets at ON a.id = at.assignment_id
                JOIN users u ON at.student_id = u.id
                JOIN parent_student_links psl ON u.id = psl.student_id
                WHERE psl.parent_id = $1
                ORDER BY a.deadline ASC
            `;
            params = [req.user.id];
        }

        const result = await db.query(query, params);
        console.log(`Found ${result.rows.length} assignments for ${req.user.role}`);
        console.log('Assignment IDs:', result.rows.map(r => ({ id: r.id, title: r.title })));
        res.json(result.rows);
    } catch (error) {
        console.error('Get assignments error:', error);
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});

// Создать задание (для учителя)
router.post('/', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        const { title, description, subject, deadline, studentIds } = req.body;

        // Проверяем обязательные поля
        if (!title || !subject || !deadline) {
            return res.status(400).json({ error: 'Название, предмет и дедлайн обязательны' });
        }

        // Проверяем, что есть ученики
        if (!studentIds || studentIds.length === 0) {
            return res.status(400).json({ error: 'Выберите хотя бы одного ученика' });
        }

        console.log(`Учитель ${req.user.id} создаёт задание для ${studentIds.length} учеников`);

        // Начинаем транзакцию
        await db.query('BEGIN');

        // Создаём задание
        const assignmentResult = await db.query(`
            INSERT INTO assignments (teacher_id, title, description, subject, deadline) 
            VALUES ($1, $2, $3, $4, $5) 
            RETURNING *
        `, [req.user.id, title, description, subject, deadline]);

        const assignment = assignmentResult.rows[0];
        console.log('Создано задание:', assignment.id);

        // Назначаем задание выбранным ученикам
        let assignedCount = 0;
        for (const studentId of studentIds) {
            await db.query(`
                INSERT INTO assignment_targets (assignment_id, student_id, status) 
                VALUES ($1, $2, 'pending')
                ON CONFLICT (assignment_id, student_id) DO NOTHING
            `, [assignment.id, studentId]);

            // Создаём уведомление для ученика
            await db.query(`
                INSERT INTO notifications (user_id, message, type) 
                VALUES ($1, $2, 'new_assignment')
            `, [studentId, `📝 Новое задание: "${title}" по предмету ${subject}`]);

            // Уведомляем родителей ученика
            const parentsResult = await db.query(`
                SELECT parent_id FROM parent_student_links WHERE student_id = $1
            `, [studentId]);

            for (const parent of parentsResult.rows) {
                await db.query(`
                    INSERT INTO notifications (user_id, message, type) 
                    VALUES ($1, $2, 'parent_notification')
                `, [parent.parent_id, `👨‍👦 Новое задание для вашего ребёнка: "${title}"`]);
            }

            assignedCount++;
        }

        await db.query('COMMIT');

        console.log(`Задание назначено ${assignedCount} ученикам`);

        res.status(201).json({
            ...assignment,
            assignedCount
        });
    } catch (error) {
        await db.query('ROLLBACK');
        console.error('Create assignment error:', error);
        res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
    }
});

// Получить список всех учеников (для учителя)
router.get('/students', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                u.id, 
                u.name, 
                u.email, 
                u.grade,
                COUNT(DISTINCT a.id) as total_assignments,
                COUNT(DISTINCT CASE WHEN at.status = 'submitted' THEN a.id END) as completed_assignments
            FROM users u
            LEFT JOIN assignment_targets at ON u.id = at.student_id
            LEFT JOIN assignments a ON at.assignment_id = a.id
            WHERE u.role = 'student'
            GROUP BY u.id, u.name, u.email, u.grade
            ORDER BY u.grade, u.name
        `);

        res.json(result.rows);
    } catch (error) {
        console.error('Get students error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Получить учеников учителя (через классы или прямые связи)
router.get('/my-students', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        // Получаем учеников из классов учителя + прямые связи
        const result = await db.query(`
            SELECT DISTINCT 
                u.id, 
                u.name, 
                u.email, 
                u.grade,
                c.name as class_name
            FROM users u
            LEFT JOIN class_students cs ON u.id = cs.student_id
            LEFT JOIN classes c ON cs.class_id = c.id
            LEFT JOIN student_teacher_links stl ON u.id = stl.student_id
            WHERE u.role = 'student' 
              AND (c.teacher_id = $1 OR stl.teacher_id = $1)
            ORDER BY u.grade, u.name
        `, [req.user.id]);

        res.json(result.rows);
    } catch (error) {
        console.error('Get my students error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update assignment status (student)
router.patch('/:id/status', authenticateToken, authorizeRole('student'), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const assignmentId = parseInt(id);

        console.log('=== UPDATE STATUS ===');
        console.log('Raw id from params:', id);
        console.log('Parsed assignmentId:', assignmentId);
        console.log('Status:', status);
        console.log('Student ID:', req.user.id);

        if (isNaN(assignmentId)) {
            console.error('Invalid assignment ID:', id);
            return res.status(400).json({ error: 'Invalid assignment ID' });
        }

        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }

        // Проверяем, существует ли задание и назначено ли оно ученику
        const checkResult = await db.query(`
            SELECT at.*, a.title, a.subject, a.teacher_id, a.deadline
            FROM assignment_targets at
            JOIN assignments a ON at.assignment_id = a.id
            WHERE at.assignment_id = $1 AND at.student_id = $2
        `, [assignmentId, req.user.id]);

        if (checkResult.rows.length === 0) {
            console.log('Assignment not found for this student');
            return res.status(404).json({ error: 'Assignment not found or not assigned to you' });
        }

        const assignment = checkResult.rows[0];
        console.log('Found assignment:', assignment.title);

        // Определяем, просрочено ли задание
        let finalStatus = status;
        if (status === 'submitted' && new Date(assignment.deadline) < new Date()) {
            finalStatus = 'overdue';
            console.log('Assignment is overdue, setting status to:', finalStatus);
        }

        // Обновляем статус
        const result = await db.query(`
            UPDATE assignment_targets 
            SET status = $1, submitted_at = NOW()
            WHERE assignment_id = $2 AND student_id = $3
            RETURNING *
        `, [finalStatus, assignmentId, req.user.id]);

        console.log('Status updated successfully');

        // Уведомляем учителя
        await db.query(`
            INSERT INTO notifications (user_id, message, type)
            VALUES ($1, $2, $3)
        `, [
            assignment.teacher_id,
            `✅ Ученик сдал задание: ${assignment.title}`,
            'submission'
        ]);

        // Обновляем прогресс ученика
        await db.query(`
            INSERT INTO progress (student_id, subject, completed_tasks, total_tasks)
            VALUES ($1, $2, 1, 1)
            ON CONFLICT (student_id, subject) 
            DO UPDATE SET 
                completed_tasks = progress.completed_tasks + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE progress.subject = $2
        `, [req.user.id, assignment.subject || 'Общий']);

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Update status error:', error);
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});

// Get progress
router.get('/progress', authenticateToken, async (req, res) => {
    try {
        let query;
        let params = [];

        if (req.user.role === 'student') {
            query = `
                SELECT 
                    subject,
                    completed_tasks,
                    total_tasks,
                    ROUND((completed_tasks::float / NULLIF(total_tasks, 0) * 100)::numeric, 1) as percentage,
                    average_grade
                FROM progress
                WHERE student_id = $1
            `;
            params = [req.user.id];
        } else if (req.user.role === 'parent') {
            query = `
                SELECT 
                    p.*,
                    u.name as student_name
                FROM progress p
                JOIN users u ON p.student_id = u.id
                JOIN parent_student_links psl ON u.id = psl.student_id
                WHERE psl.parent_id = $1
            `;
            params = [req.user.id];
        } else {
            return res.json([]);
        }

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Get progress error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get notifications
router.get('/notifications', authenticateToken, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, message, type, is_read, created_at 
             FROM notifications 
             WHERE user_id = $1 
             ORDER BY created_at DESC 
             LIMIT 50`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Mark notification as read
router.patch('/notifications/:id/read', authenticateToken, async (req, res) => {
    try {
        const result = await db.query(
            `UPDATE notifications SET is_read = true 
             WHERE id = $1 AND user_id = $2
             RETURNING *`,
            [req.params.id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Update notification error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/group/:classId', authenticateToken, async (req, res) => {
    try {
        const { classId } = req.params;
        const result = await db.query(`
            SELECT ga.*, a.title, a.subject, a.deadline,
                   COUNT(gat.student_id) as submitted_count
            FROM group_assignments ga
            JOIN assignments a ON ga.group_assignment_id = a.id
            WHERE ga.class_id = $1
        `, [classId]);
        res.json(result.rows);
    } catch (error) {
        console.error('Get group assignments error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;