// src/worker.js

const CORS_ORIGIN = 'https://raz-ar.github.io';
const MENU_CACHE_TTL_SECONDS = 60;

// In-memory cache for the menu
let menuCache = {
	updated_at: null,
	data: null,
};

/**
 * Simple router for handling requests.
 */
class Router {
	constructor() {
		this.routes = [];
	}

	add(method, path, handler) {
		this.routes.push({ method, path, handler });
		return this;
	}

	async route(request, env, ctx) {
		const url = new URL(request.url);
		for (const route of this.routes) {
			if (request.method === route.method && url.pathname === route.path) {
				return await route.handler(request, env, ctx);
			}
		}
		return new Response('Not Found', { status: 404 });
	}
}

// =================================================================================
// API Handlers
// =================================================================================

/**
 * GET /api/menu
 * Fetches the menu from a Google Sheet, normalizes it, and caches it.
 */
async function handleGetMenu(request, env) {
	const now = Date.now();
	if (menuCache.updated_at && (now - menuCache.updated_at) / 1000 < MENU_CACHE_TTL_SECONDS) {
		return jsonResponse(menuCache.data, { 'Cache-Control': `public, max-age=${MENU_CACHE_TTL_SECONDS}` });
	}

	try {
		const response = await fetch(env.SHEETS_CSV_URL);
		if (!response.ok) {
			throw new Error(`Failed to fetch CSV: ${response.statusText}`);
		}
		const csvText = await response.text();
		const parsedMenu = parseMenuFromCsv(csvText);

		menuCache = {
			updated_at: now,
			data: parsedMenu,
		};

		return jsonResponse(parsedMenu, { 'Cache-Control': `public, max-age=${MENU_CACHE_TTL_SECONDS}` });
	} catch (error) {
		console.error('Error fetching/parsing menu:', error);
		return jsonResponse({ error: 'Could not fetch menu' }, { status: 500 });
	}
}

/**
 * POST /api/auth/telegram
 * Validates Telegram initData and returns user profile.
 */
async function handleAuth(request, env) {
	const { initData } = await request.json();
	if (!initData) {
		return jsonResponse({ error: 'initData is required' }, { status: 400 });
	}

	const isValid = await isValidTelegramInitData(initData, env.BOT_TOKEN);
	if (!isValid) {
		return jsonResponse({ error: 'Invalid initData' }, { status: 403 });
	}

	const params = new URLSearchParams(initData);
	const user = JSON.parse(params.get('user'));

	let dbUser = await env.DB.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(user.id).first();

	if (!dbUser) {
		const card_number = await generateUniqueCardNumber(env.DB);
		const { results } = await env.DB.prepare(
			'INSERT INTO users (telegram_id, first_name, last_name, username, language_code, card_number) VALUES (?, ?, ?, ?, ?, ?) RETURNING *'
		)
			.bind(user.id, user.first_name, user.last_name || null, user.username || null, user.language_code || 'en', card_number)
			.run();
		dbUser = results.length > 0 ? results[0] : null;
	}

	return jsonResponse(dbUser);
}

/**
 * POST /api/order
 * Creates a new order.
 */
