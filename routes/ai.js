const express = require('express');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get AI insights and recommendations
router.post('/insights', authenticateToken, async (req, res) => {
    try {
        const { tasks, progress } = req.body;
        
        // AI logic for generating insights
        const insights = generateInsights(req.user, tasks, progress);
        
        res.json(insights);
    } catch (error) {
        console.error('AI insights error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Generate insights based on user role and data
function generateInsights(user, tasks, progress) {
    const now = new Date();
    
    if (user.role === 'student') {
        const pendingTasks = tasks.filter(t => t.status === 'pending');
        const overdueTasks = pendingTasks.filter(t => new Date(t.deadline) < now);
        const upcomingTasks = pendingTasks.filter(t => new Date(t.deadline) > now);
        
        const totalProgress = progress.length > 0 
            ? progress.reduce((sum, p) => sum + parseFloat(p.percentage || 0), 0) / progress.length 
            : 0;
        
        let motivation = '';
        let suggestions = [];
        
        if (totalProgress >= 80) {
            motivation = 'Отличная работа! Ты на верном пути к успеху!';
            suggestions.push('Продолжай в том же духе');
            suggestions.push('Помоги одноклассникам, если у них есть вопросы');
        } else if (totalProgress >= 50) {
            motivation = 'Хороший прогресс! Ещё немного усилий и будет отличный результат!';
            suggestions.push('Сосредоточься на сложных темах');
            suggestions.push('Планируй время на повторение');
        } else {
            motivation = 'Не сдавайся! Каждый шаг приближает тебя к цели!';
            suggestions.push('Начни с самого простого задания');
            suggestions.push('Разбей большие задачи на маленькие шаги');
            suggestions.push('Попроси помощи у учителя или одноклассников');
        }
        
        if (overdueTasks.length > 0) {
            suggestions.unshift(`У тебя ${overdueTasks.length} просроченных заданий. Сделай их в первую очередь!`);
        }
        
        if (upcomingTasks.length > 0) {
            const nextTask = upcomingTasks.sort((a, b) => new Date(a.deadline) - new Date(b.deadline))[0];
            suggestions.push(`Следующий дедлайн: ${nextTask.title} - ${new Date(nextTask.deadline).toLocaleString('ru')}`);
        }
        
        return {
            motivation,
            suggestions: suggestions.slice(0, 5),
            priority_tasks: overdueTasks.map(t => t.id).concat(upcomingTasks.map(t => t.id)).slice(0, 5),
            progress_percentage: Math.round(totalProgress)
        };
    }
    
    if (user.role === 'teacher') {
        const totalStudents = progress.length;
        const avgProgress = totalStudents > 0 
            ? progress.reduce((sum, p) => sum + parseFloat(p.percentage || 0), 0) / totalStudents 
            : 0;
        
        const pendingGrading = tasks.filter(t => t.status === 'submitted').length;
        
        let suggestions = [];
        
        if (pendingGrading > 0) {
            suggestions.push(`У вас ${pendingGrading} работ ожидают проверки`);
        }
        
        if (avgProgress < 50) {
            suggestions.push('Классу нужна дополнительная поддержка по текущей теме');
            suggestions.push('Рассмотрите возможность дополнительных консультаций');
        } else if (avgProgress > 80) {
            suggestions.push('Отличные результаты класса!');
            suggestions.push('Можно переходить к более сложным темам');
        }
        
        return {
            message: `Средний прогресс класса: ${Math.round(avgProgress)}%`,
            suggestions,
            pending_grading: pendingGrading,
            class_performance: progress
        };
    }
    
    if (user.role === 'parent') {
        const childrenProgress = progress;
        
        let message = '';
        let suggestions = [];
        
        childrenProgress.forEach(child => {
            const childProgress = parseFloat(child.percentage || 0);
            if (childProgress < 50) {
                message += `${child.student_name} нуждается в дополнительной поддержке. `;
                suggestions.push(`Помогите ${child.student_name} организовать учебное время`);
            } else if (childProgress > 80) {
                message += `${child.student_name} отлично справляется! `;
                suggestions.push(`Поощрите успехи ${child.student_name}`);
            }
        });
        
        const overdueTasks = tasks.filter(t => t.status === 'pending' && new Date(t.deadline) < now);
        if (overdueTasks.length > 0) {
            suggestions.push(`Есть просроченные задания. Проверьте, всё ли в порядке.`);
        }
        
        return {
            message: message || 'Ваши дети успешно справляются с учёбой',
            suggestions,
            children_progress: childrenProgress,
            overdue_tasks: overdueTasks.length
        };
    }
    
    return {
        message: 'Нет данных для анализа',
        suggestions: []
    };
}

module.exports = router;