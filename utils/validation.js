const ALLOWED_SUBJECTS = [
    'Product Inquiry / Quote',
    'Consultation / R&D Collaboration',
    'General Contact'
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeText(value, maxLength) {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim().slice(0, maxLength);
}

function validateInquiry(body) {
    const errors = [];

    const name = sanitizeText(body.name, 200);
    const email = sanitizeText(body.email, 254);
    const subject = sanitizeText(body.subject, 100);
    const message = sanitizeText(body.message, 5000);

    if (name.length < 2) {
        errors.push('Name must be at least 2 characters.');
    }

    if (!EMAIL_PATTERN.test(email)) {
        errors.push('A valid email address is required.');
    }

    if (!ALLOWED_SUBJECTS.includes(subject)) {
        errors.push('Please select a valid subject.');
    }

    if (message.length < 10) {
        errors.push('Message must be at least 10 characters.');
    }

    if (errors.length > 0) {
        return { valid: false, errors };
    }

    return {
        valid: true,
        data: { name, email, subject, message }
    };
}

function validateLogin(body) {
    const username = sanitizeText(body.username, 100);
    const password = typeof body.password === 'string' ? body.password : '';

    if (!username || !password) {
        return { valid: false, errors: ['Username and password are required.'] };
    }

    if (password.length > 128) {
        return { valid: false, errors: ['Invalid credentials.'] };
    }

    return { valid: true, data: { username, password } };
}

module.exports = {
    ALLOWED_SUBJECTS,
    validateInquiry,
    validateLogin
};
