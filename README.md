# Pulse Messenger — MVP

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

Полнофункциональная основа SPA/PWA-мессенджера: личные и групповые чаты, realtime-сообщения, реакции, ответы, редактирование и мягкое удаление, presence/typing и групповой голос через LiveKit.

## Архитектура и стек

- **`apps/web` — Next.js 16, React 19.2, TypeScript, Tailwind.** SSR/PWA-основа, быстрый responsive UI и единая компонентная модель.
- **`apps/api` — NestJS, Prisma, PostgreSQL.** Явные доменные границы, типизированная схема и удобная миграция от MVP к сервисам.
- **Socket.IO + Redis adapter.** Горизонтально масштабируемые сообщения; Redis также хранит presence с TTL 70 секунд, heartbeat идёт каждые 30 секунд.
- **LiveKit SFU.** Серверная выдача room-scoped токенов, клиентские speaker/mute/audio controls.
- **S3-compatible storage.** Presigned PUT не проксирует файлы через API. Локально используется MinIO, а endpoint/region/bucket/credentials/public URL меняются без изменения кода.
- **JWT auth.** Access JWT живёт 15 минут. Одноразовые refresh-токены ротируются, отзываются при logout и хранятся только как SHA-256 хэши. Пароли хешируются bcrypt (12 rounds).

## Быстрый запуск

Требования: Node.js 20.9+, npm 10+, Docker Desktop.

```bash
copy .env.example .env
npm install
npm run db:generate
npm run infra:up
npm run db:seed
npm run dev -w @pulse/web
```

`infra:up` собирает и запускает backend, применяет Prisma migrations после healthy-зависимостей и поднимает инфраструктуру. Откройте `http://localhost:3000`; API доступен на `http://localhost:4000/api`.

> **Только development/demo:** seed удаляет данные в целевой БД и создаёт пользователей `anna`, `max`, `leo` с паролем `demo12345`. Никогда не запускайте `npm run db:seed` на production-базе и не используйте этот пароль для реальных аккаунтов.

MinIO API работает на `http://localhost:9000`, консоль — на `http://localhost:9001` (`minio` / `miniosecret`). Одноразовый контейнер `minio-init` автоматически создаёт bucket `pulse-media` и открывает чтение объектов; вручную готовить хранилище не нужно.

> Пока токен не записан в `localStorage` под ключом `pulse_token`, интерфейс работает в демонстрационном offline-friendly режиме. Получить токен можно через `POST /api/auth/login`, тело: `{"login":"anna","password":"demo12345"}`.

## Команды

| Команда | Назначение |
|---|---|
| `npm run dev` | API и web параллельно |
| `npm run build` | production-сборка обоих приложений |
| `npm run lint` | проверка TypeScript |
| `npm test` | все backend unit + HTTP/Socket e2e тесты |
| `npm run test:smoke` | Playwright smoke против запущенного и seeded backend |
| `npm run db:migrate` | создать/применить Prisma migration |
| `npm run db:deploy` | применить сохранённые миграции на чистой БД |
| `npm run db:seed` | пересоздать demo data |
| `npm run infra:down` | остановить локальные сервисы |

## Медиа и S3-конфигурация

| Переменная | Локальное значение | Назначение |
|---|---:|---|
| `S3_ENDPOINT` | `http://localhost:9000` | S3 API endpoint |
| `S3_REGION` | `us-east-1` | регион подписи SigV4 |
| `S3_BUCKET` | `pulse-media` | bucket вложений и аватаров |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | MinIO credentials | ключи только для backend |
| `S3_FORCE_PATH_STYLE` | `true` | path-style URL, необходимый локальному MinIO |
| `S3_PUBLIC_URL` | `http://localhost:9000/pulse-media` | публичная база сохранённых URL без завершающего `/` |
| `MEDIA_PRESIGN_TTL_SECONDS` | `300` | срок действия upload URL |
| `MEDIA_IMAGE_MAX_BYTES` | `10485760` | изображения сообщений, 10 МБ |
| `MEDIA_FILE_MAX_BYTES` | `26214400` | документы/аудио, 25 МБ |
| `MEDIA_AVATAR_MAX_BYTES` | `5242880` | аватары, 5 МБ |

