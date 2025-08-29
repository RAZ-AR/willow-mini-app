# Развертывание на Koyeb (Бесплатно)

Пошаговая инструкция по развертыванию Willow Coffee на **Koyeb** - лучшей бесплатной платформе в 2024.

## Почему Koyeb?

✅ **Постоянно бесплатный** (50 часов/месяц)  
✅ **PostgreSQL включен** (1GB, автосон)  
✅ **Простое развертывание** из GitHub  
✅ **Глобальные edge серверы**  
✅ **Без кредитных карт** для старта  

## Шаг 1: Создание аккаунта Koyeb

1. Перейти на [koyeb.com](https://www.koyeb.com)
2. Нажать **"Get started for free"**
3. Войти через GitHub аккаунт
4. Подтвердить email

## Шаг 2: Создание PostgreSQL базы

1. В панели Koyeb: **Create Service** → **Database**
2. Настройки:
   - **Database type**: PostgreSQL
   - **Version**: 16 (latest)
   - **Name**: `willow-postgres`
   - **Instance type**: Free
   - **Region**: выбрать ближайший
3. Нажать **Create Database**
4. Дождаться создания и скопировать **Connection String**

## Шаг 3: Инициализация базы данных

1. Подключиться к созданной БД через любой PostgreSQL клиент
2. Выполнить SQL из файла `backend/database.sql`:
   ```sql
   -- Создание таблиц users, orders, transactions и т.д.
   ```

## Шаг 4: Создание веб-сервиса

1. В панели Koyeb: **Create Service** → **Web Service**
2. **Source**: GitHub repository
3. Выбрать репозиторий `willow-mini-app`
4. Настройки:
   - **Branch**: master
   - **Build directory**: `backend`
   - **Build command**: `npm install`
   - **Run command**: `npm start`
   - **Instance type**: Free
   - **Port**: 3000

## Шаг 5: Настройка переменных окружения

В разделе **Environment variables** добавить:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=<connection_string_from_step_2>
BOT_TOKEN=<your_telegram_bot_token>
ADMIN_BEARER=<your_secret_admin_token>
ADMIN_CHANNEL_ID=<telegram_channel_id>
WEBAPP_URL=https://raz-ar.github.io/willow-mini-app/
SHEETS_CSV_URL=https://docs.google.com/spreadsheets/d/1BRQuzea6bba0NxxPk9koLSzpHkfiAzrKmwDa8ow7128/export?format=csv&gid=0
CORS_ORIGIN=https://raz-ar.github.io
```

## Шаг 6: Deploy

1. Нажать **Create Service**
2. Koyeb автоматически:
   - Склонирует репозиторий
   - Установит зависимости
   - Запустит приложение
3. Получить URL деплоя (например: `https://willow-coffee-api-<id>.koyeb.app`)

## Шаг 7: Обновление frontend

Обновить `docs/app.js`:
```javascript
const API_BASE_URL = 'https://willow-coffee-api-<your-id>.koyeb.app';
```

Закоммитить и запушить изменения.

## Шаг 8: Создание Telegram бота

1. Написать @BotFather в Telegram
2. `/newbot` → указать название
3. Получить BOT_TOKEN
4. Обновить переменную в Koyeb

## Шаг 9: Настройка webhook

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://willow-coffee-api-<your-id>.koyeb.app/tg/webhook"
```

## Шаг 10: Создание админ-канала

1. Создать приватный Telegram канал
2. Добавить бота как администратора
3. Получить ID канала (через @userinfobot)
4. Обновить ADMIN_CHANNEL_ID в Koyeb

## Мониторинг

### Проверка работы:
```bash
# Health check
curl https://willow-coffee-api-<your-id>.koyeb.app/health

# Menu API
curl https://willow-coffee-api-<your-id>.koyeb.app/api/menu
```

### Логи:
- В панели Koyeb → Services → Logs
- Реальное время мониторинг ошибок

## Лимиты бесплатного плана

- **50 часов активности/месяц** (база автоматически засыпает)
- **1GB PostgreSQL storage**
- **100GB bandwidth**
- **1 веб-сервис + 1 база данных**

## Автомасштабирование

Koyeb автоматически:
- Запускает приложение при запросах
- Усыпляет через 5 минут простоя
- Масштабируется при нагрузке

## Альтернативы при превышении лимитов

Если потребуется больше 50 часов:
1. **Koyeb Starter**: $5.99/месяц
2. **Render**: ~$7/месяц с PostgreSQL
3. **Railway**: $5/месяц + usage

## Troubleshooting

**Ошибка подключения к БД:**
- Проверить CONNECTION_STRING
- База должна быть в том же регионе

**Превышен лимит часов:**
- Проверить в Dashboard → Usage
- Оптимизировать запросы к БД
- Добавить кеширование

**Telegram webhook не работает:**
- Проверить SSL сертификат
- URL должен быть HTTPS
- Проверить BOT_TOKEN

Готово! Приложение работает бесплатно на Koyeb с PostgreSQL.