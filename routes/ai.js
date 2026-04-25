const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../config/database');
const router = express.Router();

let ollama;
try {
    const { Ollama } = require('ollama');
    ollama = new Ollama({ host: 'http://localhost:11434' });
} catch (e) {
    console.log('Ollama не установлен');
}

// ===== ДИАЛОГИ =====

// Получить все диалоги пользователя
router.get('/conversations', authenticateToken, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT id, title, created_at, updated_at FROM chat_conversations WHERE user_id = $1 ORDER BY updated_at DESC',
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

// Создать новый диалог
router.post('/conversations', authenticateToken, async (req, res) => {
    try {
        const result = await db.query(
            'INSERT INTO chat_conversations (user_id, title) VALUES ($1, $2) RETURNING *',
            [req.user.id, 'Новый диалог']
        );
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

// Удалить диалог
router.delete('/conversations/:id', authenticateToken, async (req, res) => {
    try {
        await db.query(
            'DELETE FROM chat_conversations WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

// ===== СООБЩЕНИЯ =====

// Получить сообщения диалога
router.get('/conversations/:id/messages', authenticateToken, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT role, content, created_at FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
            [req.params.id]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

// ===== ОТПРАВИТЬ СООБЩЕНИЕ =====
router.post('/chat', authenticateToken, async (req, res) => {
    try {
        const { message, conversationId } = req.body;
        let convId = conversationId;

        // Если нет диалога — создаём
        if (!convId) {
            const convResult = await db.query(
                'INSERT INTO chat_conversations (user_id, title) VALUES ($1, $2) RETURNING id',
                [req.user.id, message.substring(0, 50) + '...']
            );
            convId = convResult.rows[0].id;
        }

        // Сохраняем сообщение пользователя
        await db.query(
            'INSERT INTO chat_messages (conversation_id, role, content) VALUES ($1, $2, $3)',
            [convId, 'user', message]
        );

        // Получаем историю для контекста
        const historyResult = await db.query(
            'SELECT role, content FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 10',
            [convId]
        );

        // Формируем сообщения для AI
        const messages = [
            { role: 'system', content: 'Ты — AI-помощник Cram. Отвечай на русском языке, кратко и полезно.' },
            ...historyResult.rows.map(m => ({ role: m.role, content: m.content }))
        ];

        if (ollama) {
            const response = await ollama.chat({
                model: 'qwen2.5:3b',
                messages: messages,
                options: { temperature: 0.7, num_predict: 200 }
            });

            const reply = response.message.content;

            // Сохраняем ответ AI
            await db.query(
                'INSERT INTO chat_messages (conversation_id, role, content) VALUES ($1, $2, $3)',
                [convId, 'assistant', reply]
            );

            // Обновляем заголовок (первое сообщение пользователя)
            await db.query(
                'UPDATE chat_conversations SET title = $1, updated_at = NOW() WHERE id = $2',
                [message.substring(0, 50), convId]
            );

            res.json({ reply, conversationId: convId });
        } else {
            res.json({ reply: 'Ollama не запущена', conversationId: convId });
        }
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: 'Ошибка чата' });
    }
});

// Обновить заголовок диалога
router.patch('/conversations/:id', authenticateToken, async (req, res) => {
    try {
        await db.query(
            'UPDATE chat_conversations SET title = $1 WHERE id = $2 AND user_id = $3',
            [req.body.title, req.params.id, req.user.id]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

module.exports = router;