Значения `NEXT_PUBLIC_MEDIA_*` должны совпадать с backend-лимитами: они нужны только для быстрой клиентской проверки. Backend остаётся источником истины.

Пайплайн: клиент запрашивает `POST /api/uploads/presign`, напрямую выполняет `PUT` в хранилище с возвращённым `Content-Type`, затем отправляет Socket.IO-сообщение с `mediaUrl`, очищенным `mediaName`, `mediaType` и `mediaSize`. API повторно проверяет membership, allowlist, размер и принадлежность URL выделенному prefix чата.

### Настоящий AWS S3 или Cloudflare R2

1. Создайте приватные access keys с минимальными правами `PutObject` для выбранного bucket. Публичное чтение можно организовать через CDN/custom domain; его адрес укажите в `S3_PUBLIC_URL`.
2. Для AWS задайте стандартный регион/endpoint и обычно `S3_FORCE_PATH_STYLE=false`. Для R2 используйте endpoint вида `https://<account-id>.r2.cloudflarestorage.com`, регион `auto` и публичный/custom domain как `S3_PUBLIC_URL`.
3. Настройте CORS bucket: разрешите origin frontend, методы `PUT`/`GET`/`HEAD` и заголовки `Content-Type`/`Content-Disposition`.
4. Не передавайте `S3_ACCESS_KEY` и `S3_SECRET_KEY` в frontend и не добавляйте их в `NEXT_PUBLIC_*`. После замены env перезапустите API; изменений кода не требуется.

Для закрытых медиа вместо публичного `S3_PUBLIC_URL` следует добавить короткоживущий presigned GET/CDN signed-cookie слой. Текущий MVP использует непредсказуемые UUID-ключи и публичное чтение для постоянной работоспособности URL в сообщениях.

## Security-конфигурация

- `JWT_SECRET` и `REFRESH_JWT_SECRET` обязательны и должны быть разными случайными строками минимум по 32 байта. В production у кода нет fallback-значений.
- `ACCESS_TOKEN_TTL_SECONDS=900`, `REFRESH_TOKEN_TTL_SECONDS=2592000` задают сроки токенов. Logout отзывает refresh-токен, refresh немедленно отзывает использованный токен и выпускает новый.
- `WEB_ORIGINS` — список точных origins через запятую, например `https://app.example.com,https://admin.example.com`. Wildcard `*` запрещён; в production пустое значение останавливает запуск.
- `TRUST_PROXY=loopback` безопасен для локального reverse proxy. При production-развёртывании задайте доверенную proxy-схему под свою инфраструктуру, иначе IP-based rate limiting может видеть адрес proxy.
- Login/register ограничены пятью попытками в минуту для комбинации IP+email/login. Upload-presign имеет отдельный лимит 10 запросов в минуту.
- Helmet включает защитные HTTP-заголовки. CSP API сейчас отправляется как `Content-Security-Policy-Report-Only`; enforcing CSP для Next.js frontend следует задавать на frontend/reverse proxy отдельно, учитывая домены S3/CDN, Socket.IO и LiveKit.
- Встроенный Nest Logger использует уровни `error/warn/log` в production и дополнительно `debug` в development. Request bodies, пароли, JWT и подписанные upload URL не логируются.

## Проверка Docker Compose

После `copy .env.example .env` замените оба JWT-секрета, затем:

```bash
docker compose up -d --build
docker compose ps
npm run db:seed
```

Чеклист после старта:

1. `postgres`, `redis`, `minio` и `backend` имеют статус `healthy`; `minio-init` завершился с кодом `0`; `livekit` работает.
2. `http://localhost:4000/api/health` возвращает `{"status":"ok","checks":{"postgres":"up","redis":"up"}}`; при запущенном frontend `http://localhost:3000/api/health` отвечает `200`.
3. Порты: PostgreSQL `5432`, Redis `6379`, LiveKit `7880/7881/7882`, MinIO API `9000`, MinIO Console `9001`, backend `4000`.
4. В MinIO Console существует bucket `pulse-media`.
5. `docker compose logs backend --tail=100` не содержит JWT, паролей или query-параметров presigned URL.
6. После seed login `anna` / `demo12345` работает только в локальном demo-окружении.

