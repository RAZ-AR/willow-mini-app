# Willow Coffee — Telegram Mini App

This repository contains the source code for the Willow Coffee Telegram Mini App, a complete solution for a coffee shop including a customer-facing app, a backend server, and admin controls.

## About The Project

The application provides a seamless experience for customers to browse the menu, place orders, and participate in a loyalty program directly within Telegram. The backend is built on serverless technologies for scalability and low cost, and the menu is dynamically managed via a Google Sheet.

## Features

*   **Loyalty Program**: Customers earn stars for purchases (`ceil(amount / 350)`) and can redeem them for rewards (e.g., free coffee, breakfast).
*   **Dynamic Menu**: The menu is fetched from a public Google Sheet, allowing for easy updates without redeploying the application. Menu is cached for 60 seconds.
*   **Ordering System**: Users can build a cart, select an ETA (10, 20, or 30 minutes), and place an order. The backend validates prices and calculates totals.
*   **Admin Notifications**: New orders are sent as interactive cards to a private Telegram channel, where admins can mark them as ready, delayed, or canceled.
*   **Customer Notifications**: Customers receive direct messages when their order is ready or canceled.
*   **Offline Accruals**: Admins can add stars or accrue them from an amount for a user via commands (`/addstars`, `/addamount`) in the admin channel.
*   **Secure**: Employs HMAC validation for all Telegram Web App data and a bearer token for admin API endpoints.
*   **Multi-language UI**: Frontend supports English, Russian, and Serbian.

## Tech Stack

*   **Frontend**: GitHub Pages (HTML, CSS, JavaScript + Telegram WebApp SDK)
*   **Backend**: Cloudflare Workers (ES Modules)
*   **Database**: Cloudflare D1 (SQLite)
*   **Menu Source**: Google Sheets (CSV export)

---

## Deployment

### 1. GitHub Pages (Frontend)

The frontend is built with pure HTML, CSS, and JavaScript and is located in the `/docs` directory.

1.  **Create Repository**: Make sure you have created a GitHub repository (e.g., `willow-mini-app`) and pushed the code.
2.  **Configure GitHub Pages**:
    *   Go to your repository's **Settings** tab.
    *   Navigate to the **Pages** section in the left sidebar.
    *   Under "Build and deployment", select **Deploy from a branch** as the source.
    *   Set the branch to **`main`** and the folder to **`/docs`**.
    *   Click **Save**.
3.  **Verify**: After a few minutes, your site should be live at the URL provided by GitHub (e.g., `https://<username>.github.io/willow-mini-app/`). This is your `WEBAPP_URL`.

### 2. Cloudflare Workers (Backend)

The backend is a Cloudflare Worker with a D1 database.

1.  **Install Wrangler**: If you haven't already, install the Cloudflare Wrangler CLI:
    ```bash
    npm install -g wrangler
    ```
2.  **Login to Cloudflare**:
    ```bash
    wrangler login
    ```
3.  **Create D1 Database**:
    ```bash
    wrangler d1 create willow_coffee
    ```
    This command will output the `database_id` and `database_name`. Add this information to `worker/wrangler.toml`.
4.  **Execute Schema**: Apply the database schema and seed the initial data.
    ```bash
    wrangler d1 execute willow_coffee --file=worker/schema.sql
    ```
5.  **Set Secrets**: Configure the necessary secrets for the worker. You will be prompted to enter each value.
    ```bash
    wrangler secret put BOT_TOKEN
    wrangler secret put ADMIN_BEARER
    wrangler secret put ADMIN_CHANNEL_ID
    ```
6.  **Deploy Worker**: Deploy the worker to your Cloudflare account.
    ```bash
    # Navigate to the worker directory first
    cd worker
    wrangler deploy
    ```
    This will output the URL for your worker (e.g., `https://willow-mini-app.<subdomain>.workers.dev`). **You must update `API_BASE_URL` in `docs/app.js` with this URL.**

### 3. Telegram Bot Integration

1.  **Set Webhook**: Point your Telegram bot to the deployed worker's webhook endpoint. Replace `<WORKER_URL>` with the URL from the previous step and `<BOT_TOKEN>` with your bot's token.
    ```bash
    curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<WORKER_URL>/tg/webhook&allowed_updates=["message","channel_post","callback_query"]"
    ```
2.  **Set Bot Commands**: Use BotFather to set the `/start` command for your bot, which will show the "Open App" button.
3.  **Admin Channel**: Create a private Telegram channel for order notifications and admin commands. Add your bot to the channel as an administrator. Get the channel's ID and set it as the `ADMIN_CHANNEL_ID` secret.