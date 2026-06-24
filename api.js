const API_BASE = window.location.protocol === 'file:'
    ? 'http://localhost:3000'
    : '';

function apiUrl(path) {
    return `${API_BASE}${path}`;
}
