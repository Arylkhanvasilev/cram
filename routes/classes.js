const express = require('express');
const db = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const router = express.Router();

// ===== УПРАВЛЕНИЕ КЛАССАМИ =====

router.get('/', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        const result = await db.query(`
            SELECT c.*, COUNT(DISTINCT cs.student_id) as student_count
            FROM classes c
            LEFT JOIN class_students cs ON c.id = cs.class_id
            WHERE c.teacher_id = $1
            GROUP BY c.id
            ORDER BY c.created_at DESC
        `, [req.user.id]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

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
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        const { name, description, subject, grade } = req.body;
        const result = await db.query(`
            INSERT INTO classes (name, description, teacher_id, subject, grade)
            VALUES ($1, $2, $3, $4, $5) RETURNING *
        `, [name, description, req.user.id, subject, grade]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== УЧЕНИКИ =====

router.get('/my-students', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        const result = await db.query(`
            SELECT DISTINCT u.id, u.name, u.email, u.grade
            FROM users u
            JOIN student_teacher_links stl ON u.id = stl.student_id
            WHERE stl.teacher_id = $1 AND u.role = 'student'
            ORDER BY u.name
        `, [req.user.id]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/add-student', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        const { email, subject } = req.body;

        const student = await db.query(
            "SELECT id, name FROM users WHERE email = $1 AND role = 'student'",
            [email]
        );

        if (!student.rows.length) {
            return res.status(404).json({ error: 'Ученик не найден' });
        }

        const studentId = student.rows[0].id;
        const subj = subject || 'Общий';

        // Связь
        await db.query(`
            INSERT INTO student_teacher_links (student_id, teacher_id, subject)
            VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
        `, [studentId, req.user.id, subj]);

        // Класс
        const classResult = await db.query(
            'SELECT id FROM classes WHERE teacher_id = $1 AND subject = $2 LIMIT 1',
            [req.user.id, subj]
        );

        let classId;
        if (classResult.rows.length > 0) {
            classId = classResult.rows[0].id;
        } else {
            const newClass = await db.query(
                "INSERT INTO classes (name, teacher_id, subject) VALUES ($1, $2, $3) RETURNING id",
                [subj + ' класс', req.user.id, subj]
            );
            classId = newClass.rows[0].id;
        }

        await db.query(`
            INSERT INTO class_students (class_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING
        `, [classId, studentId]);

        await db.query(`
            INSERT INTO notifications (user_id, message, type) VALUES ($1, $2, 'teacher_added')
        `, [studentId, 'Учитель добавил вас в класс']);

        res.json({ success: true, student: student.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.delete('/remove-student/:studentId', authenticateToken, authorizeRole('teacher'), async (req, res) => {
    try {
        await db.query(
            'DELETE FROM student_teacher_links WHERE student_id = $1 AND teacher_id = $2',
            [req.params.studentId, req.user.id]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== ЗАПРОСЫ =====

router.post('/join-request', authenticateToken, authorizeRole('student'), async (req, res) => {
    try {
        const { teacherEmail, subject } = req.body;

        const teacher = await db.query(
            "SELECT id, name FROM users WHERE email = $1 AND role = 'teacher'",
            [teacherEmail]
        );

        if (!teacher.rows.length) {
            return res.status(404).json({ error: 'Учитель не найден' });
        }

        await db.query(`
            INSERT INTO connection_requests (from_user_id, to_user_id, request_type, message)
            VALUES ($1, $2, 'student_join', $3)
            ON CONFLICT (from_user_id, to_user_id, request_type) 
            DO UPDATE SET status = 'pending', message = $3, updated_at = NOW()
        `, [req.user.id, teacher.rows[0].id, subject || 'Хочу в класс']);

        await db.query(`
            INSERT INTO notifications (user_id, message, type) VALUES ($1, $2, 'join_request')
        `, [teacher.rows[0].id, `Ученик ${req.user.name} хочет вступить в класс`]);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/incoming-requests', authenticateToken, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT cr.id, cr.message, cr.status, cr.created_at,
                   u.id as from_user_id, u.name as from_user_name, u.email as from_user_email, u.grade
            FROM connection_requests cr
            JOIN users u ON cr.from_user_id = u.id
            WHERE cr.to_user_id = $1 AND cr.status = 'pending'
            ORDER BY cr.created_at DESC
        `, [req.user.id]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.patch('/handle-request/:id', authenticateToken, async (req, res) => {
    try {
        const { status } = req.body;

        const request = await db.query(
            'SELECT * FROM connection_requests WHERE id = $1 AND to_user_id = $2',
            [req.params.id, req.user.id]
        );

        if (!request.rows.length) {
            return res.status(404).json({ error: 'Запрос не найден' });
        }

        const reqData = request.rows[0];

        await db.query(
            'UPDATE connection_requests SET status = $1, updated_at = NOW() WHERE id = $2',
            [status, req.params.id]
        );

        if (status === 'accepted') {
            const subj = reqData.message || 'Общий';

            await db.query(`
                INSERT INTO student_teacher_links (student_id, teacher_id, subject)
                VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
            `, [reqData.from_user_id, req.user.id, subj]);

            const classResult = await db.query(
                'SELECT id FROM classes WHERE teacher_id = $1 AND subject = $2 LIMIT 1',
                [req.user.id, subj]
            );

            let classId;
            if (classResult.rows.length > 0) {
                classId = classResult.rows[0].id;
            } else {
                const newClass = await db.query(
                    "INSERT INTO classes (name, teacher_id, subject) VALUES ($1, $2, $3) RETURNING id",
                    [subj + ' класс', req.user.id, subj]
                );
                classId = newClass.rows[0].id;
            }

            await db.query(`
                INSERT INTO class_students (class_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING
            `, [classId, reqData.from_user_id]);

            await db.query(`
                INSERT INTO notifications (user_id, message, type) VALUES ($1, $2, 'request_accepted')
            `, [reqData.from_user_id, 'Запрос принят!']);
        } else {
            await db.query(`
                INSERT INTO notifications (user_id, message, type) VALUES ($1, $2, 'request_rejected')
            `, [reqData.from_user_id, 'Запрос отклонён']);
        }

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/my-requests', authenticateToken, authorizeRole('student'), async (req, res) => {
    try {
        const result = await db.query(`
            SELECT cr.id, cr.message, cr.status, cr.created_at,
                   u.name as teacher_name, u.email as teacher_email
            FROM connection_requests cr
            JOIN users u ON cr.to_user_id = u.id
            WHERE cr.from_user_id = $1 AND cr.request_type = 'student_join'
            ORDER BY cr.created_at DESC
        `, [req.user.id]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;