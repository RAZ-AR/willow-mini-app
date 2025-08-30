const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Database connection
let pool = null;
if (process.env.DATABASE_URL && process.env.DATABASE_URL !== 'base' && process.env.DATABASE_URL.startsWith('postgres')) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
} else {
    console.log('Running in test mode - no valid DATABASE_URL provided');
}

// Middleware
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'https://raz-ar.github.io',
    credentials: true
}));
app.use(express.json());

// In-memory cache for menu
let menuCache = {
    updated_at: null,
    data: null,
};
const MENU_CACHE_TTL_SECONDS = 60;

// Utility functions
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0; // Convert to 32bit integer
    }
    return 'item-' + Math.abs(hash).toString(16);
}

function parseMenuFromCsv(csvText) {
    const rows = csvText.split('\n').map(r => r.trim()).filter(Boolean);
    const headers = rows.shift().split(',').map(h => h.trim().toLowerCase());
    
    const items = rows.map(row => {
        const values = row.split(',').map(v => v.trim());
        const itemData = headers.reduce((obj, header, index) => {
            obj[header] = values[index];
            return obj;
        }, {});

        const title_en = itemData['английский'];
        const category = itemData['категория'];
        const volume = itemData['объем'];

        return {
            id: simpleHash(category + '|' + title_en + '|' + volume),
            category: category,
            title: {
                en: title_en,
                ru: itemData['русский'],
                sr: itemData['сербский'],
            },
            volume: volume,
            price: parseInt(itemData['стоимость (rsd)'], 10) || 0,
            ingredients: itemData['состав'],
        };
    });

    const categories = [...new Set(items.map(item => item.category))];

    return {
        updated_at: new Date().toISOString(),
        categories,
        items,
    };
}

