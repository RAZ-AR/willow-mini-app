const API_BASE_URL = 'https://mild-lotta-willow-2025-1b544553.koyeb.app'; // Koyeb deployment URL

const i18n = {
    en: {
        your_card: 'Your Card',
        rewards: 'Rewards',
        redeem: 'Redeem',
        menu: 'Menu',
        eta: 'ETA',
        total: 'Total',
        order: 'Order',
        ingredients: 'Ingredients',
        table: 'Table',
        payment: 'Payment',
        stars_needed: 'Stars needed',
        confirm_redeem: 'Are you sure you want to redeem this reward?',
        confirm_order: 'Are you sure you want to place this order?',
        order_placed: 'Order placed successfully!',
        redeem_success: 'Reward redeemed!',
        error_title: 'Error',
        error_default: 'An unknown error occurred.',
        not_enough_stars: 'Not enough stars for this order',
    },
    ru: {
        your_card: 'Ваша карта',
        rewards: 'Награды',
        redeem: 'Обменять',
        menu: 'Меню',
        eta: 'Время',
        total: 'Итого',
        order: 'Заказать',
        ingredients: 'Состав',
        table: 'Стол',
        payment: 'Оплата',
        stars_needed: 'Нужно звёзд',
        confirm_redeem: 'Вы уверены, что хотите использовать эту награду?',
        confirm_order: 'Вы уверены, что хотите сделать заказ?',
        order_placed: 'Заказ успешно размещен!',
        redeem_success: 'Награда получена!',
        error_title: 'Ошибка',
        error_default: 'Произошла неизвестная ошибка.',
        not_enough_stars: 'Недостаточно звёзд для заказа',
    },
    sr: {
        your_card: 'Vaša kartica',
        rewards: 'Nagrade',
        redeem: 'Iskoristi',
        menu: 'Meni',
        eta: 'Vreme',
        total: 'Ukupno',
        order: 'Naruči',
        ingredients: 'Sastojci',
        table: 'Sto',
        payment: 'Plaćanje',
        stars_needed: 'Potrebno zvezda',
        confirm_redeem: 'Da li ste sigurni da želite da iskoristite ovu nagradu?',
        confirm_order: 'Da li ste sigurni da želite da naručite?',
        order_placed: 'Narudžba je uspešno poslata!',
        redeem_success: 'Nagrada je iskorišćena!',
        error_title: 'Greška',
        error_default: 'Došlo je do nepoznate greške.',
        not_enough_stars: 'Nema dovoljno zvezda za narudžbu',
    },
};

