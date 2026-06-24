const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { validateInquiry, validateLogin } = require('./utils/validation');
const { readInquiries, addInquiry, markInquiryRead, deleteInquiry } = require('./utils/storage');

const ROOT = __dirname;
const SESSION_MAX_AGE = 8 * 60 * 60;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8'
};

const STATIC_FILES = new Set([
    'index.html',
    'products.html',
    'admin.html',
    'style.css',
    'script.js',
    'admin.js',
    'api.js'
]);

const ROUTE_MAP = {
    '/admin': 'admin.html'
};

let PORT;
let SESSION_SECRET;
let ADMIN_USERNAME;
let adminPasswordHash;

async function loadEnvFile() {
    try {
        const raw = await fs.readFile(path.join(ROOT, '.env'), 'utf8');

        raw.split('\n').forEach((line) => {
            const trimmed = line.trim();

            if (!trimmed || trimmed.startsWith('#')) {
                return;
            }

            const separator = trimmed.indexOf('=');

            if (separator === -1) {
                return;
            }

            const key = trimmed.slice(0, separator).trim();
            const value = trimmed.slice(separator + 1).trim();

            if (key && process.env[key] === undefined) {
                process.env[key] = value;
            }
        });
    } catch {
        // .env is optional when variables are set in the environment
    }
}

function verifyPassword(password) {
    const hash = crypto.scryptSync(password, SESSION_SECRET, 64);
    return crypto.timingSafeEqual(hash, adminPasswordHash);
}

function sendJson(res, statusCode, payload, corsHeaders = {}) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        ...corsHeaders
    });
    res.end(body);
}

function isAllowedOrigin(origin) {
    if (!origin || origin === 'null') {
        return true;
    }

    try {
        const url = new URL(origin);
        return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    } catch {
        return false;
    }
}

function getCorsHeaders(req) {
    const origin = req.headers.origin;

    if (!isAllowedOrigin(origin)) {
        return {};
    }

    const headers = {
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (!origin || origin === 'null') {
        headers['Access-Control-Allow-Origin'] = 'null';
    } else {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Credentials'] = 'true';
    }

    return headers;
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
    const payload = Buffer.from(JSON.stringify({
        username,
        exp: Date.now() + SESSION_MAX_AGE * 1000
    })).toString('base64url');

    const signature = crypto
        .createHmac('sha256', SESSION_SECRET)
        .update(payload)
        .digest('base64url');

    return `${payload}.${signature}`;
}

function readSessionToken(token) {
    if (typeof token !== 'string' || !token.includes('.')) {
        return null;
    }

    const [payload, signature] = token.split('.');
    const expected = crypto
        .createHmac('sha256', SESSION_SECRET)
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

function setSessionCookie(res, token) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `sumaitra_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}${secure}`);
}

function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', 'sumaitra_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function getSession(req) {
    const cookies = parseCookies(req.headers.cookie);
    return readSessionToken(cookies.sumaitra_session);
}

