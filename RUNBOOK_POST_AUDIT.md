# 🚀 Runbook — activar las 6 fases en producción

Todos los comandos para llevar a prod los commits `2b6cec9 · 1294e85 · 808f40c · 1c67894 · cc5f138 · f0372d1`.

Pegá cada bloque tal cual. Orden importa.

---

## 0. Pre-requisitos (instalá si falta)

```bash
# CLI de Railway, Vercel y GitHub
npm i -g @railway/cli vercel
brew install gh   # o https://cli.github.com

# Login
railway login
vercel login
gh auth login
```

---

## 1. Generar los 4 secrets nuevos

Guardalos en un password manager (1Password / Bitwarden) ANTES de pegarlos en Railway. Si perdés `BACKUP_ENCRYPTION_KEY` no podés restaurar backups.

```bash
echo "JWT_SECRET=$(openssl rand -base64 48)"
echo "JWT_REFRESH_SECRET=$(openssl rand -base64 48)"
echo "QR_HMAC_SECRET=$(openssl rand -base64 32)"
echo "BACKUP_ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "SWAGGER_PASSWORD=$(openssl rand -base64 24)"
```

Si los secrets de JWT/QR ya están vivos en prod, **no los rotes** salvo que tengas plan de migración (los refresh tokens y QR existentes se invalidarían).

---

## 2. Push a GitHub

```bash
cd /Users/jhonarias/Documents/AGENTES/CLUBIFY
git push origin main
```

CI corre automático en el push. Verificar:

```bash
gh run watch
```

Si el build pasa, seguí. Si falla, mirá los logs antes de deployar.

---

## 3. Setear secrets en Railway (backend)

Reemplazá `<VALOR>` con los outputs del paso 1. Las que ya existen (`JWT_SECRET` etc.) solo si las rotás.

```bash
cd /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend
railway link            # elegir el proyecto Clubify backend

# === Connection pool (Fase 4) ===
# Editá DATABASE_URL para agregar el query string al final:
railway variables --set 'DATABASE_URL=postgresql://USER:PASS@HOST:PORT/DB?connection_limit=20&pool_timeout=20'
# (copiá el actual valor de DATABASE_URL, agregale el ?connection_limit=... y pegalo)

# === Sentry (Fase 3) ===
railway variables --set 'SENTRY_DSN=https://xxx@oXX.ingest.sentry.io/XX'
railway variables --set 'SENTRY_RELEASE=fase-6-2026-05-12'

# === Swagger (Fase 6) ===
railway variables --set 'SWAGGER_USER=admin'
railway variables --set 'SWAGGER_PASSWORD=<paso1>'

# === Retention (Fase 4) — opcional, activar cuando estés cómodo ===
# railway variables --set 'RETENTION_ENABLED=true'

# === Backups (Fase 6) — opcionales, igual van en GH Actions ===
railway variables --set 'BACKUP_ENCRYPTION_KEY=<paso1>'

# Verificar todas las vars
railway variables
```

---

## 4. Setear secrets en Vercel (frontend Sentry)

```bash
cd /Users/jhonarias/Documents/AGENTES/CLUBIFY/frontend
vercel link             # elegir el proyecto Clubify frontend

# Sentry frontend. El --value es obligatorio (CLI v53+).
vercel env add NEXT_PUBLIC_SENTRY_DSN production --value 'https://xxx@oXX.ingest.sentry.io/XX'
vercel env add SENTRY_AUTH_TOKEN production --value 'sntrys_xxx'    # de sentry.io → Settings → Auth Tokens
vercel env add SENTRY_ORG production --value 'tu-org-slug'
vercel env add SENTRY_PROJECT production --value 'clubify-frontend'

vercel env ls
```

---

## 5. Setear secrets en GitHub Actions (backup nocturno)

```bash
cd /Users/jhonarias/Documents/AGENTES/CLUBIFY

# DATABASE_URL público de Railway (sin el internal ".railway.internal")
gh secret set PROD_DATABASE_URL --body 'postgresql://USER:PASS@public-host.proxy.rlwy.net:PORT/DB'

# R2 (las mismas credenciales que usa el backend)
gh secret set S3_ENDPOINT --body 'https://<account_id>.r2.cloudflarestorage.com'
gh secret set S3_BACKUP_BUCKET --body 'clubify-backups'          # crearlo en R2 si no existe
gh secret set S3_ACCESS_KEY --body '<R2 access key>'
gh secret set S3_SECRET_KEY --body '<R2 secret>'

# Key de cifrado (mismo del paso 1 — DEBE coincidir con la de Railway)
gh secret set BACKUP_ENCRYPTION_KEY --body '<paso1>'

# Sentry para el workflow de backup (opcional)
gh secret set SENTRY_DSN --body 'https://xxx@oXX.ingest.sentry.io/XX'

# Verificar
gh secret list
```

---

## 6. Deploy del backend a Railway

El webhook GitHub→Railway está roto (memoria del proyecto), por eso usamos el script.

```bash
cd /Users/jhonarias/Documents/AGENTES/CLUBIFY

# Exportar la URL pública de la DB para que migrate corra desde local
export PROD_DATABASE_URL="$(railway variables --kv | grep ^DATABASE_URL= | cut -d= -f2-)"

# Deploy: corre prisma migrate deploy + railway up
./scripts/deploy-railway.sh

# Ver logs
railway logs --tail
```

Si `prisma migrate deploy` falla en alguna migración nueva (Fase 1 RefreshToken, Fase 4 Pass index), revisar el output antes de continuar — las migraciones son lo más sensible.

---

## 7. Frontend Vercel: trigger redeploy

Vercel sí auto-deploya en push a main, pero por las nuevas env vars (Sentry) hay que rebuildear:

