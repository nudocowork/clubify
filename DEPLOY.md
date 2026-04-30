# 🚀 Deploy de Clubify a producción

Stack:
- **Frontend Next.js** → Vercel
- **Backend NestJS + WebSockets** → Railway
- **Postgres + Redis** → Railway plugins
- **Object storage** → Cloudflare R2
- **DNS + SSL + CDN** → Cloudflare (gestionado, no Vercel)
- **Registrar** → Namecheap (sin tocar más una vez cambiados los nameservers)

Tiempo total: **45-60 min** la primera vez.

---

## 1. Pre-requisitos

- [x] Dominio `soyclubify.com` en Namecheap
- [x] Nameservers ya cambiados a Cloudflare (`susan.ns.cloudflare.com`, `woz.ns.cloudflare.com`)
- [ ] Cuenta GitHub con un repo nuevo vacío llamado `clubify` (o el nombre que prefieras)
- [ ] Cuenta gratuita Vercel: https://vercel.com/signup (login con GitHub)
- [ ] Cuenta Railway con $5 free trial: https://railway.app/login (login con GitHub)
- [ ] Cloudflare R2 activado (gratis, https://dash.cloudflare.com/?to=/:account/r2)

---

## 2. Subir el código a GitHub

```bash
cd /Users/jhonarias/Documents/AGENTES/CLUBIFY
git init
git add -A
git commit -m "Initial Clubify v3"
git branch -M main
git remote add origin https://github.com/<tu_usuario>/clubify.git
git push -u origin main
```

⚠ Asegurate que `.gitignore` está listo (no subas `.env` ni `node_modules`).

---

## 3. Cloudflare R2 (storage de imágenes)

1. Cloudflare Dashboard → **R2** → **Create bucket** → nombre `clubify-media`
2. **Settings** → **Public access** → habilitar **R2.dev subdomain** (URL pública gratis)
3. **Manage R2 API Tokens** → **Create API Token** → tipo "Object Read & Write" → bucket `clubify-media`
4. Copiá:
   - `Access Key ID`
   - `Secret Access Key`
   - `Endpoint` (algo como `https://abc123.r2.cloudflarestorage.com`)

---

## 4. Backend en Railway

1. Railway Dashboard → **New Project** → **Deploy from GitHub repo** → seleccionar tu repo
2. En la pantalla de configuración del servicio:
   - **Root Directory**: `backend`
   - **Builder**: Dockerfile (auto-detecta el `backend/Dockerfile`)
3. Click **Add Service** → **Database** → **PostgreSQL** (Railway crea la DB y expone `DATABASE_URL`)
4. (Opcional) **Add Service** → **Database** → **Redis**
5. **Variables** del servicio backend (copiar de `backend/.env.example`, llenar valores):

   ```
   NODE_ENV=production
   DATABASE_URL=${{Postgres.DATABASE_URL}}        ← referencia automática
   REDIS_URL=${{Redis.REDIS_URL}}                  ← solo si activaste Redis

   JWT_SECRET=<openssl rand -base64 48>
   JWT_REFRESH_SECRET=<openssl rand -base64 48>
   JWT_EXPIRES=15m
   JWT_REFRESH_EXPIRES=30d
   QR_HMAC_SECRET=<openssl rand -base64 32>

   APP_URL=https://soyclubify.com
   API_URL=https://api.soyclubify.com

   CORS_ROOT_DOMAIN=soyclubify.com
   CORS_EXTRA_ORIGINS=https://soyclubify.com,https://app.soyclubify.com

   S3_ENDPOINT=https://<r2_account>.r2.cloudflarestorage.com
   S3_BUCKET=clubify-media
   S3_ACCESS_KEY=<r2_access_key>
   S3_SECRET_KEY=<r2_secret>
   S3_REGION=auto
   S3_FORCE_PATH_STYLE=true
   ```

6. **Settings → Networking** → **Generate Domain** (te da uno tipo `clubify-backend.up.railway.app`)
7. **Settings → Domains** → **Custom Domain** → escribir `api.soyclubify.com`
   - Railway te muestra el CNAME exacto, copialo (ej. `xxx.up.railway.app`)
8. **Deploy** → la primera build tarda ~3-5 min. Verificá `https://<railway-url>/api/health` devuelve `{"ok":true}`

---

## 5. Frontend en Vercel

1. Vercel Dashboard → **Add New Project** → seleccionar el repo
2. **Framework Preset**: Next.js (auto-detecta)
3. **Root Directory**: `frontend`
4. **Environment Variables**:
   ```
   NEXT_PUBLIC_API_URL=https://api.soyclubify.com
   NEXT_PUBLIC_APP_URL=https://soyclubify.com
   ```
5. **Deploy** → primera build tarda ~2 min
6. **Settings → Domains** → agregar:
   - `soyclubify.com` (apex)
   - `www.soyclubify.com`
   - `app.soyclubify.com`
7. Vercel te muestra los DNS exactos para cada uno (próximo paso).

---

## 6. DNS en Cloudflare

Cloudflare Dashboard → soyclubify.com → **DNS → Records** → Add record:

| Type | Name | Content | Proxy | TTL |
|---|---|---|---|---|
| A | `@` | `76.76.21.21` | DNS only ☁ gris | Auto |
| CNAME | `www` | `cname.vercel-dns.com` | DNS only | Auto |
| CNAME | `app` | `cname.vercel-dns.com` | DNS only | Auto |
| CNAME | `*` | `cname.vercel-dns.com` | DNS only | Auto |
| CNAME | `api` | `<tu-app>.up.railway.app` | DNS only | Auto |

⚠ **Importante: el toggle "Proxy" en gris (DNS only)**, NO naranja. Vercel y Railway gestionan SSL ellos mismos; si activás el proxy de Cloudflare hay conflictos de cert. Si querés CDN de Cloudflare para assets estáticos, eso es otra historia.

⚠ **Wildcard `*`**: tu plan de Vercel debe permitirlo (Hobby permite hasta 50 dominios, Pro tiene wildcard nativo). Para empezar, podés omitir el wildcard y agregar manualmente los dominios custom de cada tenant.

---

## 7. Verificar SSL y rutas

Después de ~5-10 min:
- https://soyclubify.com → muestra el storefront (o landing si configuraste root rewrite)
- https://app.soyclubify.com → panel `/login`
- https://api.soyclubify.com/api/health → `{"ok":true,"db":true}`
- WebSocket: el kanban en `https://app.soyclubify.com/app/orders` debe mostrar **"En vivo"** verde

---

## 8. Seed inicial en producción

```bash
# Conectarse al backend de Railway por su consola web o CLI:
railway run npm run seed
```

Esto crea el plan, super admin (`admin@clubify.local` / `Clubify123!`) y el tenant demo. **Cambiar la contraseña inmediatamente** desde `/login` → `/app` → cambio de password (POST `/api/users/me/password`).

---

## 9. Custom domains de tenants

Cada tenant que quiera su propio dominio:
1. En tu DNS (Namecheap/Cloudflare/etc): `CNAME mibrand.com → cname.vercel-dns.com`
2. Vercel → tu proyecto → Settings → Domains → Add `mibrand.com` (Vercel emite SSL automáticamente)
3. Tenant en `/app/storefront` → escribe `mibrand.com` en "Dominio propio"
4. Listo: el middleware de Next.js detecta el host y reescribe a `/m/<slug>`

---

## 10. Checklist final post-deploy

- [ ] Login funciona: https://app.soyclubify.com/login
- [ ] Storefront carga: https://soyclubify.com/m/cafe-del-dia
- [ ] Hacer un pedido público de prueba
- [ ] Verificar que aparece en `/app/orders` con badge **En vivo** verde
- [ ] Subir una imagen en `/app/menu` → debe ir a R2 y mostrarse
- [ ] Cambiar password del admin
- [ ] Configurar dominio custom de un tenant (probar con un dominio adicional)

---

## Costos mensuales estimados

| Servicio | Plan | Costo/mes |
|---|---|---|
| Vercel | Hobby | $0 (hasta 100k requests) |
| Railway | Starter | $5–10 (incluye Postgres + Redis básicos) |
| Cloudflare R2 | Free | $0 (hasta 10GB) |
| Cloudflare DNS | Free | $0 |
| Namecheap | dominio | ~$1/mes (renovación anual) |
| **Total** | | **~$6–11/mes** |

Cuando crezcas:
- Vercel Pro $20 (wildcard domains, más bandwidth)
- Railway $20+ (DB más grande, más RAM)
- Postgres dedicado en Neon o Supabase si se necesita pgvector / réplicas