Для hot reload backend вместо контейнера остановите только его (`docker compose stop backend`) и запустите `npm run dev`; инфраструктурные контейнеры продолжат работать.

## Тесты

```bash
npm test
npm run build
npm run db:generate
```

Backend-набор включает unit-тесты auth/refresh, membership, messages/reactions, storage validation и Socket.IO handshake, а также Supertest e2e-сценарий HTTP+Socket.IO. Локально E2E использует изолированный in-memory Prisma adapter, поэтому не зависит от локальной БД и не удаляет пользовательские данные. В CI дополнительно включается `stack.e2e-spec.ts`: он обращается к production build API и проверяет реальные PostgreSQL, Redis adapter и membership-запрет.

Frontend smoke запускается отдельно против уже поднятого и seeded backend:

```bash
npx playwright install chromium
npm run test:smoke
```

Smoke выполняет API login, передаёт access token приложению, открывает реальный чат, отправляет текст через Socket.IO и проверяет его появление в ленте. URL можно переопределить через `PLAYWRIGHT_API_URL` и `PLAYWRIGHT_WEB_URL`.

## Continuous Integration

Workflow `.github/workflows/ci.yml` запускается для каждого push и pull request в `main` и состоит из двух обязательных проверок:

1. **Fast checks** — `npm ci` с кешем npm, Prisma Client generation, typecheck/lint и backend unit-тесты без Docker. Это быстрый feedback для PR и тот же безопасный набор, который можно запускать локально.
2. **Full stack integration** — поднимает Postgres, Redis, LiveKit и MinIO из существующего `docker-compose.yml`, ждёт healthcheck’и и успешный `minio-init`, применяет сохранённые Prisma migrations, выполняет destructive demo seed в одноразовой CI-БД, собирает и запускает production backend/frontend, а затем гоняет полный Jest-набор и Playwright Chromium smoke.

Перед тестами CI требует `200` от backend `/api/health` (с реальной проверкой Postgres и Redis) и frontend `/api/health`. При падении сохраняется artifact `pulse-ci-failure-<run-id>` с логами backend/frontend, состоянием и логами Compose, Playwright HTML report, trace, screenshot и video. Artifact хранится 7 дней; очистка контейнеров и volumes выполняется всегда.

Для защиты `main` в настройках GitHub включите branch protection и сделайте checks `Fast checks` и `Full stack integration` обязательными. CI не требуется для локальной разработки: без Docker остаются доступны `npm run lint`, `npm test`, `npm run build` и `npm run db:generate`.

## Контракты MVP

REST: `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`, `/health`, `/chats`, `/chats/:id/messages`, `/chats/messages/:id`, `/chats/messages/:id/reactions`, `/uploads/presign`, `/uploads/avatars/me`, `/uploads/avatars/chats/:chatId`, `/voice/:chatId/token`, `/voice/:chatId/leave`.

Socket namespace `/chat`: `chat:join`, `message:send`, `message:new`, `typing:start`, `typing:stop`, `typing:update`, `presence:heartbeat`, `presence:update`.

## Responsive и доступность

- **375 px:** одна колонка; список и чат — отдельные экраны, безопасная высота `100dvh`.
- **768 px:** две колонки (`320px + 1fr`), правая панель скрыта.
- **1440 px:** три колонки (`340px + flexible + 360px`), info/voice panel доступна постоянно.
- Все icon-only actions имеют `aria-label`, сообщения объявляются через `aria-live`, клавиатурный focus контрастен, анимации отключаются через `prefers-reduced-motion`.
- Theme provider поддерживает light/dark/system. Manifest, maskable SVG icon и service worker дают installable PWA basics и cache fallback для app shell.

## Production hardening

Перед публикацией добавьте refresh-token rotation/HttpOnly cookies, email verification, antivirus/Content-Disposition pipeline для загруженных объектов, moderation/audit log, Redis/TLS credentials, LiveKit webhook reconciliation, observability и e2e-тесты. Для direct chat также стоит добавить уникальный normalized pair key, исключающий дубликаты диалогов.