async function handleCreateOrder(request, env) {
	const { initData, items, eta_minutes } = await request.json();

	if (!initData || !items || !eta_minutes || !Array.isArray(items) || items.length === 0) {
		return jsonResponse({ error: 'Missing required fields' }, { status: 400 });
	}
	if (![10, 20, 30].includes(eta_minutes)) {
		return jsonResponse({ error: 'Invalid ETA' }, { status: 400 });
	}

	const isValid = await isValidTelegramInitData(initData, env.BOT_TOKEN);
	if (!isValid) {
		return jsonResponse({ error: 'Invalid initData' }, { status: 403 });
	}

	const params = new URLSearchParams(initData);
	const user = JSON.parse(params.get('user'));

	// Fetch fresh menu data (from cache or source)
	await handleGetMenu(request, env);
	const menu = menuCache.data;
	if (!menu || !menu.items) {
		return jsonResponse({ error: 'Menu is currently unavailable' }, { status: 503 });
	}

	const { total_amount, validatedItems } = calculateOrderTotal(items, menu.items);
	if (total_amount === 0) {
		return jsonResponse({ error: 'Invalid items or quantities' }, { status: 400 });
	}

	const stars_added = Math.ceil(total_amount / 350);
	const order_id = crypto.randomUUID();
    const short_id = order_id.split('-')[0].toUpperCase();
	const due_at = new Date(Date.now() + eta_minutes * 60 * 1000).toISOString();

	// DB Operations
	const batch = [
		env.DB.prepare(
			'INSERT INTO orders (id, short_id, user_id, total_amount, stars_added, eta_minutes, due_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
		).bind(order_id, short_id, user.id, total_amount, stars_added, eta_minutes, due_at),
		env.DB.prepare('UPDATE users SET stars = stars + ? WHERE telegram_id = ?').bind(stars_added, user.id),
		env.DB.prepare(
			'INSERT INTO transactions (id, user_id, type, stars_change, order_id, description) VALUES (?, ?, ?, ?, ?, ?)'
		).bind(crypto.randomUUID(), user.id, 'accrual', stars_added, order_id, `Order ${short_id}`),
		...validatedItems.map(item =>
			env.DB.prepare('INSERT INTO order_items (id, order_id, item_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?)').bind(
				crypto.randomUUID(),
				order_id,
				item.id,
				item.quantity,
				item.unit_price
			)
		),
	];
	await env.DB.batch(batch);

	const dbUser = await env.DB.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(user.id).first();

	// Notify admin channel
	await notifyAdminChannel(env, {
		order_id,
		short_id,
		user,
		eta_minutes,
		due_at,
		total_amount,
		stars_added,
		items: validatedItems,
		menuItems: menu.items,
	});

	return jsonResponse({
		ok: true,
		order_id,
		due_at,
		eta_minutes,
		total_amount,
		stars_added,
		new_stars: dbUser.stars,
	});
}

/**
 * POST /api/redeem
 * Redeems a reward for stars.
 */