async function readJsonBody(req) {
    const chunks = [];
    let total = 0;

    for await (const chunk of req) {
        total += chunk.length;

        if (total > 32 * 1024) {
            throw new Error('Payload too large');
        }

        chunks.push(chunk);
    }

    if (chunks.length === 0) {
        return {};
    }

    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function isSafeAssetPath(relativePath) {
    if (relativePath.includes('..')) {
        return false;
    }

    const ext = path.extname(relativePath).toLowerCase();
    return MIME_TYPES[ext] !== undefined;
}

async function serveStatic(relativePath, res) {
    let filePath;

    if (relativePath.startsWith('assets/')) {
        if (!isSafeAssetPath(relativePath)) {
            sendJson(res, 404, { error: 'Not found' });
            return;
        }

        filePath = path.join(ROOT, relativePath);
    } else if (STATIC_FILES.has(relativePath)) {
        filePath = path.join(ROOT, relativePath);
    } else {
        sendJson(res, 404, { error: 'Not found' });
        return;
    }

    if (!filePath.startsWith(ROOT)) {
        sendJson(res, 404, { error: 'Not found' });
        return;
    }

    try {
        const content = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(content);
    } catch {
        sendJson(res, 404, { error: 'Not found' });
    }
}

async function handleApi(req, res, pathname) {
    const corsHeaders = getCorsHeaders(req);

    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
    }

    if (req.method === 'POST' && pathname === '/api/inquiries') {
        try {
            const body = await readJsonBody(req);
            const validation = validateInquiry(body);

            if (!validation.valid) {
                sendJson(res, 400, { error: validation.errors.join(' ') }, corsHeaders);
                return;
            }

            const inquiry = await addInquiry(validation.data);
            sendJson(res, 201, {
                message: 'Your inquiry has been sent successfully.',
                id: inquiry.id
            }, corsHeaders);
        } catch (error) {
            console.error('Failed to save inquiry:', error.message);
            sendJson(res, 500, { error: 'Unable to save your inquiry. Please try again later.' }, corsHeaders);
        }
        return;
    }

    if (req.method === 'POST' && pathname === '/api/admin/login') {
        try {
            const body = await readJsonBody(req);
            const validation = validateLogin(body);

            if (!validation.valid) {
                sendJson(res, 400, { error: validation.errors.join(' ') }, corsHeaders);
                return;
            }

            const { username, password } = validation.data;

            if (username !== ADMIN_USERNAME || !verifyPassword(password)) {
                sendJson(res, 401, { error: 'Invalid username or password.' }, corsHeaders);
                return;
            }

            setSessionCookie(res, createSessionToken(username));
            sendJson(res, 200, { message: 'Login successful.', username }, corsHeaders);
        } catch (error) {
            sendJson(res, 400, { error: 'Invalid request body.' }, corsHeaders);
        }
        return;
    }

    if (req.method === 'POST' && pathname === '/api/admin/logout') {
        const session = getSession(req);

        if (!session) {
            sendJson(res, 401, { error: 'Authentication required.' }, corsHeaders);
            return;
        }

        clearSessionCookie(res);
        sendJson(res, 200, { message: 'Logged out successfully.' }, corsHeaders);
        return;
    }

    if (req.method === 'GET' && pathname === '/api/admin/session') {
        const session = getSession(req);

        if (session) {
            sendJson(res, 200, { authenticated: true, username: session.username }, corsHeaders);
        } else {
            sendJson(res, 200, { authenticated: false }, corsHeaders);
        }
        return;
    }

    if (req.method === 'GET' && pathname === '/api/admin/inquiries') {
        const session = getSession(req);

        if (!session) {
            sendJson(res, 401, { error: 'Authentication required.' }, corsHeaders);
            return;
        }

        try {
            const data = await readInquiries();
            sendJson(res, 200, data, corsHeaders);
        } catch (error) {
            console.error('Failed to read inquiries:', error.message);
            sendJson(res, 500, { error: 'Unable to load inquiries.' }, corsHeaders);
        }
        return;
    }

    const readMatch = pathname.match(/^\/api\/admin\/inquiries\/([0-9a-f-]{36})\/read$/i);

    if (req.method === 'PATCH' && readMatch) {
        const session = getSession(req);

        if (!session) {
            sendJson(res, 401, { error: 'Authentication required.' }, corsHeaders);
            return;
        }

        try {
            const inquiry = await markInquiryRead(readMatch[1]);

            if (!inquiry) {
                sendJson(res, 404, { error: 'Inquiry not found.' }, corsHeaders);
                return;
            }

            sendJson(res, 200, { message: 'Marked as read.', inquiry }, corsHeaders);
        } catch (error) {
            sendJson(res, 500, { error: 'Unable to update inquiry.' }, corsHeaders);
        }
        return;
    }

    const deleteMatch = pathname.match(/^\/api\/admin\/inquiries\/([0-9a-f-]{36})$/i);

    if (req.method === 'DELETE' && deleteMatch) {
        const session = getSession(req);

        if (!session) {
            sendJson(res, 401, { error: 'Authentication required.' }, corsHeaders);
            return;
        }

        try {
            const deleted = await deleteInquiry(deleteMatch[1]);

            if (!deleted) {
                sendJson(res, 404, { error: 'Inquiry not found.' }, corsHeaders);
                return;
            }

            sendJson(res, 200, { message: 'Inquiry deleted.' }, corsHeaders);
        } catch (error) {
            sendJson(res, 500, { error: 'Unable to delete inquiry.' }, corsHeaders);
        }
        return;
    }

    sendJson(res, 404, { error: 'Not found' }, corsHeaders);
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;

    if (pathname.startsWith('/api/')) {
        await handleApi(req, res, pathname);
        return;
    }

    if (pathname === '/admin.html') {
        res.writeHead(301, { Location: '/admin' });
        res.end();
        return;
    }

    const mapped = ROUTE_MAP[pathname];
    const relativePath = mapped || (pathname.startsWith('/') ? pathname.slice(1) : pathname);
    await serveStatic(relativePath, res);
});

async function startServer() {
    await loadEnvFile();

    PORT = Number(process.env.PORT) || 3000;
    SESSION_SECRET = process.env.SESSION_SECRET;
    ADMIN_USERNAME = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!SESSION_SECRET || !ADMIN_USERNAME || !adminPassword) {
        console.error('Missing required environment variables. Copy .env.example to .env and configure it.');
        process.exit(1);
    }

    if (adminPassword.length < 8) {
        console.error('ADMIN_PASSWORD must be at least 8 characters.');
        process.exit(1);
    }

    adminPasswordHash = crypto.scryptSync(adminPassword, SESSION_SECRET, 64);

    server.listen(PORT, () => {
        console.log(`Sumaitra Innovations site running at http://localhost:${PORT}`);
        console.log(`Admin panel: http://localhost:${PORT}/admin`);
    });
}

startServer();
