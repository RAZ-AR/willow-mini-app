# Willow Coffee Worker

This directory contains the backend logic for the Willow Coffee Mini App, running on Cloudflare Workers.

## Setup & Deployment

1.  **Install Dependencies**:
    Make sure you have [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed and configured.

2.  **Create D1 Database**:
    If you haven't already, create the D1 database:
    ```sh
    wrangler d1 create willow_coffee
    ```
    Copy the resulting `database_id` into the `d1_databases` section in `wrangler.toml`.

3.  **Apply Schema**:
    Run the schema file to create the necessary tables and seed data:
    ```sh
    wrangler d1 execute willow_coffee --file=./schema.sql
    ```

4.  **Configure Secrets**:
    Set the required secrets for the application to function. You will be prompted to enter each value.
    ```sh
    wrangler secret put BOT_TOKEN
    wrangler secret put ADMIN_BEARER
    wrangler secret put ADMIN_CHANNEL_ID
    ```

5.  **Deploy**:
    Deploy the worker to your Cloudflare account:
    ```sh
    wrangler deploy
    ```

## Webhook

After deploying, you must set the Telegram bot's webhook to point to the worker URL.

-   **Endpoint**: `/tg/webhook`
-   **URL**: `https://<worker_name>.<subdomain>.workers.dev/tg/webhook`

Use the following command, replacing the placeholders:
```sh
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<WORKER_URL>/tg/webhook&allowed_updates=["message","channel_post","callback_query"]"
```
