# Sumaitra Innovations Website

Corporate website for [Sumaitra Innovations](https://sumaitra.com) with contact inquiry form and admin panel.

## Local development

```bash
cp .env.example .env   # set SESSION_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD
npm start              # http://localhost:3000
```

## Production architecture

- **AWS Amplify** — static HTML/CSS/JS
- **AWS Lambda** — `/api/*` endpoints (inquiry form, admin auth)
- **AWS S3** — inquiry storage (`inquiries.json`)

See `lambda/` for the API handler deployed separately to Lambda.

## Environment variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `SESSION_SECRET` | Lambda + local `.env` | Session signing |
| `ADMIN_USERNAME` | Lambda + local `.env` | Admin login |
| `ADMIN_PASSWORD` | Lambda + local `.env` | Admin login |
| `S3_BUCKET` | Lambda only | Inquiry storage bucket |

## Deploy

1. Push to `main` on GitHub — Amplify auto-deploys the static site
2. Deploy Lambda from `lambda/` (see AWS Console or `aws lambda update-function-code`)
3. In Amplify, add rewrite: `/api/<*>` → Lambda Function URL
