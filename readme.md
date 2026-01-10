# Al-Madina Al-Munawwara eCommerce

## Overview
Al-Madina Al-Munawwara is an eCommerce platform for carpentry supplies, upholstery fabrics, and sofa-making materials. The app serves bilingual audiences (Arabic + Hebrew), supports online browsing and ordering, and includes a merchant/admin experience for managing products, orders, and discounts.

## Tech Stack
- Frontend: React + TypeScript + Vite + Tailwind (in `client/ama`)
- Backend: Node.js + Express + Mongoose (in `server`)
- Database: MongoDB
- Payments: Lahza (card payments + webhooks)
- Messaging: SMS via HTD provider
- Security: JWT auth, reCAPTCHA, CORS allowlist

## Key Features
- User signup/login, password reset, and phone verification
- Product catalog with variants, categories, and filtering
- Cart and order creation
- Card payments via Lahza and cash-on-delivery flow
- Order status updates and admin management
- Discounts and discount rules
- Notifications and home collections
- Contact form with SMTP delivery
- reCAPTCHA protection on sensitive flows

## Repository Structure
- `client/ama` - Frontend app (Vite + React + TS)
- `server` - Express API + MongoDB models
- `ecommerce_db_models.json` - Example data model reference
- `server Backup.zip` - Legacy server archive (optional reference)

## Installation and Local Development
### Prerequisites
- Node.js (LTS) and npm
- MongoDB (local or Atlas)
- Optional: Lahza account, reCAPTCHA keys, SMTP credentials, SMS provider credentials

### 1) Backend (server)
1. Create or update `server/.env` with your own values (do not commit secrets).
2. Install dependencies:
   ```bash
   cd server
   npm install
   ```
3. Start the server:
   ```bash
   npm run dev
   ```
   The API runs on `http://localhost:3001` by default.

### 2) Frontend (client)
1. Create or update `client/ama/.env` (see variables below).
2. Install dependencies:
   ```bash
   cd client/ama
   npm install
   ```
3. Start the client:
   ```bash
   npm run dev
   ```
   Vite serves the app on `http://localhost:5173` by default.

## Environment Variables
### Server (`server/.env`)
Core (required):
- `MONGO_URI` - MongoDB connection string
- `JWT_SECRET` - JWT signing secret (minimum 32 characters)

Core (optional):
- `PORT` - API port (default: 3001)
- `CLIENT_ORIGINS` - Comma-separated list of allowed frontend origins for CORS

Payments (Lahza):
- `LAHZA_SECRET_KEY` - Required for card payments and webhook verification
- `PAY_CURRENCY` - Default currency (default: `ILS`)
- `PAYMENT_MINOR_TOLERANCE` - Allowed minor-unit difference (default: 1)
- `PAYMENT_TOKEN_SECRET` - Overrides JWT secret for payment tokens
- `PAYMENT_TOKEN_TTL` - Payment token lifetime (default: `60m`)
- `WEBHOOK_IP_WHITELIST` - Enable IP allowlist (`true`/`false`)
- `WEBHOOK_ALLOWED_IPS` - Comma-separated IPs allowed for Lahza webhook
- `DECREMENT_STOCK_ON_PAYMENT` - `1` to decrement stock on successful payment

reCAPTCHA:
- `RECAPTCHA_SECRET` - Server-side secret
- `RECAPTCHA_MIN_SCORE` - Minimum score for v3 checks
- `RECAPTCHA_TEST_BYPASS` - `1` to bypass checks in testing

Email (contact form):
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
- `CONTACT_FROM`, `CONTACT_TO`

SMS (HTD provider):
- `SMS_HTD_BASE` or `SMS_BASE`
- `SMS_HTD_API_STYLE` (`simple`, `classic`, or `auto`)
- `SMS_HTD_ID` (simple mode)
- `SMS_USERNAME` / `SMS_PASSWORD` (classic mode)
- `SMS_SENDER` or `SMS_HTD_SENDER`
- `SEND_SMS_ENABLED` (`true` to send for real)
- `DEV_ECHO_SMS` (log SMS in dev)
- `SMS_RECIPIENT_FORMAT` (`E164`, `INT`, or `LOCAL`)

Auth:
- `RESET_PASSWORD_MAX_ATTEMPTS` - Throttle limit for reset attempts

### Client (`client/ama/.env`)
- `VITE_API_URL` - API base URL (ex: `http://localhost:3001`)
- `VITE_LAHZA_PUBLIC_KEY` - Lahza public key for client-side checkout

## Running Commands
Backend:
- `npm run dev` - start with nodemon
- `npm start` - start without watcher
- `npm test` - run server tests (Node test runner)

Frontend:
- `npm run dev` - start Vite
- `npm run build` - production build
- `npm run preview` - preview build

## API Summary
Base URL: `/api`
- `POST /auth/*` - auth, signup/login, password reset
- `GET /products`, `GET /variants` - catalog data
- `POST /orders`, `GET /orders/*` - orders and status
- `POST /payments/*` - payment initialization and confirmation
- `POST /contact` - contact form
- `POST /recaptcha/verify` - reCAPTCHA verification
- `GET /users/*` - user/admin management
- `GET /discounts`, `GET /discount-rules` - promotion system
- `GET /notifications`, `GET /home-collections`
- `GET /healthz` - health check

## Payments and Webhooks (Lahza)
The server verifies Lahza payments via:
- Client-initiated verification calls in `/api/payments`
- Webhook endpoint: `POST /api/webhooks/lahza`

Webhook requests must include the `x-lahza-signature` header (HMAC-SHA256). If `WEBHOOK_IP_WHITELIST=true`, requests must also originate from `WEBHOOK_ALLOWED_IPS`.

## CORS Behavior
If `CLIENT_ORIGINS` is set, only those origins receive credentialed responses. If not set, the server allows `localhost` and `127.0.0.1` by default for development.

## Utilities and Maintenance
Image downloads (from MongoDB documents):
```bash
cd server
npm run download:images
```

Image manifest export:
```bash
cd server
npm run export:image-manifests
```

Other maintenance scripts live in `server/scripts` and `server/updateProducts.js` and typically require `MONGO_URI` in the environment.

## Database Reference
The file `ecommerce_db_models.json` contains example document shapes for users, products, and orders. It is a reference, not a seed script.

## Notes
- Do not commit real secrets to version control.
- For production, set `CLIENT_ORIGINS` and configure your payment, SMS, and email providers.
- If you only need the catalog and basic auth, you can omit Lahza and SMS-related variables.
