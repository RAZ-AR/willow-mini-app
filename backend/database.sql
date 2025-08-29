-- PostgreSQL schema for Willow Coffee

-- Drop existing tables if they exist
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS rewards CASCADE;

-- Users table to store customer information
CREATE TABLE users (
    telegram_id BIGINT PRIMARY KEY,
    username TEXT,
    first_name TEXT NOT NULL,
    last_name TEXT,
    language_code TEXT DEFAULT 'en',
    card_number INTEGER UNIQUE,
    stars INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transactions table for star accrual and redemption
CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('accrual', 'redeem')),
    stars_change INTEGER NOT NULL,
    order_id TEXT,
    reward_key TEXT,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
);
CREATE INDEX idx_transactions_user_id_created_at ON transactions(user_id, created_at DESC);

-- Rewards available for redemption
CREATE TABLE rewards (
    key TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    stars_cost INTEGER NOT NULL
);

-- Seed the rewards table
INSERT INTO rewards (key, title, stars_cost) VALUES
('coffee', 'Coffee', 4),
('aperol', 'Aperol Spritz', 8),
('breakfast', 'Breakfast', 12),
('prosecco', 'Prosecco', 16);

-- Orders placed by users
CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    short_id TEXT NOT NULL,
    user_id BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'ready', 'overdue', 'canceled')),
    total_amount INTEGER NOT NULL,
    stars_added INTEGER NOT NULL,
    eta_minutes INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    due_at TIMESTAMP NOT NULL,
    notified BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
);
CREATE INDEX idx_orders_status_due_at ON orders(status, due_at);

-- Items within each order
CREATE TABLE order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price INTEGER NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id)
);