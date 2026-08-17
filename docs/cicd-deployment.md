# CI/CD — GitHub Actions → AWS Lambda

> **For Claude Code:** Read this entire file before writing any code.
> This sets up automated deployment of both Lambdas (API + Extractor) to AWS on every push to `main`.
> Implement exactly as specified.

---

## Overview

```
Push to main branch
        ↓
GitHub Actions triggered
        ↓
Install dependencies (pnpm)
        ↓
Build both Lambdas (esbuild)
        ├── dist/index.js      → API Lambda
        └── dist/extractor.js  → Extractor Lambda
        ↓
Zip each bundle
        ↓
Deploy to AWS Lambda
        ├── parseflowai-api        ← update function code
        └── parseflowai-extractor  ← update function code
        ↓
Done — live in ~1 minute
```

---

## Part 1 — GitHub Secrets Setup

Go to **GitHub → your repo → Settings → Secrets and variables → Actions → New repository secret**

Add these secrets:

```
AWS_ACCESS_KEY_ID        → your IAM access key
AWS_SECRET_ACCESS_KEY    → your IAM secret key
AWS_REGION               → ap-south-1

# API Lambda env vars
API_KEY_SECRET           → your rp_live_ bearer secret
GEMINI_API_KEY           → your Gemini API key
S3_BUCKET_NAME           → parseflowai
S3_PRESIGNED_URL_EXPIRY  → 900
MAX_FILE_SIZE_MB         → 10
RESUME_TTL_HOURS         → 24
DYNAMODB_TABLE_NAME      → parseflowai-resumes
```

> **Never put secrets in code or `.env` committed to GitHub.**
> GitHub Secrets are encrypted and injected only at workflow runtime.

---

## Part 2 — IAM Permissions for GitHub Actions

The IAM user whose keys are in GitHub Secrets needs Lambda deploy permission.

Go to **AWS Console → IAM → Users → your user → Permissions → Edit policy** and add:

```json
{
  "Sid": "LambdaDeploy",
  "Effect": "Allow",
  "Action": [
    "lambda:UpdateFunctionCode",
    "lambda:UpdateFunctionConfiguration",
    "lambda:GetFunction"
  ],
  "Resource": [
    "arn:aws:lambda:ap-south-1:*:function:parseflowai-api",
    "arn:aws:lambda:ap-south-1:*:function:parseflowai-extractor"
  ]
}
```

> `UpdateFunctionCode` — uploads the new zip
> `UpdateFunctionConfiguration` — updates env vars
> `GetFunction` — lets the action verify deployment succeeded

---

## Part 3 — Files to Create

### File 1: `.github/workflows/deploy.yml`

Create this file at the exact path shown.

```yaml
name: Deploy to AWS Lambda

on:
  push:
    branches:
      - main

jobs:
  deploy:
    name: Build and Deploy
    runs-on: ubuntu-latest

    steps:
      # Step 1 — Checkout code
      - name: Checkout
        uses: actions/checkout@v4

      # Step 2 — Setup pnpm
      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 11

      # Step 3 — Setup Node.js
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      # Step 4 — Install dependencies
      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # Step 5 — Build both Lambdas
      - name: Build
        run: pnpm build

      # Step 6 — Zip API Lambda
      - name: Zip API Lambda
        run: zip -j dist/api.zip dist/index.js

      # Step 7 — Zip Extractor Lambda
      - name: Zip Extractor Lambda
        run: zip -j dist/extractor.zip dist/extractor.js

      # Step 8 — Configure AWS credentials
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}

      # Step 9 — Deploy API Lambda code
      - name: Deploy API Lambda code
        run: |
          aws lambda update-function-code \
            --function-name parseflowai-api \
            --zip-file fileb://dist/api.zip

      # Step 10 — Wait for API Lambda update to complete
      - name: Wait for API Lambda
        run: |
          aws lambda wait function-updated \
            --function-name parseflowai-api

      # Step 11 — Update API Lambda env vars
      - name: Update API Lambda env vars
        run: |
          aws lambda update-function-configuration \
            --function-name parseflowai-api \
            --environment "Variables={
              NODE_ENV=production,
              AWS_S3_BUCKET=${{ secrets.S3_BUCKET_NAME || 'parseflowai' }},
              S3_BUCKET_NAME=${{ secrets.S3_BUCKET_NAME || 'parseflowai' }},
              S3_PRESIGNED_URL_EXPIRY=${{ secrets.S3_PRESIGNED_URL_EXPIRY || '900' }},
              MAX_FILE_SIZE_MB=${{ secrets.MAX_FILE_SIZE_MB || '5' }},
              GEMINI_API_KEY=${{ secrets.GEMINI_API_KEY }},
              API_KEY_SECRET=${{ secrets.API_KEY_SECRET }},
              RESUME_TTL_HOURS=${{ secrets.RESUME_TTL_HOURS || '24' }},
              DYNAMODB_TABLE_NAME=${{ secrets.DYNAMODB_TABLE_NAME || 'parseflowai-resumes' }}
            }"

      # Step 12 — Deploy Extractor Lambda code
      - name: Deploy Extractor Lambda code
        run: |
          aws lambda update-function-code \
            --function-name parseflowai-extractor \
            --zip-file fileb://dist/extractor.zip

      # Step 13 — Wait for Extractor Lambda update to complete
      - name: Wait for Extractor Lambda
        run: |
          aws lambda wait function-updated \
            --function-name parseflowai-extractor

      # Step 14 — Update Extractor Lambda env vars
      - name: Update Extractor Lambda env vars
        run: |
          aws lambda update-function-configuration \
            --function-name parseflowai-extractor \
            --environment "Variables={
              NODE_ENV=production,
              AWS_S3_BUCKET=${{ secrets.S3_BUCKET_NAME || 'parseflowai' }},
              DYNAMODB_TABLE_NAME=${{ secrets.DYNAMODB_TABLE_NAME || 'parseflowai-resumes' }},
              RESUME_TTL_HOURS=${{ secrets.RESUME_TTL_HOURS || '24' }}
            }"

      # Step 15 — Confirm deployment
      - name: Confirm deployment
        run: |
          echo "✅ parseflowai-api deployed"
          echo "✅ parseflowai-extractor deployed"
```

