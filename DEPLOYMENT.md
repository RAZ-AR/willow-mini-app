# Deployment Guide - Willow Coffee

Пошаговое руководство по развертыванию Willow Coffee Mini App с бесплатным бекендом.

## Быстрый старт

1. **Backend (Railway)** - бесплатно 500 часов/месяц
2. **Frontend (GitHub Pages)** - бесплатно
3. **Database (Railway PostgreSQL)** - бесплатно до 1GB

## 1. Развертывание Backend на Railway

### Шаг 1: Создание аккаунта
- Перейти на [railway.app](https://railway.app)
- Войти через GitHub

### Шаг 2: Создание проекта
- Нажать "New Project"
- Выбрать "Deploy from GitHub repo"
- Выбрать репозиторий `willow-mini-app`

### Шаг 3: Настройка PostgreSQL
- В проекте добавить "Add service" → "Database" → "PostgreSQL"
- Railway автоматически создаст DATABASE_URL

### Шаг 4: Настройка переменных окружения
В разделе "Variables" добавить:

```
NODE_ENV=production
PORT=3000
BOT_TOKEN=your_telegram_bot_token_here
ADMIN_BEARER=your_admin_secret_token_here  
ADMIN_CHANNEL_ID=your_telegram_channel_id_here
WEBAPP_URL=https://raz-ar.github.io/willow-mini-app/
SHEETS_CSV_URL=https://docs.google.com/spreadsheets/d/1BRQuzea6bba0NxxPk9koLSzpHkfiAzrKmwDa8ow7128/export?format=csv&gid=0
CORS_ORIGIN=https://raz-ar.github.io
```

### Шаг 5: Развертывание
- Railway автоматически деплоит при push в GitHub
- Получить URL из раздела "Deployments" (например: `https://willow-coffee-backend.railway.app`)

### Шаг 6: Инициализация базы данных
- В Railway Console выполнить SQL из файла `backend/database.sql`
- Или подключиться к БД и выполнить скрипт

## 2. Создание Telegram Бота

### Шаг 1: Создание бота
- Написать @BotFather в Telegram
- Команда `/newbot`
- Указать имя и username бота
- Сохранить BOT_TOKEN

### Шаг 2: Настройка команд
```
/setcommands
start - Launch the coffee app
mycard - Show loyalty card number
```

### Шаг 3: Настройка webhook
Заменить `<BOT_TOKEN>` и `<BACKEND_URL>`:
```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<BACKEND_URL>/tg/webhook"
```

### Шаг 4: Создание админ-канала
- Создать приватный канал в Telegram
- Добавить бота как администратора
- Получить ID канала (можно через @userinfobot)

## 3. Обновление Frontend

### Шаг 1: Обновить API URL
В файле `docs/app.js` изменить:
```javascript
const API_BASE_URL = 'https://your-backend-url.railway.app';
```

### Шаг 2: Коммит изменений
```bash
git add .
git commit -m "Update API URL for deployed backend"
git push origin master
```

## 4. Настройка GitHub Pages

- Перейти в Settings → Pages
- Source: Deploy from branch
- Branch: master
- Folder: /docs
- Save

Через несколько минут приложение будет доступно по адресу:
`https://raz-ar.github.io/willow-mini-app/`

## 5. Настройка Google Sheets (Меню)

### Создание таблицы:
1. Скопировать [шаблон таблицы](https://docs.google.com/spreadsheets/d/1BRQuzea6bba0NxxPk9koLSzpHkfiAzrKmwDa8ow7128/)
2. Опубликовать: File → Share → Publish to web → CSV
3. Скопировать CSV ссылку в переменную SHEETS_CSV_URL

### Формат таблицы:
| Категория | Английский | Русский | Сербский | Объем | Стоимость (RSD) | Состав |
|-----------|------------|---------|----------|-------|-----------------|--------|
| Coffee | Espresso | Эспрессо | Espreso | 30ml | 150 | Arabica beans |

## 6. Тестирование

### Проверить backend:
```bash
curl https://your-backend-url.railway.app/health
```

### Проверить webhook:
```bash
curl https://your-backend-url.railway.app/api/menu
```

### Тестирование в Telegram:
1. Найти бота по username
2. Команда `/start`
3. Нажать "Open App"
4. Проверить загрузку меню

## Альтернативные платформы

### Render.com
- 750 часов/месяц бесплатно
- Использовать `render.yaml` конфигурацию
- PostgreSQL доступна

### Heroku
- Ограниченный бесплатный план
- Требует кредитную карту
- PostgreSQL через add-ons

### Vercel/Netlify
- Только для serverless функций
- Требует адаптацию кода

## Мониторинг

- Railway предоставляет логи и метрики
- Endpoint `/health` для проверки статуса
- Telegram webhook для отладки заказов

## Стоимость

**Бесплатные лимиты:**
- Railway: 500 часов/месяц, 1GB PostgreSQL
- GitHub Pages: без лимитов
- Telegram Bot API: без лимитов

**При превышении:**
- Railway: $5/месяц за дополнительные ресурсы
- Всё остальное остается бесплатным