async function handleRedeem(request, env) {
    const { telegram_id, rewardKey } = await request.json();
    if (!telegram_id || !rewardKey) {
        return jsonResponse({ error: 'Missing required fields' }, { status: 400 });
    }

    const reward = await env.DB.prepare('SELECT * FROM rewards WHERE key = ?').bind(rewardKey).first();
    if (!reward) {
        return jsonResponse({ error: 'Invalid reward key' }, { status: 400 });
    }

    const user = await env.DB.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(telegram_id).first();
    if (!user) {
        return jsonResponse({ error: 'User not found' }, { status: 404 });
    }

    if (user.stars < reward.stars_cost) {
        return jsonResponse({ error: 'NOT_ENOUGH_STARS' }, { status: 400 });
    }

    const new_total = user.stars - reward.stars_cost;

    const batch = [
        env.DB.prepare('UPDATE users SET stars = ? WHERE telegram_id = ?').bind(new_total, telegram_id),
        env.DB.prepare('INSERT INTO transactions (id, user_id, type, stars_change, reward_key, description) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(crypto.randomUUID(), telegram_id, 'redeem', -reward.stars_cost, rewardKey, `Redeemed ${reward.title}`)
    ];
    await env.DB.batch(batch);

    return jsonResponse({ ok: true, new_total });
}


/**
 * POST /api/admin/accrue
 * Admin endpoint to add stars or accrue from an amount.
 */
async function handleAdminAccrue(request, env) {
	const authHeader = request.headers.get('Authorization');
	if (!authHeader || authHeader !== `Bearer ${env.ADMIN_BEARER}`) {
		return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
	}

	const { by, id, amount, stars } = await request.json();
	if (!by || !id || (!amount && !stars)) {
		return jsonResponse({ error: 'Missing params' }, { status: 400 });
	}

	let user;
	if (by === 'card') {
		user = await env.DB.prepare('SELECT * FROM users WHERE card_number = ?').bind(id).first();
	} else if (by === 'username') {
		user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(id).first();
	} else if (by === 'telegram_id') {
		user = await env.DB.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(id).first();
	} else {
		return jsonResponse({ error: "Invalid 'by' parameter" }, { status: 400 });
	}

	if (!user) {
		return jsonResponse({ error: 'User not found' }, { status: 404 });
	}

	const stars_to_add = stars ? parseInt(stars, 10) : Math.ceil(parseInt(amount, 10) / 350);
	const description = stars ? `Admin manual add: ${stars} stars` : `Admin amount accrual: ${amount} RSD`;

	await env.DB.batch([
		env.DB.prepare('UPDATE users SET stars = stars + ? WHERE telegram_id = ?').bind(stars_to_add, user.telegram_id),
		env.DB.prepare('INSERT INTO transactions (id, user_id, type, stars_change, description) VALUES (?, ?, ?, ?, ?)').bind(
			crypto.randomUUID(),
			user.telegram_id,
			'accrual',
			stars_to_add,
			description
		),
	]);

	const updatedUser = await env.DB.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(user.telegram_id).first();

	return jsonResponse({ ok: true, user: updatedUser });
}

/**
 * POST /tg/webhook
 * Handles incoming updates from the Telegram bot.
 */
async function handleWebhook(request, env) {
	const update = await request.json();

	if (update.message) {
		await handleMessage(update.message, env);
	} else if (update.channel_post) {
		await handleChannelPost(update.channel_post, env);
	} else if (update.callback_query) {
		await handleCallbackQuery(update.callback_query, env);
	}

	return new Response('OK');
}

// =================================================================================
// Telegram Webhook Handlers
// =================================================================================

async function handleMessage(message, env) {
	const text = message.text;
	const chatId = message.chat.id;

	if (text === '/start') {
		await sendTelegram('sendMessage', env.BOT_TOKEN, {
			chat_id: chatId,
			text: 'Welcome to Willow Coffee! Click below to open the app.',
			reply_markup: {
				inline_keyboard: [[{ text: '☕ Open App', web_app: { url: env.WEBAPP_URL } }]],
			},
		});
	} else if (text === '/mycard') {
		const user = await env.DB.prepare('SELECT card_number FROM users WHERE telegram_id = ?').bind(chatId).first();
		const cardText = user ? `Your loyalty card number is: ${user.card_number}` : 'You don\'t have a card yet. Open the app to get one!';
		await sendTelegram('sendMessage', env.BOT_TOKEN, { chat_id: chatId, text: cardText });
	}
}

async function handleChannelPost(post, env) {
	if (post.chat.id.toString() !== env.ADMIN_CHANNEL_ID.toString()) return;

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

	// Mock a request to our own admin endpoint
	const request = new Request(`https://worker.local/api/admin/accrue`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.ADMIN_BEARER}` },
		body: JSON.stringify(accruePayload),
	});

	const response = await handleAdminAccrue(request, env);
	const result = await response.json();

	let replyText;
	if (response.ok) {
		replyText = `✅ Success! User @${result.user.username} (Card: ${result.user.card_number}) now has ${result.user.stars} stars.`;
	} else {
		replyText = `❌ Error: ${result.error}`;
	}
	await sendTelegram('sendMessage', env.BOT_TOKEN, { chat_id: post.chat.id, text: replyText, reply_to_message_id: post.message_id });
}

async function handleCallbackQuery(callbackQuery, env) {
	const [action, type, id] = callbackQuery.data.split(':');
	if (action !== 'order') return;

	const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
	if (!order) {
		await sendTelegram('answerCallbackQuery', env.BOT_TOKEN, { callback_query_id: callbackQuery.id, text: 'Order not found!' });
		return;
	}

	let newStatus, newDueAt, dmText, replyText;

	switch (type) {
		case 'ready':
			newStatus = 'ready';
			await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind(newStatus, id).run();
			replyText = `✅ Order ${order.short_id} marked as Ready.`;
			dmText = {
				en: 'Your order is ready for pickup!',
				ru: 'Ваш заказ готов к выдаче!',
				sr: 'Vaša narudžba je spremna za preuzimanje!',
			};
			break;

		case 'delay10':
			newDueAt = new Date(new Date(order.due_at).getTime() + 10 * 60 * 1000).toISOString();
			await env.DB.prepare('UPDATE orders SET due_at = ? WHERE id = ?').bind(newDueAt, id).run();
			replyText = `➕ Order ${order.short_id} delayed by 10 minutes. New ETA: ${new Date(newDueAt).toLocaleTimeString('en-GB')}`;
			break;

		case 'cancel':
			newStatus = 'canceled';
			await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind(newStatus, id).run();
			replyText = `⛔️ Order ${order.short_id} has been canceled.`;
			dmText = {
				en: 'Unfortunately, your order has been canceled.',
				ru: 'К сожалению, ваш заказ был отменен.',
				sr: 'Nažalost, vaša narudžba je otkazana.',
			};
			break;
	}

	// Send DM to customer if needed
	if (dmText) {
		const user = await env.DB.prepare('SELECT language_code FROM users WHERE telegram_id = ?').bind(order.user_id).first();
		const lang = user.language_code && dmText[user.language_code] ? user.language_code : 'en';
		await sendTelegram('sendMessage', env.BOT_TOKEN, { chat_id: order.user_id, text: dmText[lang] });
	}

	// Update the original message card
	const updatedOrder = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
	const card = await buildOrderCard(env, updatedOrder);
	await sendTelegram('editMessageText', env.BOT_TOKEN, {
		chat_id: callbackQuery.message.chat.id,
		message_id: callbackQuery.message.message_id,
		text: card.text,
		reply_markup: card.reply_markup,
		parse_mode: 'Markdown',
	});

	await sendTelegram('answerCallbackQuery', env.BOT_TOKEN, { callback_query_id: callbackQuery.id, text: replyText });
}

// =================================================================================
// Cron Job (Scheduled)
// =================================================================================

async function handleScheduled(event, env, ctx) {
	const now = new Date().toISOString();
	const { results } = await env.DB.prepare(
		"SELECT * FROM orders WHERE status = 'pending' AND due_at <= ? AND notified = FALSE"
	).bind(now).all();

	if (results && results.length > 0) {
		for (const order of results) {
			await env.DB.prepare("UPDATE orders SET status = 'overdue', notified = TRUE WHERE id = ?").bind(order.id).run();

			const comment = `❗️ Overdue: Order #${order.short_id} was due at ${new Date(order.due_at).toLocaleTimeString('en-GB')}.`;
			
			// Find the original message to reply to. This is a bit tricky without storing message_id.
			// For now, we just post a new message to the channel.
			// A better implementation would store the admin channel message_id with the order.
			await sendTelegram('sendMessage', env.BOT_TOKEN, {
				chat_id: env.ADMIN_CHANNEL_ID,
				text: comment,
			});
		}
	}
}