```bash
cd /Users/jhonarias/Documents/AGENTES/CLUBIFY/frontend
vercel --prod
```

---

## 8. Smoke tests post-deploy

```bash
# 1) Health del backend
curl -sf https://api.soyclubify.com/api/health | jq .
# Esperado: {"ok":true,"uptime":..., ...}

# 2) Versioning compat — los dos deben funcionar igual
curl -sf https://api.soyclubify.com/api/health
curl -sf https://api.soyclubify.com/api/v1/health

# 3) Swagger gated — sin creds debe ser 401
curl -sI https://api.soyclubify.com/api/docs
# Esperado: HTTP/2 401  +  WWW-Authenticate: Basic realm="Clubify API Docs"

# 4) Swagger con creds — debe servir HTML
curl -sf -u "admin:$SWAGGER_PASSWORD" https://api.soyclubify.com/api/docs | head -5

# 5) Login + refresh rotation
TOKEN=$(curl -s -X POST https://api.soyclubify.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<tu admin>","password":"<password>"}' | jq -r .refreshToken)

# Primera rotación: OK
NEW=$(curl -s -X POST https://api.soyclubify.com/api/auth/refresh \
  -H 'Content-Type: application/json' \
  -d "{\"refreshToken\":\"$TOKEN\"}" | jq -r .refreshToken)
echo "Nuevo refresh: ${NEW:0:20}…"

# Reusar el viejo: debe fallar 401 (reuse detection)
curl -sI -X POST https://api.soyclubify.com/api/auth/refresh \
  -H 'Content-Type: application/json' \
  -d "{\"refreshToken\":\"$TOKEN\"}"
# Esperado: HTTP/2 401
```

---

## 9. Trigger primer backup manual (verificación)

```bash
# Disparar workflow desde la CLI
gh workflow run backup.yml

# Esperar y ver logs
sleep 30
gh run watch
```

Verificar que el archivo apareció en R2:

```bash
aws --endpoint-url=https://<account_id>.r2.cloudflarestorage.com \
    s3 ls s3://clubify-backups/backups/
# Esperado: backups/2026-05-12T...sql.gz.enc  (varios MB)
```

---

## 10. Probar restore en staging (CRÍTICO)

**No saltes este paso.** Un backup que nunca restauraste no es un backup, es esperanza.

```bash
# Crear una DB local de staging
docker run -d --name clubify-staging -p 5433:5432 \
  -e POSTGRES_USER=clubify -e POSTGRES_PASSWORD=clubify \
  -e POSTGRES_DB=clubify_staging postgres:16

# Restore del último backup
cd /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend
export TARGET_DATABASE_URL='postgresql://clubify:clubify@localhost:5433/clubify_staging'
export S3_ENDPOINT='<paso 5>'
export S3_BUCKET='clubify-backups'
export S3_ACCESS_KEY='<paso 5>'
export S3_SECRET_KEY='<paso 5>'
export BACKUP_ENCRYPTION_KEY='<paso 1>'

node scripts/restore-db.mjs --latest

# Verificar
psql $TARGET_DATABASE_URL -c 'SELECT COUNT(*) FROM "Tenant";'
psql $TARGET_DATABASE_URL -c 'SELECT COUNT(*) FROM "Customer";'

# Limpieza
docker stop clubify-staging && docker rm clubify-staging
```

Si el restore falla, **resolvelo antes de seguir** — los backups solo sirven si se pueden restaurar.

---

## 11. Activación gradual de retention (después de 1-2 días estables)

Cuando estés cómodo con el deploy + tengas backup probado:

```bash
railway variables --set 'RETENTION_ENABLED=true'
railway up --detach   # redeploy para tomar la env nueva
```

Primer run del cron: 3:15 AM UTC del día siguiente. Verificá en logs:

```bash
railway logs | grep -i retention
# Esperado eventualmente:
# [Nest] RetentionService — Retention OK · events=N auditLogs=N notifications=N refreshTokens=N
```

---

## 12. (Opcional) CDN custom domain R2

Para servir uploads desde `cdn.soyclubify.com` en lugar de `pub-*.r2.dev`:

1. R2 dashboard → bucket `clubify-media` → Settings → Public access → **Connect a custom domain** → `cdn.soyclubify.com`.
2. DNS (Cloudflare): CNAME `cdn` → `<bucket-id>.r2.cloudflarestorage.com` (proxy ON).
3. Railway:
   ```bash
   railway variables --set 'S3_PUBLIC_URL=https://cdn.soyclubify.com'
   railway up --detach
   ```
4. Frontend (`next.config.js`) ya whitelista ese hostname.

---

## Rollback rápido si algo se rompe

```bash
# Backend: rollback al commit anterior
cd /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend
git revert HEAD --no-edit && git push
./scripts/deploy-railway.sh --no-migrate    # importante: NO re-correr migrations

# Frontend
cd ../frontend && vercel rollback
```

Para revertir **migraciones específicas** (Fase 1, 4, 6) hay que correr SQL custom — no hay `prisma migrate rollback`. Si necesitás eso, parate y pedí ayuda antes de hacer drop.

---

## Checklist de verificación final

Después de los pasos 1-9 debería tener:

- [ ] `/api/health` responde 200
- [ ] `/api/v1/health` responde igual (compat OK)
- [ ] `/api/docs` requiere basic auth en prod
- [ ] Refresh rotation revoca el viejo (paso 8 #5)
- [ ] CI verde en el último commit de main
- [ ] Backup nocturno disparado manualmente subió archivo a R2
- [ ] Restore funciona en staging (paso 10)
- [ ] Sentry recibió el primer evento de prueba (forzar un error con curl)

Si los 8 ✓ → fases 1-6 LIVE en prod. 🎉
