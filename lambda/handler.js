const crypto = require('crypto');
const { validateInquiry, validateLogin } = require('./validation');
const { readInquiries, addInquiry, markInquiryRead, deleteInquiry } = require('./storage');

const SESSION_MAX_AGE = 8 * 60 * 60;

let adminPasswordHash;

function getConfig() {
    const sessionSecret = process.env.SESSION_SECRET;
    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!sessionSecret || !adminUsername || !adminPassword) {
        throw new Error('Missing SESSION_SECRET, ADMIN_USERNAME, or ADMIN_PASSWORD.');
    }

    if (!adminPasswordHash) {
        adminPasswordHash = crypto.scryptSync(adminPassword, sessionSecret, 64);
    }

    return { sessionSecret, adminUsername };
}

function verifyPassword(password) {
    const { sessionSecret } = getConfig();
    const hash = crypto.scryptSync(password, sessionSecret, 64);
    return crypto.timingSafeEqual(hash, adminPasswordHash);
}

function jsonResponse(statusCode, payload, extraHeaders = {}) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...extraHeaders
        },
        body: JSON.stringify(payload)
    };
}

function parseCookies(header) {
    const cookies = {};

    if (!header) {
        return cookies;
    }

    header.split(';').forEach((part) => {
        const [name, ...rest] = part.trim().split('=');

        if (name) {
            cookies[name] = decodeURIComponent(rest.join('='));
        }
    });

    return cookies;
}

function createSessionToken(username) {
    const { sessionSecret } = getConfig();
    const payload = Buffer.from(JSON.stringify({
        username,
        exp: Date.now() + SESSION_MAX_AGE * 1000
    })).toString('base64url');

    const signature = crypto
        .createHmac('sha256', sessionSecret)
        .update(payload)
        .digest('base64url');

    return `${payload}.${signature}`;
}

function readSessionToken(token) {
    if (typeof token !== 'string' || !token.includes('.')) {
        return null;
    }

    const { sessionSecret } = getConfig();
    const [payload, signature] = token.split('.');
    const expected = crypto
        .createHmac('sha256', sessionSecret)
        .update(payload)
        .digest('base64url');

    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
        return null;
    }

    try {
        const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

        if (!session.exp || session.exp < Date.now()) {
            return null;
        }

        return session;
    } catch {
        return null;
    }
}

function sessionCookieHeader(token) {
    return `sumaitra_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`;
}

function clearSessionCookieHeader() {
    return 'sumaitra_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}

function getSession(event) {
    const cookieHeader = event.headers?.cookie || event.headers?.Cookie || '';
    const cookies = parseCookies(cookieHeader);
    return readSessionToken(cookies.sumaitra_session);
}

function parseBody(event) {
    if (!event.body) {
        return {};
    }

    const raw = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;

    return JSON.parse(raw);
}

function getPath(event) {
    return event.rawPath || event.requestContext?.http?.path || event.path || '/';
}

function getMethod(event) {
    return event.requestContext?.http?.method || event.httpMethod || 'GET';
}

async function handleApi(event) {
    const pathname = getPath(event);
    const method = getMethod(event);

    if (method === 'OPTIONS') {
        return { statusCode: 204, headers: {}, body: '' };
    }

    if (method === 'POST' && pathname === '/api/inquiries') {
        try {
            const body = parseBody(event);
            const validation = validateInquiry(body);

            if (!validation.valid) {
                return jsonResponse(400, { error: validation.errors.join(' ') });
            }

            const inquiry = await addInquiry(validation.data);
            return jsonResponse(201, {
                message: 'Your inquiry has been sent successfully.',
                id: inquiry.id
            });
        } catch {
            return jsonResponse(500, { error: 'Unable to save your inquiry. Please try again later.' });
        }
    }

    if (method === 'POST' && pathname === '/api/admin/login') {
        try {
            const { adminUsername } = getConfig();
            const body = parseBody(event);
            const validation = validateLogin(body);

            if (!validation.valid) {
                return jsonResponse(400, { error: validation.errors.join(' ') });
            }

            const { username, password } = validation.data;

            if (username !== adminUsername || !verifyPassword(password)) {
                return jsonResponse(401, { error: 'Invalid username or password.' });
            }

            return jsonResponse(200, { message: 'Login successful.', username }, {
                'Set-Cookie': sessionCookieHeader(createSessionToken(username))
            });
        } catch {
            return jsonResponse(400, { error: 'Invalid request body.' });
        }
    }

    if (method === 'POST' && pathname === '/api/admin/logout') {
        const session = getSession(event);

        if (!session) {
            return jsonResponse(401, { error: 'Authentication required.' });
        }

        return jsonResponse(200, { message: 'Logged out successfully.' }, {
            'Set-Cookie': clearSessionCookieHeader()
        });
    }

    if (method === 'GET' && pathname === '/api/admin/session') {
        const session = getSession(event);

        if (session) {
            return jsonResponse(200, { authenticated: true, username: session.username });
        }

        return jsonResponse(200, { authenticated: false });
    }

    if (method === 'GET' && pathname === '/api/admin/inquiries') {
        const session = getSession(event);

        if (!session) {
            return jsonResponse(401, { error: 'Authentication required.' });
        }

        try {
            const data = await readInquiries();
            return jsonResponse(200, data);
        } catch {
            return jsonResponse(500, { error: 'Unable to load inquiries.' });
        }
    }

    const readMatch = pathname.match(/^\/api\/admin\/inquiries\/([0-9a-f-]{36})\/read$/i);

    if (method === 'PATCH' && readMatch) {
        const session = getSession(event);

        if (!session) {
            return jsonResponse(401, { error: 'Authentication required.' });
        }

        try {
            const inquiry = await markInquiryRead(readMatch[1]);

            if (!inquiry) {
                return jsonResponse(404, { error: 'Inquiry not found.' });
            }

            return jsonResponse(200, { message: 'Marked as read.', inquiry });
        } catch {
            return jsonResponse(500, { error: 'Unable to update inquiry.' });
        }
    }

    const deleteMatch = pathname.match(/^\/api\/admin\/inquiries\/([0-9a-f-]{36})$/i);

    if (method === 'DELETE' && deleteMatch) {
        const session = getSession(event);

        if (!session) {
            return jsonResponse(401, { error: 'Authentication required.' });
        }

        try {
            const deleted = await deleteInquiry(deleteMatch[1]);

            if (!deleted) {
                return jsonResponse(404, { error: 'Inquiry not found.' });
            }

            return jsonResponse(200, { message: 'Inquiry deleted.' });
        } catch {
            return jsonResponse(500, { error: 'Unable to delete inquiry.' });
        }
    }

    return jsonResponse(404, { error: 'Not found' });
}

exports.handler = async (event) => {
    try {
        return await handleApi(event);
    } catch (error) {
        console.error(error);
        return jsonResponse(500, { error: 'Internal server error.' });
    }
};
