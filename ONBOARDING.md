# 🚀 Onboarding de desarrollo — Clubify

Guía para levantar Clubify en tu computadora y empezar a modificar la plataforma.
**Todo lo de aquí corre 100% local y aislado de producción** — no puedes afectar a clientes reales mientras desarrollas.

> Valores (puertos, DB, credenciales) verificados contra el repo el 2026-07-16.

---

## 0. Qué es esto (30 segundos)

Monorepo con dos piezas principales:

| Carpeta | Qué es | Corre en local | Se despliega en |
|---|---|---|---|
| `backend/` | API NestJS + Prisma + Postgres | `:4949` | Railway |
| `frontend/` | App Next.js (panel, storefront, wallet, scanner) | `:4848` | Vercel |
| `docker/` | Postgres + Redis + MinIO para dev local | — | — |

El deploy es **manual** (no automático por push). Ver §6.

---

## 1. Requisitos

- **Node.js 20 LTS** (el equipo corre `v20.x`). Recomendado instalarlo con [nvm](https://github.com/nvm-sh/nvm).
- **Docker Desktop** (para Postgres/Redis/MinIO locales).
- **Git** con acceso al repo `github.com/nudocowork/clubify` (pídeselo al equipo si aún no lo tienes).
- Editor: VS Code recomendado.

---

## 2. Accesos (una sola vez)

| Servicio | Para qué | Cómo |
|---|---|---|
| **GitHub** | Clonar y proponer cambios (PRs) | Ser *collaborator* del repo |
| **Vercel** | Desplegar frontend | Estar en el proyecto `clubify` |
| **Railway** | Desplegar backend + ver DB/logs | Solo si vas a tocar API/base de datos |

> ⚠️ **Nunca** copies secretos de producción a tu máquina. Para local generas los tuyos (§3). Los secretos reales viven dentro de Vercel/Railway y se leen desde ahí.

---

## 3. Levantar el proyecto en local (~20 min)

### 3.1 Clonar

```bash
git clone git@github.com:nudocowork/clubify.git
cd clubify
```

### 3.2 Infraestructura local (Docker)

```bash
cd docker
docker compose up -d
```
Esto levanta:
- **Postgres** en `localhost:5432` (user/pass/db = `clubify`)
- **Redis** en `localhost:6379`
- **MinIO** (storage tipo S3) en `localhost:9000`, consola en `localhost:9001` (`minio` / `minio12345`)

### 3.3 Backend

```bash
cd ../backend
cp .env.example .env
```

Ahora **edita `backend/.env`** y reemplaza el bloque de arriba con esta config **local**
(el `.env.example` trae valores de producción — para dev usa esto):

```env
NODE_ENV=development
PORT=4949
DATABASE_URL=postgresql://clubify:clubify@localhost:5432/clubify
REDIS_URL=redis://localhost:6379

# Genera cada uno con: openssl rand -base64 48   (el QR con 32)
JWT_SECRET=<openssl rand -base64 48>
JWT_REFRESH_SECRET=<openssl rand -base64 48>
JWT_EXPIRES=15m
JWT_REFRESH_EXPIRES=30d
QR_HMAC_SECRET=<openssl rand -base64 32>

APP_URL=http://localhost:4848
API_URL=http://localhost:4949

# Storage local (MinIO) — solo necesario si vas a subir imágenes
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=clubify-media
S3_ACCESS_KEY=minio
S3_SECRET_KEY=minio12345
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_URL=http://localhost:9000/clubify-media
```

> Lo demás del `.env` (Apple/Google Wallet, SMTP, Sentry, etc.) es **opcional** para dev — déjalo vacío.

Instala, prepara la base de datos y arranca:

```bash
npm install
npx prisma generate
npx prisma migrate deploy      # aplica todas las migraciones a tu DB local
npm run seed                   # crea admin + negocio demo (idempotente, puedes re-correrlo)
npm run start:dev              # API en http://localhost:4949
```

Verifica: abre `http://localhost:4949/api/health` → debe responder `{"ok":true,...}`.

### 3.4 Frontend

En **otra terminal**:

```bash
cd frontend
cp .env.example .env.local
```

Edita `frontend/.env.local` para que apunte al backend local:

```env
NEXT_PUBLIC_API_URL=http://localhost:4949
NEXT_PUBLIC_APP_URL=http://localhost:4848
```

Instala y arranca **en el puerto 4848**:

```bash
npm install
npm run dev -- -p 4848         # app en http://localhost:4848
```

### 3.5 Entrar

Abre `http://localhost:4848/login`:

| Rol | Usuario | Contraseña |
|---|---|---|
| Super Admin | `admin@clubify.local` | `Clubify123!` |
| Negocio demo | `demo@clubify.local` | `Demo123!` |

🎉 Ya tienes Clubify completo corriendo local. Rompe lo que quieras: no afecta producción.

> **¿Vas a subir imágenes?** Antes crea el bucket: entra a `http://localhost:9001` (`minio`/`minio12345`) → **Create Bucket** → `clubify-media` → hazlo público.

---

## 4. Comandos útiles

```bash
# Backend
npm run start:dev        # API con hot-reload
npm run seed             # recrear datos demo
npm run test             # tests (vitest)
npx prisma studio        # explorar la DB local en el navegador

# Frontend
npm run dev -- -p 4848   # app con hot-reload
npm run build            # build de producción (para probar antes de desplegar)
npm run lint

# Infra
docker compose up -d     # levantar Postgres/Redis/MinIO   (desde docker/)
docker compose down      # apagar (los datos persisten en volúmenes)
docker compose down -v   # apagar Y borrar datos (empezar de cero)
```

---

## 5. Flujo de trabajo (importante — somos varios sobre el mismo código)

**Nunca trabajes directo en `main`.** Siempre en una rama y merge por Pull Request:

```bash
git checkout main && git pull            # parte siempre de main actualizado
git checkout -b feat/lo-que-vas-a-hacer  # rama nueva
# ...programa y prueba en local...
git add -A && git commit -m "feat: descripción del cambio"
git push origin feat/lo-que-vas-a-hacer
# abre un Pull Request en GitHub → se revisa → se mergea
```

Regla de oro: **cambios a producción pasan por PR revisado**, no por push directo a `main`.

---

## 6. Deploy a producción (manual — leer antes de desplegar)

El deploy **no es automático**. Se hace a mano y en orden:

### Frontend (Vercel)
```bash
cd frontend
vercel --prod        # requiere estar logueado y linkeado al proyecto clubify
```

### Backend (Railway)
```bash
cd backend
railway up           # SIEMPRE desde backend/ y con el service correcto linkeado
```

### ⚠️ Los 2 gotchas que SÍ o SÍ debes conocer

1. **Migraciones ANTES del deploy del backend.** Si tu cambio agrega/modifica columnas, la migración se aplica a la base de producción **antes** de subir el código. Si despliegas el código sin migrar, el backend arranca con **error 500 global** (ya pasó, tumbó el menú de todos los negocios). El `startCommand` de Railway **no** corre las migraciones solo.
2. **El deploy no se dispara con `git merge`.** Mergear un PR a `main` **no** redespliega nada. Hay que correr `vercel --prod` / `railway up` a mano.

> Al principio, coordina con el equipo para que los primeros deploys los hagan juntos.

---

## 7. Troubleshooting rápido

| Síntoma | Causa / solución |
|---|---|
| `port 4949 already in use` | Ya hay algo corriendo. Cámbialo o mata el proceso (`lsof -i :4949`). |
| Backend no conecta a la DB | ¿Levantaste Docker? `docker compose ps` desde `docker/`. |
| `prisma migrate` falla | Revisa que `DATABASE_URL` apunte a `localhost:5432` con user/pass `clubify`. |
| Frontend no ve la API / CORS | ¿`NEXT_PUBLIC_API_URL=http://localhost:4949`? Reinicia `npm run dev`. |
| Login no carga / bundle viejo | Es cache del Service Worker; hard-refresh (Cmd+Shift+R). |
| Subir imagen falla | Crea el bucket `clubify-media` en MinIO (`localhost:9001`). |

---

## 8. Documentación de referencia

- `README.md` — visión y stack (ojo: puertos desactualizados, usa **este** doc).
- `docs/` — arquitectura, modelo de datos, flujos.
- `DEPLOY.md` — despliegue de infraestructura desde cero.

---

**¿Dudas?** Pregúntale al equipo antes de tocar producción. Bienvenido 🚀
