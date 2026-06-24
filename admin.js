const loginSection = document.getElementById('login-section');
const dashboardSection = document.getElementById('dashboard-section');
const loginForm = document.getElementById('login-form');
const loginFeedback = document.getElementById('login-feedback');
const dashboardFeedback = document.getElementById('dashboard-feedback');
const inquiriesList = document.getElementById('inquiries-list');
const emptyState = document.getElementById('empty-state');
const adminUserLabel = document.getElementById('admin-user-label');
const statTotal = document.getElementById('stat-total');
const statUnread = document.getElementById('stat-unread');

function showFeedback(element, message, isError) {
    element.textContent = message;
    element.hidden = false;
    element.className = isError ? 'form-feedback form-feedback-error' : 'form-feedback form-feedback-success';
}

function hideFeedback(element) {
    element.hidden = true;
    element.textContent = '';
}

function formatDate(isoString) {
    const date = new Date(isoString);
    return date.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
    });
}

function showLogin() {
    loginSection.hidden = false;
    dashboardSection.hidden = true;
}

function showDashboard(username) {
    loginSection.hidden = true;
    dashboardSection.hidden = false;
    adminUserLabel.textContent = username;
}

async function checkSession() {
    const response = await fetch(apiUrl('/api/admin/session'), { credentials: 'include' });
    const data = await response.json();

    if (data.authenticated) {
        showDashboard(data.username);
        await loadInquiries();
    } else {
        showLogin();
    }
}

async function loadInquiries() {
    hideFeedback(dashboardFeedback);

    try {
        const response = await fetch(apiUrl('/api/admin/inquiries'), { credentials: 'include' });
        const data = await response.json();

        if (!response.ok) {
            if (response.status === 401) {
                showLogin();
                return;
            }
            throw new Error(data.error || 'Failed to load inquiries.');
        }

        renderInquiries(data.inquiries || []);
    } catch (error) {
        showFeedback(dashboardFeedback, error.message, true);
    }
}

function renderInquiries(inquiries) {
    inquiriesList.innerHTML = '';
    statTotal.textContent = String(inquiries.length);
    statUnread.textContent = String(inquiries.filter((item) => !item.read).length);

    if (inquiries.length === 0) {
        emptyState.hidden = false;
        return;
    }

    emptyState.hidden = true;

    inquiries.forEach((inquiry) => {
        const card = document.createElement('article');
        card.className = `inquiry-card card${inquiry.read ? '' : ' inquiry-unread'}`;
        card.dataset.id = inquiry.id;

        const header = document.createElement('div');
        header.className = 'inquiry-header';

        const title = document.createElement('h3');
        title.textContent = inquiry.subject;

        const meta = document.createElement('p');
        meta.className = 'inquiry-meta';
        meta.textContent = `${inquiry.name} · ${inquiry.email} · ${formatDate(inquiry.createdAt)}`;

        header.appendChild(title);
        header.appendChild(meta);

        const message = document.createElement('p');
        message.className = 'inquiry-message';
        message.textContent = inquiry.message;

        const actions = document.createElement('div');
        actions.className = 'inquiry-actions';

        if (!inquiry.read) {
            const readBtn = document.createElement('button');
            readBtn.type = 'button';
            readBtn.className = 'btn btn-secondary btn-sm';
            readBtn.textContent = 'Mark as Read';
            readBtn.addEventListener('click', () => markAsRead(inquiry.id));
            actions.appendChild(readBtn);
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn-outline btn-sm';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => deleteInquiry(inquiry.id));
        actions.appendChild(deleteBtn);

        card.appendChild(header);
        card.appendChild(message);
        card.appendChild(actions);
        inquiriesList.appendChild(card);
    });
}

async function markAsRead(id) {
    const response = await fetch(apiUrl(`/api/admin/inquiries/${id}/read`), {
        method: 'PATCH',
        credentials: 'include'
    });

    if (response.ok) {
        await loadInquiries();
    }
}

async function deleteInquiry(id) {
    if (!window.confirm('Delete this inquiry permanently?')) {
        return;
    }

    const response = await fetch(apiUrl(`/api/admin/inquiries/${id}`), {
        method: 'DELETE',
        credentials: 'include'
    });

    if (response.ok) {
        await loadInquiries();
    }
}

loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideFeedback(loginFeedback);

    const formData = new FormData(loginForm);
    const payload = {
        username: formData.get('username'),
        password: formData.get('password')
    };

    try {
        const response = await fetch(apiUrl('/api/admin/login'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            showFeedback(loginFeedback, data.error || 'Login failed.', true);
            return;
        }

        loginForm.reset();
        showDashboard(data.username);
        await loadInquiries();
    } catch (error) {
        showFeedback(loginFeedback, 'Unable to connect to the server.', true);
    }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch(apiUrl('/api/admin/logout'), { method: 'POST', credentials: 'include' });
    showLogin();
    loginForm.reset();
});

document.getElementById('refresh-btn').addEventListener('click', loadInquiries);

document.addEventListener('DOMContentLoaded', checkSession);
