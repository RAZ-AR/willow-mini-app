# Willow Coffee Backend

Express.js backend for the Willow Coffee Telegram Mini App.

## Features

- RESTful API for menu, orders, and user management
- PostgreSQL database integration
- Telegram Bot API integration
- Google Sheets menu sync
- Admin panel commands
- Star-based loyalty system

## Local Development

1. Install dependencies:
```bash
cd backend
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your values
```

3. Set up PostgreSQL database and run schema:
```bash
psql -U postgres -d willow_coffee -f database.sql
```

4. Start development server:
```bash
npm run dev
```

## Deployment

### Option 1: Railway (Recommended)

1. Connect your GitHub repo to Railway
2. Set environment variables in Railway dashboard
3. Railway will automatically deploy using `railway.toml`

**Required Environment Variables:**
- `DATABASE_URL` - PostgreSQL connection string
- `BOT_TOKEN` - Telegram bot token
- `ADMIN_BEARER` - Admin API bearer token
- `ADMIN_CHANNEL_ID` - Telegram admin channel ID
- `WEBAPP_URL` - Frontend URL (https://raz-ar.github.io/willow-mini-app/)
- `SHEETS_CSV_URL` - Google Sheets CSV export URL

### Option 2: Render

1. Connect your GitHub repo to Render
2. Use the `render.yaml` configuration
3. Set environment variables in Render dashboard

### Option 3: Heroku

1. Install Heroku CLI
2. Create app: `heroku create willow-coffee`
3. Add PostgreSQL: `heroku addons:create heroku-postgresql:mini`
4. Set environment variables: `heroku config:set BOT_TOKEN=...`
5. Deploy: `git push heroku main`

## API Endpoints

- `GET /api/menu` - Get menu from Google Sheets
- `POST /api/auth/telegram` - Authenticate with Telegram
- `POST /api/order` - Create new order
- `POST /api/redeem` - Redeem loyalty reward
- `POST /api/admin/accrue` - Admin star accrual
- `POST /tg/webhook` - Telegram webhook
- `GET /health` - Health check

## Database Setup

Run the SQL schema in `database.sql` to create tables:

```sql
-- Users, orders, transactions, rewards tables
-- See database.sql for full schema
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

- Database connection
- Telegram bot credentials  
- App URLs and CORS settings
- Google Sheets integration

## Free Hosting Options

1. **Railway** - 500 hours/month free, PostgreSQL included
2. **Render** - 750 hours/month free, PostgreSQL available
3. **Heroku** - Limited free tier with add-ons
4. **Vercel** - Serverless functions (requires adaptation)

All options support PostgreSQL and have GitHub integration for auto-deployment.