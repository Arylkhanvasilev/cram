// auth.js - Authentication handling
const API_URL = 'http://localhost:3000/api';

class Auth {
    constructor() {
        this.init();
    }

    init() {
        // Check if already logged in
        const token = localStorage.getItem('token');
        const currentPath = window.location.pathname;
        
        if (token && (currentPath.includes('login') || currentPath.includes('register'))) {
            window.location.href = '/dashboard.html';
        }

        // Setup forms
        this.setupLoginForm();
        this.setupRegisterForm();
        this.setupRoleToggle();
    }

    setupLoginForm() {
        const form = document.getElementById('loginForm');
        if (!form) return;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const errorDiv = document.getElementById('errorMessage');
            
            try {
                const response = await fetch(`${API_URL}/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Login failed');
                }

                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                
                window.location.href = '/dashboard.html';
            } catch (error) {
                errorDiv.textContent = error.message;
                errorDiv.style.display = 'block';
            }
        });
    }

    setupRegisterForm() {
        const form = document.getElementById('registerForm');
        if (!form) return;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const userData = {
                name: document.getElementById('name').value,
                email: document.getElementById('email').value,
                password: document.getElementById('password').value,
                role: document.getElementById('role').value
            };

            const grade = document.getElementById('grade')?.value;
            if (grade && userData.role === 'student') {
                userData.grade = parseInt(grade);
            }

            const errorDiv = document.getElementById('errorMessage');
            
            try {
                const response = await fetch(`${API_URL}/auth/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(userData)
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Registration failed');
                }

                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                
                window.location.href = '/dashboard.html';
            } catch (error) {
                errorDiv.textContent = error.message;
                errorDiv.style.display = 'block';
            }
        });
    }

    setupRoleToggle() {
        const roleSelect = document.getElementById('role');
        const gradeGroup = document.getElementById('gradeGroup');
        
        if (!roleSelect || !gradeGroup) return;

        roleSelect.addEventListener('change', () => {
            if (roleSelect.value === 'student') {
                gradeGroup.style.display = 'block';
            } else {
                gradeGroup.style.display = 'none';
            }
        });
    }
}

// Initialize auth
new Auth();