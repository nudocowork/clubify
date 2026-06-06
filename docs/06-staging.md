# Entorno staging — guía completa

Documenta la arquitectura, el flujo de deploy y los procedimientos
operacionales del entorno **staging** de Clubify. Implementado en el sprint
2026-06 (item 5 — "Entorno de testing y despliegue").

---

## 1. Objetivo

Reducir el riesgo de romper producción ofreciendo un entorno **idéntico a
prod** donde validar cambios antes del deploy final.

**Flujo deseado:**

```
Desarrollo (local) → Staging → Producción
```

Ninguna PR llega a `main` (= prod) sin haber pasado primero por staging.

---

## 2. Arquitectura

### 2.1 Branches

| Branch | Entorno | URL |
|---|---|---|
| feature branch | local | localhost |
| `staging` | Railway staging + Vercel staging | https://staging.app.soyclubify.com + https://staging.api.soyclubify.com |
| `main` | Railway production + Vercel prod | https://app.soyclubify.com + https://api.soyclubify.com |

### 2.2 Railway

Project: `clubify`. Dos environments dentro del mismo proyecto:

- **production** (existente) — services: `backend`, `Postgres-Nq8w`, `Redis`.
- **staging** (nuevo) — services: `backend-staging`, `Postgres-staging`, `Redis-staging`.

Razón de tener un proyecto único con 2 envs: simplifica permisos, billing y
referencias cross-service. Railway environments son aislados — variables y
volúmenes no se cruzan.

### 2.3 Vercel

Project: `clubify-frontend`. Branch protection configurada:

- `main` → producción (`app.soyclubify.com`).
- `staging` → preview deployment con alias permanente `staging.app.soyclubify.com`.
- Otras branches → preview URLs efímeras `<branch>-<hash>.vercel.app`.

### 2.4 DNS

CNAMEs adicionales en el dashboard de Vercel/Cloudflare:

- `staging.app.soyclubify.com` → cname.vercel-dns.com (Vercel)
- `staging.api.soyclubify.com` → CNAME del backend-staging Railway (formato `<service>-<env>.up.railway.app`)

---

## 3. Setup inicial (one-shot)

### 3.1 Railway environment staging

**Vía dashboard (recomendado, más seguro que CLI):**

1. Ir a https://railway.com/project/ba90d94d-7e6d-4056-85ad-0e3f24e8d43a
2. Settings → Environments → "+ New Environment" → nombre `staging`. **Source: clonar desde `production`** (Railway copia los services y env vars como template).
3. Verificar que los 3 services nuevos (`backend`, `Postgres`, `Redis`) se hayan creado en el env staging. Renombrarlos a `backend-staging`, `Postgres-staging`, `Redis-staging` para claridad.
4. En `backend-staging`:
   - **Settings → Source → Branch:** cambiar de `main` a `staging`.
   - **Variables:** las copia automáticamente. Sobrescribir las que tengan que ser distintas:
     - `NODE_ENV=staging`
     - `JWT_SECRET` ⚠️ NUEVO (no compartir con prod)
     - `QR_SIGNING_SECRET` ⚠️ NUEVO
     - `HOTMART_WEBHOOK_SECRET` ⚠️ NUEVO (sandbox de Hotmart, NO el de prod)
     - `APPLE_PASS_*` → usar certificados de DEV team si los hay, sino comentar (las wallet passes no van a funcionar en staging).
     - `GROW_BUSINESS_API_KEY` → opcional usar la misma API key que prod (los SMS van a salir reales — cuidado). Recomendado: dejar vacía para que el send sea no-op.
     - `DATABASE_URL` → debe apuntar al `Postgres-staging` recién creado (Railway lo conecta auto si el env var usa `${{Postgres-staging.DATABASE_URL}}`).

### 3.2 Vercel staging

**Vía dashboard:**

1. Ir a https://vercel.com/nudocowork/clubify-frontend/settings/git
2. **Production Branch:** confirmar que sea `main`.
3. **Domains:** agregar `staging.app.soyclubify.com`, asignarlo a la branch `staging` (no a Production).
4. **Environment Variables:** agregar/sobrescribir scope `Preview` cuando branch=`staging`:
   - `NEXT_PUBLIC_API_URL=https://staging.api.soyclubify.com`
   - `NEXT_PUBLIC_LANDING_URL=https://staging.soyclubify.com`

### 3.3 DNS

En el dashboard del registrador (Namecheap/Cloudflare según `reference_subdomain_dns_setup.md`):

- CNAME `staging.app` → `cname.vercel-dns.com`
- CNAME `staging.api` → URL del `backend-staging` (Railway lo da en Settings → Networking → Public Domain)

Esperar propagación (1-30min).

