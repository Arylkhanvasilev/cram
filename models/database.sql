-- Create database
CREATE DATABASE eduflow;

-- Connect to database
\c eduflow;

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) CHECK (role IN ('teacher', 'student', 'parent')) NOT NULL,
    grade INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Parent-Student links
CREATE TABLE parent_student_links (
    id SERIAL PRIMARY KEY,
    parent_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(parent_id, student_id)
);

-- Assignments table
CREATE TABLE assignments (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    subject VARCHAR(100),
    deadline TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Assignment targets (which student gets which assignment)
CREATE TABLE assignment_targets (
    id SERIAL PRIMARY KEY,
    assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
    student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'graded', 'overdue')),
    submitted_at TIMESTAMP,
    grade INTEGER CHECK (grade >= 1 AND grade <= 5),
    feedback TEXT,
    UNIQUE(assignment_id, student_id)
);

-- Notifications table
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    type VARCHAR(50),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Progress tracking
CREATE TABLE progress (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    subject VARCHAR(100),
    completed_tasks INTEGER DEFAULT 0,
    total_tasks INTEGER DEFAULT 0,
    average_grade DECIMAL(3,2),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_assignments_teacher ON assignments(teacher_id);
CREATE INDEX idx_assignment_targets_student ON assignment_targets(student_id);
CREATE INDEX idx_assignment_targets_status ON assignment_targets(status);
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_progress_student ON progress(student_id);

-- Insert sample data
INSERT INTO users (name, email, password, role, grade) VALUES
-- Password is 'password123' (hashed with bcrypt)
('Анна Петрова', 'teacher@eduflow.com', '$2a$10$YKxoZJ6xwZ4Q3Y5m1.xQ5uK8X3Y5m1.xQ5uK8X3Y5m1.xQ5uK8X3Y5m1', 'teacher', NULL),
('Иван Иванов', 'student@eduflow.com', '$2a$10$YKxoZJ6xwZ4Q3Y5m1.xQ5uK8X3Y5m1.xQ5uK8X3Y5m1.xQ5uK8X3Y5m1', 'student', 9),
('Мария Иванова', 'parent@eduflow.com', '$2a$10$YKxoZJ6xwZ4Q3Y5m1.xQ5uK8X3Y5m1.xQ5uK8X3Y5m1.xQ5uK8X3Y5m1', 'parent', NULL);

-- Link parent to student
INSERT INTO parent_student_links (parent_id, student_id)
VALUES (3, 2);

-- Sample assignments
INSERT INTO assignments (teacher_id, title, description, subject, deadline) VALUES
(1, 'Квадратные уравнения', 'Решить задачи 1-10 из учебника', 'Алгебра', '2026-04-25 18:00:00'),
(1, 'Война и мир - анализ', 'Написать эссе по первым главам', 'Литература', '2026-04-23 15:00:00'),
(1, 'Химические реакции', 'Лабораторная работа №5', 'Химия', '2026-04-28 12:00:00');

-- Assign to student
INSERT INTO assignment_targets (assignment_id, student_id, status) VALUES
(1, 2, 'pending'),
(2, 2, 'submitted'),
(3, 2, 'pending');

-- Sample notifications
INSERT INTO notifications (user_id, message, type) VALUES
(2, 'Новое задание по Алгебре', 'new_assignment'),
(2, 'Проверено задание по Литературе', 'graded'),
(3, 'Ваш ребенок получил новое задание', 'parent_notification');

-- Update progress
INSERT INTO progress (student_id, subject, completed_tasks, total_tasks, average_grade) VALUES
(2, 'Алгебра', 8, 12, 4.2),
(2, 'Литература', 10, 12, 4.5),
(2, 'Химия', 6, 10, 3.8);

-- Create function to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_progress_updated_at 
    BEFORE UPDATE ON progress 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();