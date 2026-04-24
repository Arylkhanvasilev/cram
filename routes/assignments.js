const express = require('express');
const db = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

// ПОЛУЧИТЬ ЗАДАНИЯ
router.get('/', authenticateToken, async (req, res) => {
    try {
        let query;
        let params = [];

        if (req.user.role === 'student') {
            query = `
        SELECT 
            a.id,
            a.title,
            a.description,
            a.subject,
            a.deadline,
            a.created_at,
            a.teacher_id,
            COALESCE(at.status, 'pending') as status,
            at.submitted_at, 
            at.grade, 
            at.feedback
        FROM assignments a
        JOIN assignment_targets at ON a.id = at.assignment_id AND at.student_id = $1
        ORDER BY a.created_at DESC
    `;
            params = [req.user.id];
        } else if (req.user.role === 'teacher') {
            query = `
        SELECT 
            a.*,
            COUNT(DISTINCT at.student_id) as total_students,
            COUNT(DISTINCT CASE WHEN at.status = 'submitted' OR at.status = 'graded' THEN at.student_id END) as completed_count,
            COUNT(DISTINCT CASE WHEN at.status = 'pending' AND a.deadline < NOW() THEN at.student_id END) as overdue_count,
            COALESCE(json_agg(
                json_build_object(
                    'student_id', u.id,
                    'student_name', u.name,
                    'status', at.status,
                    'submitted_at', at.submitted_at,
                    'grade', at.grade
                )
            ) FILTER (WHERE u.id IS NOT NULL), '[]') as students
        FROM assignments a
        LEFT JOIN assignment_targets at ON a.id = at.assignment_id
        LEFT JOIN users u ON at.student_id = u.id
        WHERE a.teacher_id = $1
        GROUP BY a.id
        ORDER BY a.created_at DESC
    `;
            params = [req.user.id];
        } else if (req.user.role === 'parent') {
            query = `
                SELECT a.*, at.status, at.submitted_at, at.grade, 
                       u.name as student_name
                FROM assignments a
                JOIN assignment_targets at ON a.id = at.assignment_id
                JOIN users u ON at.student_id = u.id
                JOIN parent_student_links psl ON u.id = psl.student_id
                WHERE psl.parent_id = $1
                ORDER BY a.created_at DESC
            `;
            params = [req.user.id];
        }

        const result = await db.query(query, params);
        // В функции GET '/' перед res.json(result.rows) добавьте:
        console.log('RAW ROWS FROM DB:', result.rows.map(r => ({ id: r.id, status: r.status })));
        res.json(result.rows);
    } catch (error) {
        console.error('Get assignments error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// СОЗДАТЬ ЗАДАНИЕ
router.post('/', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        const { title, description, subject, deadline, studentIds } = req.body;

        await db.query('BEGIN');

        // Создаём задание
        const result = await db.query(
            `INSERT INTO assignments (teacher_id, title, description, subject, deadline) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [req.user.id, title, description, subject, deadline]
        );

        const assignment = result.rows[0];

        // Назначаем ученикам со статусом 'pending'
        const ids = studentIds && studentIds.length > 0 ? studentIds : [2];

        for (const studentId of ids) {
            await db.query(
                `INSERT INTO assignment_targets (assignment_id, student_id, status) 
         VALUES ($1, $2, 'pending')
         ON CONFLICT (assignment_id, student_id) 
         DO UPDATE SET status = 'pending'`,
                [assignment.id, studentId]
            );

            // Создаём уведомление ученику
            await db.query(
                `INSERT INTO notifications (user_id, message, type) 
         VALUES ($1, $2, 'new_assignment')`,
                [studentId, `📝 Новое задание: "${title}"`]
            );
        }
        await db.query('COMMIT');

        // Возвращаем со статусом pending
        assignment.status = 'pending';
        res.status(201).json(assignment);

    } catch (error) {
        await db.query('ROLLBACK');
        console.error('Create assignment error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ОБНОВИТЬ СТАТУС
router.patch('/:id/status', authenticateToken, authorizeRole('student'), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        await db.query(
            `UPDATE assignment_targets 
             SET status = $1, submitted_at = NOW()
             WHERE assignment_id = $2 AND student_id = $3`,
            [status, id, req.user.id]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Update status error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Получить классы учителя (для выбора при создании задания)
router.get('/teacher-classes', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        const result = await db.query(`
            SELECT c.id, c.name, c.subject, c.grade,
                   COUNT(cs.student_id) as student_count
            FROM classes c
            LEFT JOIN class_students cs ON c.id = cs.class_id
            WHERE c.teacher_id = $1
            GROUP BY c.id
            ORDER BY c.name
        `, [req.user.id]);

        res.json(result.rows);
    } catch (error) {
        console.error('Get teacher classes error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Получить учеников класса
router.get('/class-students/:classId', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        const result = await db.query(`
            SELECT u.id, u.name, u.email, u.grade
            FROM class_students cs
            JOIN users u ON cs.student_id = u.id
            WHERE cs.class_id = $1
            ORDER BY u.name
        `, [req.params.classId]);

        res.json(result.rows);
    } catch (error) {
        console.error('Get class students error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Создать задание для класса (учитель)
router.post('/for-class', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        const { title, description, subject, deadline, classIds } = req.body;

        if (!classIds || classIds.length === 0) {
            return res.status(400).json({ error: 'Выберите хотя бы один класс' });
        }

        await db.query('BEGIN');

        // Создаём задание
        const assignmentResult = await db.query(`
            INSERT INTO assignments (teacher_id, title, description, subject, deadline)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [req.user.id, title, description, subject, deadline]);

        const assignment = assignmentResult.rows[0];
        let totalStudents = 0;

        // Получаем учеников из выбранных классов
        for (const classId of classIds) {
            const studentsResult = await db.query(`
                SELECT student_id FROM class_students WHERE class_id = $1
            `, [classId]);

            for (const student of studentsResult.rows) {
                await db.query(`
                    INSERT INTO assignment_targets (assignment_id, student_id, status)
                    VALUES ($1, $2, 'pending')
                    ON CONFLICT (assignment_id, student_id) DO NOTHING
                `, [assignment.id, student.student_id]);

                // Уведомление
                await db.query(`
                    INSERT INTO notifications (user_id, message, type)
                    VALUES ($1, $2, 'new_assignment')
                `, [student.student_id, `📝 Новое задание: "${title}"`]);

                totalStudents++;
            }
        }

        await db.query('COMMIT');

        res.status(201).json({
            ...assignment,
            status: 'pending',
            totalStudents
        });
    } catch (error) {
        await db.query('ROLLBACK');
        console.error('Create for class error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;