### 3.4 Clone prod data a staging

Ver sección 5.

---

## 4. Workflow de deploy

### 4.1 Para una feature nueva

```bash
git checkout main
git pull
git checkout -b feat/mi-feature
# … hago cambios …
git push -u origin feat/mi-feature
gh pr create --base staging --title "..."   # PR contra staging, NO main
```

Una vez mergeado a `staging`:

- Railway `backend-staging` deploya automático.
- Vercel staging deploya automático.
- Validar en `https://staging.app.soyclubify.com` durante 24-48hrs.

Si pasa la validación:

```bash
git checkout main
git pull
git merge staging   # o PR de staging → main desde GitHub UI
git push origin main
```

Railway `backend` (prod) y Vercel prod deployan.

### 4.2 Hotfix

Si hay un bug crítico en prod que no se puede esperar:

```bash
git checkout main
git pull
git checkout -b hotfix/<descripcion>
# … fix …
gh pr create --base main --title "hotfix: ..."
```

Mergear directo a main. **Después:** rebase del hotfix sobre `staging` para mantener sync:

```bash
git checkout staging
git pull
git merge main
git push
```

---

## 5. Clone prod DB → staging (con anonimización PII)

### 5.1 Script

`backend/scripts/clone-prod-to-staging.cjs` — toma snapshot de prod, lo
restaura en staging, y anonimiza datos sensibles.

**Ejecutar:**

```bash
cd backend
railway run --service Postgres-Nq8w bash -c 'pg_dump $DATABASE_URL --no-owner > /tmp/prod-snapshot.sql'
railway run --service Postgres-staging bash -c 'psql $DATABASE_URL < /tmp/prod-snapshot.sql'
node scripts/anonymize-staging.cjs
```

### 5.2 Qué anonimiza

| Tabla | Campo | Reemplazo |
|---|---|---|
| User | email | `staging+<id>@example.com` |
| User | phone | `+57300<id_8d>` |
| Tenant | email, whatsappPhone | similar |
| CrmContact | email, phone, name | `Contact <id>` |
| Order | customerName, customerPhone | `Cliente <id>` |
| ReferralUse | utm* | NULL |

### 5.3 Frecuencia

Semanal por defecto. Manual cuando se necesita probar con datos de prod
recientes (ej. reproducir un bug de un tenant específico).

---

## 6. Rollback rápido

### 6.1 Railway

**Dashboard:** Service → Deployments → último deploy bueno → ⋯ → Redeploy.

**CLI** (más arriesgado, requiere conocer el deploy ID):

```bash
railway service backend
railway redeploy <deploy_id>
```

Ver [[reference_railway_redeploy_uses_snapshot]] para gotchas.

### 6.2 Vercel

**Dashboard:** Deployments → último deploy bueno → ⋯ → Promote to Production.

---

## 7. Costos

| Recurso | Costo mensual |
|---|---|
| Railway staging — backend service | ~$5 |
| Railway staging — Postgres | ~$7 |
| Railway staging — Redis | ~$3 |
| Vercel staging branch | $0 (incluido en plan) |
| **Total** | **~$15/mes** |

Pausar staging cuando no se usa: en Railway dashboard, `backend-staging` y
`Postgres-staging` → Settings → Pause Service. Re-activar cuando se necesita.

---

## 8. Checklist post-setup

Después de Etapas 1-4 del sprint, validar:

- [ ] `https://staging.api.soyclubify.com/api/health` retorna `200 ok:true`.
- [ ] `https://staging.app.soyclubify.com` carga la landing.
- [ ] Login en staging con un user de prueba funciona.
- [ ] Crear un Infolink en staging y abrirlo desde el viewer público.
- [ ] Crear un Order en staging y verificar que NO llega SMS a Javier/Jhon
      (GROW_BUSINESS_API_KEY desactivada).
- [ ] Webhook Hotmart test (sandbox) llega y procesa correctamente.
- [ ] Backup automático de staging activado (Railway → Postgres → Backups).

---

## 9. Cuando NO usar staging

Cambios que SÍ pueden ir directo a main (skip staging):

- Typos en copy del frontend.
- Bumps de versión de deps menores sin breaking changes.
- Hotfix de emergencia (ver sección 4.2).

Cambios que SIEMPRE deben pasar por staging:

- Schema migrations.
- Cambios en flujo de pago/billing.
- Cambios en URL/routing.
- Cualquier cambio que toque > 5 archivos.
- Cambios en el motor de Sequences/automations.

---

Relacionado:
- `docs/05-deployment.md` — deploy general.
- Memorias `reference_railway_*` — gotchas de Railway.
- Memoria `reference_subdomain_dns_setup.md` — config de DNS de subdominios.
