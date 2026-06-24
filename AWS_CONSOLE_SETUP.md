# Sumaitra AWS Console Setup (Lambda + Amplify)

**Region:** ap-south-1 (Mumbai)  
**S3 bucket:** `sumaitra-inquiries-prod-757374023708-ap-south-1-an`  
**GitHub repo:** [Sanjay-UK/sumaitra](https://github.com/Sanjay-UK/sumaitra)

---

## Part 1 — Lambda (`sumaitra-api`)

### 1. Create function

1. Open [Lambda Create function](https://ap-south-1.console.aws.amazon.com/lambda/home?region=ap-south-1#/create/function)
2. **Author from scratch**
3. Function name: `sumaitra-api`
4. Runtime: **Node.js 20.x**
5. Architecture: **arm64**
6. Execution role: **Create a new role with basic Lambda permissions**
7. Click **Create function**

### 2. Upload code

1. **Code** tab → **Upload from** → **.zip file**
2. Upload `lambda-deploy.zip` from project root (built locally)
3. Handler: `handler.handler` (default is fine if set to `handler.handler`)

### 3. Environment variables

**Configuration** → **Environment variables** → Edit:

| Key | Value |
|-----|-------|
| `S3_BUCKET` | `sumaitra-inquiries-prod-757374023708-ap-south-1-an` |
| `SESSION_SECRET` | *(generate a long random string — 32+ chars)* |
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD` | *(your production admin password)* |
| `NODE_ENV` | `production` |

### 4. IAM permissions for S3

1. **Configuration** → **Permissions** → click the **Role name**
2. **Add permissions** → **Create inline policy** → JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::sumaitra-inquiries-prod-757374023708-ap-south-1-an/inquiries.json"
    }
  ]
}
```

3. Name: `sumaitra-s3-inquiries` → **Create policy**

### 5. Function URL

1. **Configuration** → **Function URL** → **Create function URL**
2. Auth type: **NONE**
3. Save — copy the URL (e.g. `https://xxxxxxxx.lambda-url.ap-south-1.on.aws/`)

### 6. Test

```bash
curl -X POST "https://YOUR-FUNCTION-URL/api/inquiries" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","subject":"General Contact","message":"Hello from deployment test"}'
```

---

## Part 2 — Amplify Hosting

### 1. Create app

1. [Amplify Console](https://ap-south-1.console.aws.amazon.com/amplify/home?region=ap-south-1) → **Create new app**
2. **Host web app** → GitHub → authorize → select **Sanjay-UK/sumaitra**
3. Branch: **main**
4. Build settings: auto-detect `amplify.yml`
5. **Save and deploy**

### 2. Rewrites (after first deploy)

**App settings** → **Rewrites and redirects** → Add:

| Source | Target | Type |
|--------|--------|------|
| `/api/<*>` | `https://YOUR-LAMBDA-FUNCTION-URL/api/<*>` | 200 (Rewrite) |

(`/admin` → `/admin.html` is already in `amplify.yml`)

### 3. Custom domain (sumaitra.com)

1. **Domain management** → **Add domain** → `sumaitra.com`
2. Add DNS records in **GoDaddy** as shown by Amplify
3. Wait for SSL (15 min – 48 hrs)

---

## Part 3 — Verify

- [ ] `https://YOUR-AMPLIFY-URL` loads homepage
- [ ] Contact form submits successfully
- [ ] `https://YOUR-AMPLIFY-URL/admin` login works
- [ ] `sumaitra.com` resolves after DNS propagation

---

## Rebuild Lambda zip (after code changes)

```bash
cd lambda
zip -r ../lambda-deploy.zip handler.js storage.js validation.js package.json
```

Upload new zip in Lambda console → **Deploy**.