// =================================================================================
// Utility & Helper Functions
// =================================================================================

/**
 * Parses CSV text from Google Sheets into a structured menu object.
 */
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

/**
 * Calculates the total order amount based on server-side menu prices.
 */
function calculateOrderTotal(orderItems, menuItems) {
	let total_amount = 0;
	const validatedItems = [];
	const menuMap = new Map(menuItems.map(i => [i.id, i]));

	for (const item of orderItems) {
		const menuItem = menuMap.get(item.id);
		if (menuItem && item.qty > 0) {
			total_amount += menuItem.price * item.qty;
			validatedItems.push({
				id: item.id,
				quantity: item.qty,
				unit_price: menuItem.price,
			});
		}
	}
	return { total_amount, validatedItems };
}

/**
 * Generates a unique 4-digit card number.
 */
async function generateUniqueCardNumber(db) {
	while (true) {
		const card_number = Math.floor(1000 + Math.random() * 9000);
		const existing = await db.prepare('SELECT 1 FROM users WHERE card_number = ?').bind(card_number).first();
		if (!existing) {
			return card_number;
		}
	}
}

/**
 * Validates the initData string from Telegram.
 */
async function isValidTelegramInitData(initData, botToken) {
	const params = new URLSearchParams(initData);
	const hash = params.get('hash');
	params.delete('hash');

	const dataCheckString = Array.from(params.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, value]) => `${key}=${value}`)
		.join('\n');

	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode('WebAppData')),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const secretKey = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(botToken));

	const signatureKey = await crypto.subtle.importKey('raw', secretKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const signature = await crypto.subtle.sign('HMAC', signatureKey, new TextEncoder().encode(dataCheckString));

	const hex = [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, '0')).join('');
	return hash === hex;
}

/**
 * Sends a request to the Telegram Bot API.
 */