async function isValidTelegramInitData(initData, botToken) {
    try {
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        params.delete('hash');

        const dataCheckString = Array.from(params.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
        const signature = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        return hash === signature;
    } catch (error) {
        console.error('Telegram validation error:', error);
        return false;
    }
}

async function generateUniqueCardNumber() {
    if (!pool) {
        return Math.floor(1000 + Math.random() * 9000);
    }
    
    while (true) {
        const card_number = Math.floor(1000 + Math.random() * 9000);
        const result = await pool.query('SELECT 1 FROM users WHERE card_number = $1', [card_number]);
        if (result.rows.length === 0) {
            return card_number;
        }
    }
}

function calculateOrderTotal(orderItems, menuItems) {
    let total_amount = 0;
    const validatedItems = [];
    const menuMap = new Map(menuItems.map(i => [i.id, i]));

    for (const item of orderItems) {
        const menuItem = menuMap.get(item.id);
        if (menuItem && item.qty > 0) {
            total_amount += menuItem.price * item.qty;
            // Get item name (use English title by default)
            const itemName = menuItem.title?.en || menuItem.name || 'Unknown item';
            
            validatedItems.push({
                id: item.id,
                name: itemName,
                quantity: item.qty,
                unit_price: menuItem.price,
                price: menuItem.price,
            });
        }
    }
    return { total_amount, validatedItems };
}

async function sendTelegram(method, token, body) {
    const fetch = (await import('node-fetch')).default;
    return fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

// API Routes

// GET /api/menu
app.get('/api/menu', async (req, res) => {
    try {
        const now = Date.now();
        if (menuCache.updated_at && (now - menuCache.updated_at) / 1000 < MENU_CACHE_TTL_SECONDS) {
            return res.json(menuCache.data);
        }

        const fetch = (await import('node-fetch')).default;
        const response = await fetch(process.env.SHEETS_CSV_URL);
        if (!response.ok) {
            throw new Error(`Failed to fetch CSV: ${response.statusText}`);
        }
        const csvText = await response.text();
        const parsedMenu = parseMenuFromCsv(csvText);

        menuCache = {
            updated_at: now,
            data: parsedMenu,
        };

        res.json(parsedMenu);
    } catch (error) {
        console.error('Error fetching/parsing menu:', error);
        res.status(500).json({ error: 'Could not fetch menu' });
    }
});

// POST /api/auth/telegram
app.post('/api/auth/telegram', async (req, res) => {
    try {
        const { initData } = req.body;
        if (!initData) {
            return res.status(400).json({ error: 'initData is required' });
        }

        // Skip auth validation if BOT_TOKEN is not configured (for testing)
        // Also allow "test" initData for testing purposes
        if (process.env.BOT_TOKEN && initData !== 'test') {
            const isValid = await isValidTelegramInitData(initData, process.env.BOT_TOKEN);
            if (!isValid) {
                return res.status(403).json({ error: 'Invalid initData' });
            }
        }

        const params = new URLSearchParams(initData);
        let user;
        
        // Use mock user if BOT_TOKEN is not configured or initData is "test" (for testing)
        if (!process.env.BOT_TOKEN || initData === 'test') {
            user = {
                id: 123456789,
                first_name: "Test",
                last_name: "User",
                username: "testuser",
                language_code: "en"
            };
        } else {
            user = JSON.parse(params.get('user'));
        }

        let dbUser;
        
        // Skip database operations if in test mode or no DATABASE_URL
        if (initData === 'test' || !pool) {
            console.log('Test mode: Using mock user data');
            const card_number = await generateUniqueCardNumber();
            dbUser = {
                telegram_id: user.id,
                first_name: user.first_name,
                last_name: user.last_name,
                username: user.username,
                stars: 10,
                card_number: card_number
            };
            
            // Add card to Google Sheets in test mode
            await addCardToSheets(dbUser);
        } else {
            dbUser = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [user.id]);
            dbUser = dbUser.rows[0];

            if (!dbUser) {
                const card_number = await generateUniqueCardNumber();
                const result = await pool.query(
                    'INSERT INTO users (telegram_id, first_name, last_name, username, language_code, card_number) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
                    [user.id, user.first_name, user.last_name || null, user.username || null, user.language_code || 'en', card_number]
                );
                dbUser = result.rows[0];
                
                // Add card to Google Sheets
                await addCardToSheets(dbUser);
            }
        }

        res.json(dbUser);
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

// POST /api/order
app.post('/api/order', async (req, res) => {
    try {
        console.log('=== Order Request ===');
        console.log('Request body:', JSON.stringify(req.body, null, 2));
        
        const { initData, items, eta_minutes, table_number, payment_method } = req.body;

        console.log('Extracted values:', { initData, items, eta_minutes, table_number, payment_method });

        if (!initData || !items || !eta_minutes || !Array.isArray(items) || items.length === 0) {
            console.log('Missing required fields validation failed');
            return res.status(400).json({ error: 'Missing required fields' });
        }
        if (![0, 10, 20].includes(eta_minutes)) {
            return res.status(400).json({ error: 'Invalid ETA' });
        }
        if (!table_number || (table_number !== 'takeaway' && (!Number.isInteger(parseInt(table_number)) || parseInt(table_number) < 1 || parseInt(table_number) > 10))) {
            return res.status(400).json({ error: 'Invalid table number' });
        }
        if (!['cash', 'stars'].includes(payment_method)) {
            return res.status(400).json({ error: 'Invalid payment method' });
        }

        // Skip auth validation if BOT_TOKEN is not configured (for testing)
        // Also allow "test" initData for testing purposes
        if (process.env.BOT_TOKEN && initData !== 'test') {
            const isValid = await isValidTelegramInitData(initData, process.env.BOT_TOKEN);
            if (!isValid) {
                return res.status(403).json({ error: 'Invalid initData' });
            }
        }

        const params = new URLSearchParams(initData);
        let user;
        
        // Use mock user if BOT_TOKEN is not configured or initData is "test" (for testing)
        if (!process.env.BOT_TOKEN || initData === 'test') {
            user = {
                id: 123456789,
                first_name: "Test",
                last_name: "User",
                username: "testuser",
                language_code: "en"
            };
        } else {
            user = JSON.parse(params.get('user'));
        }

        // Get fresh menu data
        const now = Date.now();
        if (!menuCache.updated_at || (now - menuCache.updated_at) / 1000 >= MENU_CACHE_TTL_SECONDS) {
            const fetch = (await import('node-fetch')).default;
            const response = await fetch(process.env.SHEETS_CSV_URL);
            if (response.ok) {
                const csvText = await response.text();
                menuCache = {
                    updated_at: now,
                    data: parseMenuFromCsv(csvText),
                };
            }
        }

        if (!menuCache.data || !menuCache.data.items) {
            return res.status(503).json({ error: 'Menu is currently unavailable' });
        }

        const { total_amount, validatedItems } = calculateOrderTotal(items, menuCache.data.items);
        if (total_amount === 0) {
            return res.status(400).json({ error: 'Invalid items or quantities' });
        }

        const stars_added = Math.ceil(total_amount / 350);
        const order_id = crypto.randomUUID();
        const short_id = order_id.split('-')[0].toUpperCase();
        const due_at = new Date(Date.now() + eta_minutes * 60 * 1000).toISOString();

        let dbUser;
        
        // Skip database operations if in test mode or no DATABASE_URL
        if (initData === 'test' || !pool) {
            console.log('Test mode: Skipping database operations');
            dbUser = { rows: [{ stars: 10 }] }; // Mock user with 10 stars
        } else {
            // Database transaction
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // Insert order
                await client.query(
                    'INSERT INTO orders (id, short_id, user_id, total_amount, stars_added, eta_minutes, due_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                    [order_id, short_id, user.id, total_amount, stars_added, eta_minutes, due_at]
                );

                // Update user stars
                await client.query('UPDATE users SET stars = stars + $1 WHERE telegram_id = $2', [stars_added, user.id]);

                // Insert transaction
                await client.query(
                    'INSERT INTO transactions (id, user_id, type, stars_change, order_id, description) VALUES ($1, $2, $3, $4, $5, $6)',
                    [crypto.randomUUID(), user.id, 'accrual', stars_added, order_id, `Order ${short_id}`]
                );

                // Insert order items
                for (const item of validatedItems) {
                    await client.query(
                        'INSERT INTO order_items (id, order_id, item_id, quantity, unit_price) VALUES ($1, $2, $3, $4, $5)',
                        [crypto.randomUUID(), order_id, item.id, item.quantity, item.unit_price]
                    );
                }

                await client.query('COMMIT');
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }

            dbUser = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [user.id]);
        }

        // Notify admin channel (if configured) - MOVED OUTSIDE DATABASE BLOCK
        console.log('Checking Telegram notification config:', {
            hasAdminChannelId: !!process.env.ADMIN_CHANNEL_ID,
            hasBotToken: !!process.env.BOT_TOKEN,
            adminChannelId: process.env.ADMIN_CHANNEL_ID,
            botTokenLength: process.env.BOT_TOKEN?.length
        });
        
        if (process.env.ADMIN_CHANNEL_ID && process.env.BOT_TOKEN) {
            try {
                const orderData = {
                    order_id,
                    short_id,
                    user,
                    eta_minutes,
                    due_at,
                    total_amount,
                    stars_added,
                    items: validatedItems,
                    table_number,
                    payment_method,
                };
                console.log('Sending Telegram notification for order:', short_id);
                await notifyAdminChannel(orderData);
                console.log('Admin notification sent successfully');
                
                // Send personal notification to customer (skip for test users)
                if (initData !== 'test') {
                    try {
                        await notifyCustomer(orderData);
                        console.log('Customer notification sent successfully');
                    } catch (customerNotifyError) {
                        console.error('Failed to notify customer:', customerNotifyError);
                    }
                } else {
                    console.log('Skipping customer notification - test mode');
                }
            } catch (notifyError) {
                console.error('Failed to notify admin:', notifyError);
            }
        } else {
            console.log('Skipping Telegram notification - missing BOT_TOKEN or ADMIN_CHANNEL_ID');
        }

        res.json({
            ok: true,
            order_id,
            due_at,
            eta_minutes,
            total_amount,
            stars_added,
            new_stars: dbUser.rows[0].stars,
        });
    } catch (error) {
        console.error('=== Order creation error ===');
        console.error('Error details:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({ error: 'Failed to create order' });
    }
});

// POST /api/redeem
app.post('/api/redeem', async (req, res) => {
    try {
        if (!pool) {
            return res.status(503).json({ error: 'Service in test mode - rewards not available' });
        }
        
        const { telegram_id, rewardKey } = req.body;
        if (!telegram_id || !rewardKey) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const reward = await pool.query('SELECT * FROM rewards WHERE key = $1', [rewardKey]);
        if (reward.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid reward key' });
        }

        const user = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegram_id]);
        if (user.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const rewardData = reward.rows[0];
        const userData = user.rows[0];

        if (userData.stars < rewardData.stars_cost) {
            return res.status(400).json({ error: 'NOT_ENOUGH_STARS' });
        }

        const new_total = userData.stars - rewardData.stars_cost;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            await client.query('UPDATE users SET stars = $1 WHERE telegram_id = $2', [new_total, telegram_id]);
            await client.query(
                'INSERT INTO transactions (id, user_id, type, stars_change, reward_key, description) VALUES ($1, $2, $3, $4, $5, $6)',
                [crypto.randomUUID(), telegram_id, 'redeem', -rewardData.stars_cost, rewardKey, `Redeemed ${rewardData.title}`]
            );
            
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

        res.json({ ok: true, new_total });
    } catch (error) {
        console.error('Redemption error:', error);
        res.status(500).json({ error: 'Failed to redeem reward' });
    }
});

// POST /api/admin/accrue
app.post('/api/admin/accrue', async (req, res) => {
    try {
        if (!pool) {
            return res.status(503).json({ error: 'Service in test mode - admin features not available' });
        }
        
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_BEARER}`) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { by, id, amount, stars } = req.body;
        if (!by || !id || (!amount && !stars)) {
            return res.status(400).json({ error: 'Missing params' });
        }

        let user;
        if (by === 'card') {
            const result = await pool.query('SELECT * FROM users WHERE card_number = $1', [id]);
            user = result.rows[0];
        } else if (by === 'username') {
            const result = await pool.query('SELECT * FROM users WHERE username = $1', [id]);
            user = result.rows[0];
        } else if (by === 'telegram_id') {
            const result = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [id]);
            user = result.rows[0];
        } else {
            return res.status(400).json({ error: "Invalid 'by' parameter" });
        }

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const stars_to_add = stars ? parseInt(stars, 10) : Math.ceil(parseInt(amount, 10) / 350);
        const description = stars ? `Admin manual add: ${stars} stars` : `Admin amount accrual: ${amount} RSD`;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            await client.query('UPDATE users SET stars = stars + $1 WHERE telegram_id = $2', [stars_to_add, user.telegram_id]);
            await client.query(
                'INSERT INTO transactions (id, user_id, type, stars_change, description) VALUES ($1, $2, $3, $4, $5)',
                [crypto.randomUUID(), user.telegram_id, 'accrual', stars_to_add, description]
            );
            
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

        const updatedUser = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [user.telegram_id]);

        res.json({ ok: true, user: updatedUser.rows[0] });
    } catch (error) {
        console.error('Admin accrue error:', error);
        res.status(500).json({ error: 'Failed to accrue stars' });
    }
});

// Telegram webhook handler
app.post('/tg/webhook', async (req, res) => {
    try {
        const update = req.body;
        console.log('=== Telegram Webhook Update ===');
        console.log(JSON.stringify(update, null, 2));

        if (update.message) {
            console.log('Message from chat:', update.message.chat.id, update.message.chat.type);
            await handleMessage(update.message);
        } else if (update.channel_post) {
            console.log('Channel post from:', update.channel_post.chat.id, update.channel_post.chat.type);
            await handleChannelPost(update.channel_post);
        } else if (update.callback_query) {
            await handleCallbackQuery(update.callback_query);
        }

        res.send('OK');
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).send('Error');
    }
});

async function handleMessage(message) {
    const text = message.text;
    const chatId = message.chat.id;

    if (text === '/start') {
        await sendTelegram('sendMessage', process.env.BOT_TOKEN, {
            chat_id: chatId,
            text: 'Welcome to Willow Coffee! Click below to open the app.',
            reply_markup: {
                inline_keyboard: [[{ text: '☕ Open App', web_app: { url: process.env.WEBAPP_URL } }]],
            },
        });
    } else if (text === '/mycard') {
        if (!pool) {
            await sendTelegram('sendMessage', process.env.BOT_TOKEN, { chat_id: chatId, text: 'Service is in test mode. Open the app to see your card!' });
        } else {
            const result = await pool.query('SELECT card_number FROM users WHERE telegram_id = $1', [chatId]);
            const cardText = result.rows.length > 0 
                ? `Your loyalty card number is: ${result.rows[0].card_number}` 
                : 'You don\'t have a card yet. Open the app to get one!';
            await sendTelegram('sendMessage', process.env.BOT_TOKEN, { chat_id: chatId, text: cardText });
        }
    }
}

async function handleChannelPost(post) {
    if (post.chat.id.toString() !== process.env.ADMIN_CHANNEL_ID?.toString()) return;

    const text = post.text;
    if (!text) return;

    const [command, id, value] = text.split(' ');
    if (!['/addamount', '/addstars'].includes(command) || !id || !value) return;

    const by = id.startsWith('@') ? 'username' : 'card';
    const identifier = id.startsWith('@') ? id.substring(1) : parseInt(id, 10);

    const accruePayload = { by, id: identifier };
    if (command === '/addamount') {
        accruePayload.amount = parseInt(value, 10);
    } else {
        accruePayload.stars = parseInt(value, 10);
    }

    try {
        const req = { 
            body: accruePayload, 
            headers: { authorization: `Bearer ${process.env.ADMIN_BEARER}` } 
        };
        const res = { 
            json: (data) => data,
            status: (code) => ({ json: (data) => ({ statusCode: code, data }) })
        };
        
        const result = await req.json();
        
        let replyText;
        if (result.ok) {
            replyText = `✅ Success! User @${result.user.username} (Card: ${result.user.card_number}) now has ${result.user.stars} stars.`;
        } else {
            replyText = `❌ Error: ${result.error || 'Unknown error'}`;
        }
        
        await sendTelegram('sendMessage', process.env.BOT_TOKEN, { 
            chat_id: post.chat.id, 
            text: replyText, 
            reply_to_message_id: post.message_id 
        });
    } catch (error) {
        console.error('Channel post handler error:', error);
        await sendTelegram('sendMessage', process.env.BOT_TOKEN, { 
            chat_id: post.chat.id, 
            text: `❌ Error: ${error.message}`, 
            reply_to_message_id: post.message_id 
        });
    }
}

async function handleCallbackQuery(callbackQuery) {
    // Implementation for order status updates would go here
    // This is complex and requires order management UI
}

async function notifyAdminChannel(orderData) {
    const { short_id, user, eta_minutes, total_amount, stars_added, items, table_number, payment_method } = orderData;
    
    // Format ETA
    const etaText = eta_minutes === 0 ? 'Now' : `${eta_minutes} minutes`;
    
    // Format table
    const tableText = table_number === 'takeaway' ? 'Takeaway' : `Table ${table_number}`;
    
    // Format payment method
    const paymentText = payment_method === 'cash' ? 'Cash' : `Stars (${Math.ceil(total_amount / 350)} ⭐)`;
    
    // Format items
    const itemsList = items.map(item => `• ${item.name} x${item.quantity} - ${item.price} RSD`).join('\n');
    
    // Build notification message
    const message = `🍽️ **NEW ORDER #${short_id}**

👤 **Customer:** ${user.first_name} ${user.last_name || ''}
📱 **Telegram:** @${user.username || 'N/A'}
📍 **Location:** ${tableText}
⏰ **ETA:** ${etaText}
💳 **Payment:** ${paymentText}

📋 **Order Details:**
${itemsList}

💰 **Total:** ${total_amount} RSD
⭐ **Stars Earned:** ${stars_added}

#order #${table_number === 'takeaway' ? 'takeaway' : 'table' + table_number}`;

    await sendTelegram('sendMessage', process.env.BOT_TOKEN, {
        chat_id: process.env.ADMIN_CHANNEL_ID,
        text: message,
        parse_mode: 'Markdown',
    });
}

// Customer notification translations
const customerNotificationTexts = {
    en: {
        title: '☕ **Thank you for your order!**',
        orderNumber: '🎫 **Order #',
        yourItems: '📋 **Your Items:**',
        readyIn: '⏰ **Ready in:**',
        payment: '💳 **Payment:**',
        total: '💰 **Total:**',
        starsEarned: '⭐ **Stars Earned:**',
        footer: 'We\'ll start preparing your order shortly. Thank you for choosing Willow Coffee! ☕',
        takeaway: 'Takeaway',
        table: 'Table',
        now: 'Now',
        minutes: 'minutes',
        cash: 'Cash',
        stars: 'Stars'
    },
    ru: {
        title: '☕ **Спасибо за ваш заказ!**',
        orderNumber: '🎫 **Заказ №',
        yourItems: '📋 **Ваши товары:**',
        readyIn: '⏰ **Будет готов через:**',
        payment: '💳 **Оплата:**',
        total: '💰 **Итого:**',
        starsEarned: '⭐ **Звёзд получено:**',
        footer: 'Мы скоро начнём готовить ваш заказ. Спасибо, что выбрали Willow Coffee! ☕',
        takeaway: 'На вынос',
        table: 'Столик',
        now: 'Сейчас',
        minutes: 'минут',
        cash: 'Наличные',
        stars: 'Звёзды'
    },
    sr: {
        title: '☕ **Hvala Vam na porudžbini!**',
        orderNumber: '🎫 **Narudžba #',
        yourItems: '📋 **Vaše stavke:**',
        readyIn: '⏰ **Spremno za:**',
        payment: '💳 **Plaćanje:**',
        total: '💰 **Ukupno:**',
        starsEarned: '⭐ **Zvezda dobijeno:**',
        footer: 'Uskoro počinjemo sa pripremom. Hvala što ste izabrali Willow Coffee! ☕',
        takeaway: 'Za poneti',
        table: 'Sto',
        now: 'Sada',
        minutes: 'minuta',
        cash: 'Gotovina',
        stars: 'Zvezde'
    }
};

async function notifyCustomer(orderData) {
    const { short_id, user, eta_minutes, total_amount, stars_added, items, table_number, payment_method } = orderData;
    
    // Determine user's language (default to English)
    const userLang = user.language_code === 'ru' ? 'ru' : user.language_code === 'sr' ? 'sr' : 'en';
    const t = customerNotificationTexts[userLang];
    
    // Format ETA
    const etaText = eta_minutes === 0 ? t.now : `${eta_minutes} ${t.minutes}`;
    
    // Format table
    const tableText = table_number === 'takeaway' ? t.takeaway : `${t.table} ${table_number}`;
    
    // Format payment method  
    const paymentText = payment_method === 'cash' ? t.cash : `${t.stars} (${Math.ceil(total_amount / 350)} ⭐)`;
    
    // Format items
    const itemsList = items.map(item => `• ${item.name} x${item.quantity} - ${item.price} RSD`).join('\n');
    
    // Build customer notification message
    const message = `${t.title}

${t.orderNumber}${short_id}**

${t.yourItems}
${itemsList}

📍 **${tableText}**
${t.readyIn} ${etaText}
${t.payment} ${paymentText}

${t.total} ${total_amount} RSD
${t.starsEarned} +${stars_added} ⭐

${t.footer}`;

    // Send to customer's private chat
    await sendTelegram('sendMessage', process.env.BOT_TOKEN, {
        chat_id: user.id,
        text: message,
        parse_mode: 'Markdown',
    });
}

// Function to add card to Google Sheets Cards tab
async function addCardToSheets(cardData) {
    try {
        if (!process.env.SHEETS_CARDS_WEBHOOK_URL) {
            console.log('SHEETS_CARDS_WEBHOOK_URL not configured - skipping Google Sheets card registration');
            return;
        }

        const fetch = (await import('node-fetch')).default;
        const response = await fetch(process.env.SHEETS_CARDS_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                id: cardData.telegram_id,
                card: cardData.card_number,
                name: `${cardData.first_name} ${cardData.last_name || ''}`.trim(),
                telegram: cardData.username || cardData.telegram_id
            })
        });

        if (response.ok) {
            console.log('Card successfully added to Google Sheets:', cardData.card_number);
        } else {
            console.error('Failed to add card to Google Sheets:', response.statusText);
        }
    } catch (error) {
        console.error('Error adding card to Google Sheets:', error);
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Debug config endpoint
app.get('/debug/config', (req, res) => {
    res.json({
        hasAdminChannelId: !!process.env.ADMIN_CHANNEL_ID,
        adminChannelId: process.env.ADMIN_CHANNEL_ID,
        hasBotToken: !!process.env.BOT_TOKEN,
        botTokenLength: process.env.BOT_TOKEN?.length,
        hasSheetsCardsUrl: !!process.env.SHEETS_CARDS_WEBHOOK_URL,
        hasDatabase: !!process.env.DATABASE_URL,
        databaseUrl: process.env.DATABASE_URL,
        hasPool: !!pool,
        testMode: !process.env.DATABASE_URL || process.env.DATABASE_URL === 'base'
    });
});

// Start server
app.listen(port, () => {
    console.log(`Willow Coffee backend running on port ${port}`);
});

module.exports = app;