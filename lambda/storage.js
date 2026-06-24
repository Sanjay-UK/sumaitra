const crypto = require('crypto');
const https = require('https');

const DATA_KEY = 'inquiries.json';
const REGION = process.env.AWS_REGION || 'ap-south-1';

function getBucket() {
    const bucket = process.env.S3_BUCKET;

    if (!bucket) {
        throw new Error('S3_BUCKET environment variable is not set.');
    }

    return bucket;
}

function hmac(key, data, encoding) {
    return crypto.createHmac('sha256', key).update(data, 'utf8').digest(encoding);
}

function hash(data) {
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function getCredentials() {
    return {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN
    };
}

function signS3Request(method, key, body) {
    const bucket = getBucket();
    const host = `${bucket}.s3.${REGION}.amazonaws.com`;
    const path = `/${key}`;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = hash(body || '');
    const credentials = getCredentials();

    const headers = {
        host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate
    };

    if (credentials.sessionToken) {
        headers['x-amz-security-token'] = credentials.sessionToken;
    }

    if (body) {
        headers['content-type'] = 'application/json';
        headers['content-length'] = String(Buffer.byteLength(body, 'utf8'));
    }

    const canonicalHeaderEntries = Object.keys(headers)
        .sort()
        .map((name) => `${name}:${headers[name]}\n`)
        .join('');
    const signedHeaders = Object.keys(headers).sort().join(';');
    const canonicalRequest = [
        method,
        path,
        '',
        canonicalHeaderEntries,
        signedHeaders,
        payloadHash
    ].join('\n');

    const credentialScope = `${dateStamp}/${REGION}/s3/aws4_request`;
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        hash(canonicalRequest)
    ].join('\n');

    const kDate = hmac(`AWS4${credentials.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, REGION);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = hmac(kSigning, stringToSign, 'hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
        host,
        path,
        headers: {
            ...headers,
            Authorization: authorization
        },
        body
    };
}

function s3Request(method, key, body) {
    const signed = signS3Request(method, key, body);

    return new Promise((resolve, reject) => {
        const req = https.request({
            host: signed.host,
            path: signed.path,
            method,
            headers: signed.headers
        }, (res) => {
            const chunks = [];

            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const responseBody = Buffer.concat(chunks).toString('utf8');

                if (res.statusCode >= 400) {
                    const error = new Error(`S3 ${method} failed with status ${res.statusCode}`);
                    error.name = res.statusCode === 404 ? 'NoSuchKey' : 'S3Error';
                    error.statusCode = res.statusCode;
                    reject(error);
                    return;
                }

                resolve(responseBody);
            });
        });

        req.on('error', reject);

        if (signed.body) {
            req.write(signed.body);
        }

        req.end();
    });
}

async function readInquiries() {
    try {
        const raw = await s3Request('GET', DATA_KEY);
        const parsed = JSON.parse(raw);

        if (!parsed || !Array.isArray(parsed.inquiries)) {
            return { inquiries: [] };
        }

        return parsed;
    } catch (error) {
        if (error.name === 'NoSuchKey' || error.statusCode === 404) {
            return { inquiries: [] };
        }

        throw error;
    }
}

async function writeInquiries(data) {
    await s3Request('PUT', DATA_KEY, JSON.stringify(data, null, 2));
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
