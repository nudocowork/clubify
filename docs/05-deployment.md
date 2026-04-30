# Despliegue — Clubify

## Local (desarrollo)

```bash
# 1. Infra local
cd docker
docker compose up -d   # postgres, redis, minio

# 2. Backend
cd ../backend
cp .env.example .env
npm install
npx prisma migrate dev --name init
npm run seed
npm run start:dev

# 3. Frontend
cd ../frontend
cp .env.example .env.local
npm install
npm run dev
```

URLs:
- Frontend: http://localhost:3000
- Backend: http://localhost:3001/api
- MinIO: http://localhost:9001 (user `minio` / pass `minio12345`)
- Postgres: localhost:5432 (db `clubify`, user `clubify`, pass `clubify`)

## Variables de entorno

### Backend (`backend/.env`)
```
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://clubify:clubify@localhost:5432/clubify
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-me
JWT_REFRESH_SECRET=change-me-too
JWT_EXPIRES=15m
JWT_REFRESH_EXPIRES=30d
QR_HMAC_SECRET=change-me-three
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=clubify-media
S3_ACCESS_KEY=minio
S3_SECRET_KEY=minio12345
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
APP_URL=http://localhost:3000
API_URL=http://localhost:3001
APPLE_PASS_TYPE_ID=pass.com.clubify.loyalty
APPLE_TEAM_ID=XXXXXXXXXX
APPLE_PASS_CERT_PATH=./certs/pass.pem
APPLE_PASS_CERT_PASSWORD=
APPLE_WWDR_PATH=./certs/wwdr.pem
GOOGLE_WALLET_ISSUER_ID=
GOOGLE_WALLET_SA_JSON=./certs/google-wallet-sa.json
APNS_KEY_PATH=./certs/apns.p8
APNS_KEY_ID=
APNS_TEAM_ID=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=Clubify <noreply@clubify.app>
```

### Frontend (`frontend/.env.local`)
```
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Producción

### Opción A — Docker en VPS (Hetzner / DigitalOcean)
1. Servidor Ubuntu 22.04, Docker + Docker Compose.
2. Caddy o Traefik delante para TLS automático.
3. `docker-compose.prod.yml` (en `docker/`) con servicios: `backend`, `frontend`, `worker`, `postgres`, `redis`, `caddy`.
4. Backups automáticos de Postgres a S3 vía cron + `wal-g`.
5. Deploy: `git pull && docker compose -f docker-compose.prod.yml up -d --build`.

### Opción B — Plataformas gestionadas
- **Frontend:** Vercel (Next.js nativo).
- **Backend + workers:** Render / Fly.io / Railway. Setear procesos `web` (NestJS) y `worker` (BullMQ consumer).
- **DB:** Neon o Supabase (Postgres gestionado).
- **Redis:** Upstash.
- **Storage:** Cloudflare R2 o AWS S3.
- **Email:** Resend / Postmark.

### CI/CD (GitHub Actions)
- `lint-test`: tipos, ESLint, vitest.
- `build`: `npm run build` en backend y frontend.
- `deploy`: si `main` → push imágenes a registry → SSH a server → `docker compose pull && up -d`.

## Certificados Wallet

### Apple
1. En Apple Developer, crear un **Pass Type ID** (`pass.com.clubify.loyalty`).
2. Generar certificado y exportarlo `.p12`.
3. Convertir a PEM:
   ```
   openssl pkcs12 -in cert.p12 -clcerts -nokeys -out pass.pem
   openssl pkcs12 -in cert.p12 -nocerts -out pass-key.pem
   ```
4. Descargar Apple WWDR cert y guardarlo en `certs/wwdr.pem`.
5. Para APNs (push de pases), crear key `.p8` en Keys y guardar `APNS_KEY_ID` + `APNS_TEAM_ID`.

### Google Wallet
1. En Google Cloud, habilitar Google Wallet API.
2. Crear Service Account + JSON key.
3. Pedir acceso a Issuer en https://pay.google.com/business/console.
4. Setear `GOOGLE_WALLET_ISSUER_ID` y montar el JSON en `certs/google-wallet-sa.json`.

## Migraciones

```bash
# crear migración nueva
npx prisma migrate dev --name add_xxx

# aplicar en prod
npx prisma migrate deploy
```

## Healthchecks

- `GET /api/health` → `{db, redis, s3}` cada 30s desde load balancer.
- Sentry alerta a Slack para errores 5xx.

## Backups

- Postgres: `pg_dump` diario + WAL continuo a S3 (`wal-g`).
- S3 media: replicación cross-region.
- Retención: 30 días daily, 12 meses monthly.