async function sendTelegram(method, token, body) {
	return fetch(`https://api.telegram.org/bot${token}/${method}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

/**
 * Builds the text and keyboard for an order notification card.
 */
async function buildOrderCard(env, order) {
    const user = await env.DB.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(order.user_id).first();
    const { results: orderItems } = await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(order.id).all();

    await handleGetMenu(new Request('http://local.dev/api/menu'), env); // Ensure menu is cached
    const menuMap = new Map(menuCache.data.items.map(i => [i.id, i]));

    let itemsText = orderItems.map(item => {
        const menuItem = menuMap.get(item.item_id);
        const title = menuItem ? menuItem.title.en : 'Unknown Item';
        return `- ${title} ×${item.quantity} — ${item.unit_price * item.quantity} RSD`;
    }).join('\n');

    let statusText = `Status: ${order.status.toUpperCase()}`;
    if (order.status === 'pending' || order.status === 'overdue') {
        statusText += ` (Due: ${new Date(order.due_at).toLocaleTimeString('en-GB')})`;
    }

    const text = `
#Order ${order.short_id} · ETA ${order.eta_minutes} min
*Client*: @${user.username} (ID: ${user.telegram_id}, Card: ${user.card_number})
*Items*:
${itemsText}
*Total*: ${order.total_amount} RSD → +${order.stars_added}⭐
---
${statusText}
    `.trim();

    let inline_keyboard = [];
    if (order.status === 'pending' || order.status === 'overdue') {
        inline_keyboard.push([
            { text: '✅ Mark as Ready', callback_data: `order:ready:${order.id}` },
            { text: '➕ Add 10 min', callback_data: `order:delay10:${order.id}` },
            { text: '⛔️ Cancel Order', callback_data: `order:cancel:${order.id}` },
        ]);
    }

    return { text, reply_markup: { inline_keyboard } };
}


/**
 * Posts the initial order card to the admin channel.
 */
async function notifyAdminChannel(env, orderData) {
	const order = {
		id: orderData.order_id,
		short_id: orderData.short_id,
		user_id: orderData.user.id,
		total_amount: orderData.total_amount,
		stars_added: orderData.stars_added,
		eta_minutes: orderData.eta_minutes,
		due_at: orderData.due_at,
		status: 'pending',
	};
	const card = await buildOrderCard(env, order);

	await sendTelegram('sendMessage', env.BOT_TOKEN, {
		chat_id: env.ADMIN_CHANNEL_ID,
		text: card.text,
		reply_markup: card.reply_markup,
		parse_mode: 'Markdown',
	});
}

/**
 * Creates a simple, non-crypto hash for menu item IDs.
 */
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0; // Convert to 32bit integer
    }
    return 'item-' + Math.abs(hash).toString(16);
}

/**
 * Returns a JSON response with appropriate headers.
 */
function jsonResponse(data, headers = {}) {
	const corsHeaders = {
		'Access-Control-Allow-Origin': CORS_ORIGIN,
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
	};
	return new Response(JSON.stringify(data), {
		headers: {
			'Content-Type': 'application/json',
			...corsHeaders,
			...headers,
		},
	});
}

/**
 * Handles preflight OPTIONS requests for CORS.
 */
function handleOptions(request) {
    if (
        request.headers.get("Origin") !== null &&
        request.headers.get("Access-Control-Request-Method") !== null &&
        request.headers.get("Access-Control-Request-Headers") !== null
    ) {
        // Handle CORS preflight requests.
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": CORS_ORIGIN,
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
            },
        });
    } else {
        // Handle standard OPTIONS request.
        return new Response(null, {
            headers: {
                "Allow": "GET, POST, OPTIONS",
            },
        });
    }
}


// =================================================================================
// Main Worker Entrypoint
// =================================================================================

const router = new Router()
	.add('GET', '/api/menu', handleGetMenu)
	.add('POST', '/api/auth/telegram', handleAuth)
	.add('POST', '/api/order', handleCreateOrder)
    .add('POST', '/api/redeem', handleRedeem)
	.add('POST', '/api/admin/accrue', handleAdminAccrue)
	.add('POST', '/tg/webhook', handleWebhook);

export default {
	async fetch(request, env, ctx) {
        if (request.method === 'OPTIONS') {
            return handleOptions(request);
        }
		try {
			return await router.route(request, env, ctx);
		} catch (e) {
			return jsonResponse({ error: e.message }, { status: 500 });
		}
	},
	async scheduled(event, env, ctx) {
		ctx.waitUntil(handleScheduled(event, env, ctx));
	},
};