---

### File 2: `package.json` — Verify build scripts exist

Make sure these scripts are in `package.json` (from the extractor doc):

```json
{
  "scripts": {
    "build:api": "esbuild src/index.ts --bundle --platform=node --target=node20 --outfile=dist/index.js --external:@aws-sdk/*",
    "build:extractor": "esbuild src/extractor.ts --bundle --platform=node --target=node20 --outfile=dist/extractor.js --external:@aws-sdk/*",
    "build": "pnpm build:api && pnpm build:extractor"
  }
}
```

> **`--external:@aws-sdk/*`** is important — AWS Lambda runtime already includes the AWS SDK.
> Excluding it keeps the bundle small (saves ~10MB per zip) and speeds up cold starts.

---

### File 3: `.gitignore` — Verify these are ignored

```
node_modules/
dist/
.env
*.zip
```

> Never commit `dist/` or `.env` to GitHub.

---

## Part 4 — AWS Lambda Setup (one-time, before first deploy)

Both Lambda functions must exist in AWS before the workflow can deploy to them.
GitHub Actions only updates existing functions — it does not create them.

### Create API Lambda

Go to **AWS Console → Lambda → Create function**:

```
Function name  : parseflowai-api
Runtime        : Node.js 20.x
Architecture   : x86_64
Handler        : index.handler
```

Under **General configuration**:
```
Timeout : 30 seconds
Memory  : 256 MB
```

### Create Extractor Lambda

Go to **AWS Console → Lambda → Create function**:

```
Function name  : parseflowai-extractor
Runtime        : Node.js 20.x
Architecture   : x86_64
Handler        : extractor.handler
```

Under **General configuration**:
```
Timeout : 30 seconds
Memory  : 256 MB
```

> Initial code doesn't matter — GitHub Actions will overwrite it on first push.
> Just create the functions so the ARNs exist.

---

## Part 5 — First Deployment

Once everything is set up:

```bash
git add .
git commit -m "feat: initial deployment setup"
git push origin main
```

Then go to **GitHub → your repo → Actions** tab.

You'll see the workflow running. Each step logs output. It should complete in under 2 minutes.

---

## Deployment Flow After Setup

Every time you push to `main`:

```
git add .
git commit -m "your message"
git push origin main
        ↓
GitHub Actions auto-runs
        ↓
Both Lambdas updated in ~60 seconds
```

No manual zipping, no manual uploading to AWS console.

---

## Part 6 — Verify Deployment

After the workflow succeeds:

**API Lambda:**
- Go to AWS Console → Lambda → `parseflowai-api` → Test
- Send a test event to `/health` — should return `{ status: "ok" }`

**Extractor Lambda:**
- Upload a PDF manually to S3
- Go to Lambda → `parseflowai-extractor` → Monitor → View CloudWatch logs
- Should see extraction logs

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `ResourceNotFoundException` | Lambda function doesn't exist yet | Create the function in AWS console first |
| `AccessDeniedException` | IAM missing `lambda:UpdateFunctionCode` | Add Lambda deploy permissions to IAM user |
| `pnpm: command not found` | pnpm setup step failed | Check `pnpm/action-setup@v4` step |
| `Cannot find module` | esbuild bundle issue | Check `--external:@aws-sdk/*` flag |
| Env vars not updating | Lambda still processing previous update | The `wait` steps handle this — check logs |

---

## After Setup

Update `AICONTEXT.md`:

1. **File Registry** — add:
   - `.github/workflows/deploy.yml` — `✅ Exists` — GitHub Actions CI/CD for both Lambdas

2. **Progress Tracker Phase 9** — check off:
   - `API Lambda packaged via esbuild`
   - `Extractor Lambda packaged separately via esbuild`

3. **Decision Log** — add:
   - GitHub Actions chosen for CI/CD — free tier (2000 min/month), zero infrastructure, native AWS credential support via `aws-actions/configure-aws-credentials`
   - `--external:@aws-sdk/*` in esbuild — AWS SDK excluded from bundle since Lambda runtime includes it, reduces bundle size significantly
