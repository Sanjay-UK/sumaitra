const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

const DATA_FILE = path.join(__dirname, '..', 'data', 'inquiries.json');

async function ensureDataFile() {
    try {
        await fs.access(DATA_FILE);
    } catch {
        await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
        await fs.writeFile(DATA_FILE, JSON.stringify({ inquiries: [] }, null, 2), 'utf8');
    }
}

async function readInquiries() {
    await ensureDataFile();
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);

    if (!parsed || !Array.isArray(parsed.inquiries)) {
        return { inquiries: [] };
    }

    return parsed;
}

async function writeInquiries(data) {
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

async function addInquiry(inquiry) {
    const data = await readInquiries();
    const entry = {
        id: randomUUID(),
        name: inquiry.name,
        email: inquiry.email,
        subject: inquiry.subject,
        message: inquiry.message,
        createdAt: new Date().toISOString(),
        read: false
    };

    data.inquiries.unshift(entry);
    await writeInquiries(data);
    return entry;
}

async function markInquiryRead(id) {
    const data = await readInquiries();
    const inquiry = data.inquiries.find((item) => item.id === id);

    if (!inquiry) {
        return null;
    }

    inquiry.read = true;
    await writeInquiries(data);
    return inquiry;
}

async function deleteInquiry(id) {
    const data = await readInquiries();
    const index = data.inquiries.findIndex((item) => item.id === id);

    if (index === -1) {
        return false;
    }

    data.inquiries.splice(index, 1);
    await writeInquiries(data);
    return true;
}

module.exports = {
    readInquiries,
    addInquiry,
    markInquiryRead,
    deleteInquiry
};