const App = {
    tg: window.Telegram.WebApp,
    state: {
        lang: 'en',
        user: null,
        menu: { categories: [], items: [] },
        cart: {},
        activeCategory: null,
    },

    init() {
        // Check if we're in Telegram WebApp
        if (window.Telegram && window.Telegram.WebApp) {
            this.tg.ready();
            this.tg.expand();
            this.tg.setHeaderColor('#1e1e1e');
            this.tg.setBackgroundColor('#121212');
        } else {
            console.warn('Not in Telegram WebApp environment');
            // Mock Telegram object for development
            this.tg = {
                initData: null,
                showAlert: (message) => alert(message),
                showConfirm: (message, callback) => callback(confirm(message)),
                showPopup: (options) => alert(options.message)
            };
        }

        this.addEventListeners();
        this.authenticate();
    },

    addEventListeners() {
        document.querySelector('.lang-selector').addEventListener('click', this.handleLangChange.bind(this));
        document.getElementById('menu-categories').addEventListener('click', this.handleCategoryChange.bind(this));
        document.getElementById('menu-items').addEventListener('click', this.handleMenuClick.bind(this));
        document.getElementById('order-button').addEventListener('click', this.handleOrder.bind(this));
        document.getElementById('rewards-section').addEventListener('click', this.handleRedeem.bind(this));
        document.querySelector('.close-button').addEventListener('click', () => this.toggleModal(false));
        
        // Payment method change handler
        document.addEventListener('change', (event) => {
            if (event.target.name === 'payment') {
                this.updateCartUI();
            }
        });
        
        window.addEventListener('click', (event) => {
            if (event.target == document.getElementById('ingredients-modal')) {
                this.toggleModal(false);
            }
        });
    },

    async apiCall(endpoint, options = {}) {
        try {
            const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Request failed');
            }
            return await response.json();
        } catch (error) {
            this.showAlert(error.message || this.t('error_default'));
            console.error(`API call to ${endpoint} failed:`, error);
            throw error;
        }
    },

    getInitData() {
        // Use 'test' as initData if not in Telegram WebApp environment
        if (!this.tg.initData || this.tg.initData.length === 0) {
            return 'test';
        }
        return this.tg.initData;
    },

    async authenticate() {
        try {
            const initData = this.getInitData();
            console.log('initData:', initData);
            console.log('API_BASE_URL:', API_BASE_URL);
            
            // TEMPORARY: Skip authentication for testing
            if (true) { // Always skip for now
                // Create mock user for testing
                this.state.user = {
                    telegram_id: 12345,
                    first_name: 'Test',
                    last_name: 'User', 
                    username: 'testuser',
                    language_code: 'en',
                    card_number: 1234,
                    stars: 0
                };
                this.setLang('en');
                this.updateUserUI();
                this.fetchMenu();
                return;
            }
            
            if (!initData) {
                throw new Error('Telegram initData not found. Please open this app through Telegram.');
            }

            const user = await this.apiCall('/api/auth/telegram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ initData }),
            });

            this.state.user = user;
            this.setLang(user.language_code || 'en');
            this.updateUserUI();
            this.fetchMenu();
        } catch (error) {
            console.error('Authentication error:', error);
            document.getElementById('loader').innerHTML = `
                <div style="color: #ff4444; text-align: center; padding: 20px;">
                    <h3>Authentication Failed</h3>
                    <p>${error.message}</p>
                    <p style="font-size: 12px; margin-top: 10px;">
                        Please make sure:
                        <br>• You opened this through Telegram
                        <br>• Backend worker is deployed
                        <br>• API_BASE_URL is correct
                    </p>
                    <button onclick="location.reload()" style="margin-top: 10px; padding: 10px 20px; background: #0088cc; color: white; border: none; border-radius: 5px;">
                        Reload
                    </button>
                </div>
            `;
        }
    },

    async fetchMenu() {
        try {
            const menu = await this.apiCall('/api/menu');
            this.state.menu = menu;
            this.state.activeCategory = menu.categories[0] || null;
            this.render();
            document.getElementById('loader').style.display = 'none';
            document.getElementById('app-container').style.display = 'block';
        } catch (error) {
            console.error('Could not load menu from Google Sheets:', error);
            document.getElementById('loader').innerHTML = `
                <div style="color: #dc3545; text-align: center; padding: 20px;">
                    <h3>Could not load menu</h3>
                    <p>Unable to fetch menu from Google Sheets</p>
                    <p style="font-size: 12px; margin-top: 10px;">
                        Please make sure:
                        <br>• Google Sheets table is public
                        <br>• Table has correct column headers
                        <br>• Backend can access the CSV export
                    </p>
                    <button onclick="location.reload()" style="margin-top: 10px; padding: 10px 20px; background: #17a2b8; color: white; border: none; border-radius: 5px;">
                        Retry
                    </button>
                </div>
            `;
        }
    },

    render() {
        this.renderCategories();
        this.renderMenuItems();
        this.updateCartUI();
        this.updateRewardsUI();
    },

    renderCategories() {
        const container = document.getElementById('menu-categories');
        container.innerHTML = this.state.menu.categories.map(cat => `
            <button class="category-tab ${cat === this.state.activeCategory ? 'active' : ''}" data-category="${cat}">
                ${cat}
            </button>
        `).join('');
    },

    renderMenuItems() {
        const container = document.getElementById('menu-items');
        const items = this.state.menu.items.filter(item => item.category === this.state.activeCategory);
        
        if (items.length === 0) {
            container.innerHTML = '<p>No items in this category.</p>';
            return;
        }

        container.innerHTML = items.map(item => {
            const quantity = this.state.cart[item.id] || 0;
            return `
            <div class="menu-card" data-item-id="${item.id}">
                <div class="item-title">${item.title[this.state.lang] || item.title.en}</div>
                <div class="item-details">${item.volume || ''}</div>
                <div class="item-price">${item.price} RSD</div>
                <div class="item-actions">
                    ${item.ingredients ? `<button class="item-info-btn" data-action="info">ⓘ</button>` : ''}
                    <div class="quantity-control">
                        <button class="quantity-btn" data-action="decrease">-</button>
                        <span class="item-quantity">${quantity}</span>
                        <button class="quantity-btn" data-action="increase">+</button>
                    </div>
                </div>
            </div>
        `;
        }).join('');
    },

    updateUserUI() {
        document.getElementById('user-stars').textContent = `${this.state.user.stars} ⭐`;
        document.getElementById('user-card-number').textContent = this.state.user.card_number;
    },

    updateCartUI() {
        let total = 0;
        let itemCount = 0;
        const menuMap = new Map(this.state.menu.items.map(i => [i.id, i]));

        for (const [id, qty] of Object.entries(this.state.cart)) {
            const menuItem = menuMap.get(id);
            if (menuItem) {
                total += menuItem.price * qty;
                itemCount += qty;
            }
        }

        document.getElementById('cart-total').textContent = total;
        document.getElementById('cart-item-count').textContent = itemCount;

        // Calculate stars needed (1 star per 350 RSD)
        const starsNeeded = Math.ceil(total / 350);
        document.getElementById('stars-needed').textContent = starsNeeded;

        // Show/hide stars calculation based on payment method
        const paymentMethod = document.querySelector('input[name="payment"]:checked')?.value || 'cash';
        const starsCalculation = document.getElementById('stars-calculation');
        if (paymentMethod === 'stars' && total > 0) {
            starsCalculation.style.display = 'block';
        } else {
            starsCalculation.style.display = 'none';
        }

        const footer = document.getElementById('cart-footer');
        footer.style.display = itemCount > 0 ? 'flex' : 'none';
    },

    updateRewardsUI() {
        const userStars = this.state.user.stars;
        document.querySelectorAll('.reward-card').forEach(card => {
            const cost = parseInt(card.querySelector('.reward-cost').textContent, 10);
            const button = card.querySelector('.redeem-btn');
            button.disabled = userStars < cost;
        });
    },

    setLang(lang) {
        if (!i18n[lang]) lang = 'en';
        this.state.lang = lang;
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            el.textContent = this.t(key);
        });
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.lang === lang);
        });
        this.renderMenuItems(); // Re-render item titles in new language
    },

    t(key) {
        return i18n[this.state.lang][key] || i18n.en[key];
    },

    showAlert(message, title = this.t('error_title')) {
        this.tg.showAlert(`${title}: ${message}`);
    },

    handleLangChange(e) {
        if (e.target.classList.contains('lang-btn')) {
            this.setLang(e.target.dataset.lang);
        }
    },

    handleCategoryChange(e) {
        if (e.target.classList.contains('category-tab')) {
            this.state.activeCategory = e.target.dataset.category;
            this.renderCategories();
            this.renderMenuItems();
        }
    },

    handleMenuClick(e) {
        const target = e.target;
        const card = target.closest('.menu-card');
        if (!card) return;

        const id = card.dataset.itemId;
        const action = target.dataset.action;

        if (action === 'increase') {
            this.state.cart[id] = (this.state.cart[id] || 0) + 1;
        } else if (action === 'decrease') {
            if (this.state.cart[id] > 0) {
                this.state.cart[id]--;
                if (this.state.cart[id] === 0) {
                    delete this.state.cart[id];
                }
            }
        } else if (action === 'info') {
            const menuItem = this.state.menu.items.find(i => i.id === id);
            if (menuItem && menuItem.ingredients) {
                document.getElementById('modal-ingredients-text').textContent = menuItem.ingredients;
                this.toggleModal(true);
            }
            return; // Don't update cart UI on info click
        }

        const quantityEl = card.querySelector('.item-quantity');
        if (quantityEl) quantityEl.textContent = this.state.cart[id] || 0;
        this.updateCartUI();
    },

    toggleModal(show) {
        document.getElementById('ingredients-modal').style.display = show ? 'block' : 'none';
    },

    async handleOrder() {
        const items = Object.entries(this.state.cart).map(([id, qty]) => ({ id, qty })).filter(item => item.qty > 0);
        if (items.length === 0) return;

        const eta_minutes = parseInt(document.querySelector('input[name="eta"]:checked').value, 10);
        const table_number = document.getElementById('table-number').value;
        const payment_method = document.querySelector('input[name="payment"]:checked').value;
        
        // Calculate total and stars needed
        let total = 0;
        const menuMap = new Map(this.state.menu.items.map(i => [i.id, i]));
        for (const [id, qty] of Object.entries(this.state.cart)) {
            const menuItem = menuMap.get(id);
            if (menuItem) {
                total += menuItem.price * qty;
            }
        }
        
        const starsNeeded = Math.ceil(total / 350);
        
        // Check if user has enough stars for stars payment
        if (payment_method === 'stars' && this.state.user.stars < starsNeeded) {
            this.showAlert(this.t('not_enough_stars'));
            return;
        }

        this.tg.showConfirm(this.t('confirm_order'), async (confirmed) => {
            if (confirmed) {
                try {
                    const result = await this.apiCall('/api/order', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            initData: this.getInitData(), 
                            items, 
                            eta_minutes,
                            table_number,
                            payment_method,
                            stars_needed: starsNeeded
                        }),
                    });
                    this.tg.showPopup({ message: this.t('order_placed') });
                    this.state.cart = {};
                    if (result.new_stars !== undefined) {
                        this.state.user.stars = result.new_stars;
                    }
                    this.render();
                } catch (error) {
                    // showAlert is handled by apiCall
                }
            }
        });
    },

    async handleRedeem(e) {
        if (!e.target.classList.contains('redeem-btn')) return;

        const card = e.target.closest('.reward-card');
        const rewardKey = card.dataset.rewardKey;

        this.tg.showConfirm(this.t('confirm_redeem'), async (confirmed) => {
            if (confirmed) {
                try {
                    const result = await this.apiCall('/api/redeem', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ telegram_id: this.state.user.telegram_id, rewardKey }),
                    });
                    this.tg.showPopup({ message: this.t('redeem_success') });
                    this.state.user.stars = result.new_total;
                    this.updateUserUI();
                    this.updateRewardsUI();
                } catch (error) {
                    if (error.message === 'NOT_ENOUGH_STARS') {
                        this.showAlert('You do not have enough stars for this reward.');
                    } else {
                        // Other errors handled by apiCall
                    }
                }
            }
        });
    },
};

document.addEventListener('DOMContentLoaded', () => App.init());
