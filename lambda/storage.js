const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({});
const DATA_KEY = 'inquiries.json';

function getBucket() {
    const bucket = process.env.S3_BUCKET;

    if (!bucket) {
        throw new Error('S3_BUCKET environment variable is not set.');
    }

    return bucket;
}

async function streamToString(stream) {
    const chunks = [];

    for await (const chunk of stream) {
        chunks.push(chunk);
    }

    return Buffer.concat(chunks).toString('utf8');
}

async function readInquiries() {
    try {
        const response = await s3.send(new GetObjectCommand({
            Bucket: getBucket(),
            Key: DATA_KEY
        }));
        const raw = await streamToString(response.Body);
        const parsed = JSON.parse(raw);

        if (!parsed || !Array.isArray(parsed.inquiries)) {
            return { inquiries: [] };
        }

        return parsed;
    } catch (error) {
        if (error.name === 'NoSuchKey') {
            return { inquiries: [] };
        }

        throw error;
    }
}

async function writeInquiries(data) {
    await s3.send(new PutObjectCommand({
        Bucket: getBucket(),
        Key: DATA_KEY,
        Body: JSON.stringify(data, null, 2),
        ContentType: 'application/json'
    }));
}

async function addInquiry(inquiry) {
    const { randomUUID } = require('crypto');
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
