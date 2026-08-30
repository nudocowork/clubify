# Bitácora de trabajo — traspaso entre máquinas

> Trabajamos este producto desde **más de una máquina**, y las dos despliegan al
> mismo producción. Esta bitácora es el único punto donde la otra máquina se
> entera de lo que pasó acá.
>
> **Regla: si tocaste producción o dejaste algo a medias, escribe la entrada y
> haz push. Aunque no hayas terminado.** Una entrada corta hoy vale más que una
> completa dentro de tres días.

## Cómo escribir una entrada

Se agrega **arriba** (lo más nuevo primero), con este formato:

```markdown
## AAAA-MM-DD — Título corto de lo que se hizo
**Máquina/quién:** ...
**Rama / PR:** ...

### Qué cambié
- ...

### Qué toqué de PRODUCCIÓN
- (base de datos, variables, despliegues... o "nada")

### Qué falta / qué hay que validar del otro lado
- [ ] ...

### Riesgos y avisos
- ...
```

Las tres secciones que de verdad importan son **PRODUCCIÓN**, **qué falta** y
**riesgos**: son las que evitan que el otro lado rompa algo sin saberlo.

Antes de desplegar o migrar, lee también [ESTADO-PRODUCCION.md](./ESTADO-PRODUCCION.md).

---

> **Arqueo del ecosistema entero (2026-08-20):**
> [`docs/ARQUEO-ECOSISTEMA.md`](ARQUEO-ECOSISTEMA.md) — 7 auditorías en paralelo
> sobre Clubify PRO, TeamClubify y las marcas blancas. 22 hallazgos ordenados por
> daño, con una sección de **refutados**: tres afirmaciones que sonaban ciertas y
> no lo eran. Empezar por el bucle cancelar/reactivar y por `QrPoster`, que es el
> 77% de la base de datos.

> **Análisis completo de lo construido:** [`docs/ANALISIS-CORREOS.md`](ANALISIS-CORREOS.md)
> — de la plantilla a la lectura de conjunto, con cómo se comprobó cada cosa y
> qué quedó **sin** comprobar.

## 2026-08-30 — Fuga cross-marca + avisos de cobro silenciosos (DESPLEGADO)

**Máquina/quién:** máquina de Jhon (Claude)
**Commits:** `9a7a2b2c`, `6052ec91`

### 🔓 Fuga cross-marca en el listado de negocios de una cuponera

Al listar negocios para vincular como aliado Tipo A, el filtro era:

    ...(campaign.whiteLabelId ? { whiteLabelId: campaign.whiteLabelId } : {})

Con marca nula el spread queda vacío y **desaparece el filtro entero**: devuelve
TODOS los negocios de la plataforma (107 hoy, en 4 marcas) a un CUPONERA_ADMIN.
Estaba en dos sitios (panel de la cuponera y picker del Master Admin).

**No hacía falta un error humano:** `BenefitCampaign.whiteLabelId` es
**onDelete: SetNull**, así que borrar una marca deja su cuponera sin marca y el
aislamiento se cae solo. Ahora falla CERRADO: sin marca no lista nada y loguea.

Hoy NO estaba sangrando (living-card sí tiene marca, verificado).

### Avisos de cobro: por qué no salió el SMS

Los tres `notifyOwner` hacían `if (!target) return;` sin log. El aviso va ahora
en `resolveBillingTarget`, que es el único que conoce el motivo, y distingue la
decisión del negocio (avisos apagados → silencio) de la mala configuración (sin
credenciales o sin teléfono → warning).

Medido: de 96 negocios con avisos encendidos, **1** sin por dónde enviar y **3**
sin teléfono, de los cuales solo uno es un negocio real (La Parada Bar Truck).
Primero conté 51; estaba mal — `ownerPhone` cae a `whatsappPhone`/`phone`.

### Qué toqué de PRODUCCIÓN

- Backend desplegado. Swap verificado (uptime 2410 s → 8 s). Base: sin cambios.

### 🌳 Cómo se desplegó, que importa para la próxima

El árbol tenía **4 archivos sin commitear de la otra sesión**. Como `railway up`
sube el DIRECTORIO, desplegar habría publicado su trabajo a medio hacer.

Se desplegó desde un **worktree limpio de HEAD**, sin tocar ni un archivo del
árbol principal:

```bash
git worktree add --detach /tmp/clubify-deploy-limpio HEAD
cd /tmp/clubify-deploy-limpio
railway link --project ba90d94d-7e6d-4056-85ad-0e3f24e8d43a --environment production --service backend
railway up --service backend
```

⚠️ `railway up <ruta>` NO funciona (`prefix not found`): hay que `cd` al
worktree y enlazarlo, porque el link de Railway es **por carpeta**.

**Esto reemplaza al `git stash` antes de desplegar**, que ya barrió trabajo en
vuelo tres veces esta semana.

---

## 2026-08-30 — Sellea: fugas de marca en aviso interno + correo de compra (Jhon)
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** feat/commissions-auto-cutoffs (commit b7e1d5e2)

### Qué cambié
- **SMS interno de preregistro** decía "Nuevo preregistro en Clubify / Revisar
  en Clubify" para un negocio de Sellea → ahora dice el nombre de la marca
  (`alertSignup`/`buildMessage` reciben `brandName`; el call site pasa
  `welcomeBrandRow.whiteLabel.name`). NOTA: el ruteo (línea + destinatarios
  Javier/Jhon) SIGUE siendo el equipo de la plataforma — es monitoreo central,
  no se cambió; solo el TEXTO.
- **Correo "Recibimos tu pago — crea tu cuenta"** salía con el morado default
  (#6366F1) + inicial de la marca en vez del logo/color reales. Causa: el correo
  del comprador NO tiene tenant, y el logo/color solo venían del tenant.
  `BRAND_EMAIL_SELECT` ahora trae `logoUrl/iconUrl/primaryColor`, `ResolvedBrand`
  los lleva y `renderHtml` cae al color/logo de la MARCA cuando no hay tenant.

### Qué toqué de PRODUCCIÓN
- Deploy backend. Sin migración, sin DB.

### Qué falta / PENDIENTE GRANDE (trial de 7 días)
- [ ] **Ciclo del trial mal:** hoy al pagar el negocio queda ACTIVE + vence en
      1 MES. Debe ser: día 0 = TRIAL/demo con vencimiento a 7 días (sin consumir
      crédito); día 7 = Stripe cobra → ACTIVE + consume 1 crédito Fidelity.
      La activación (`stripe.service.activate`) fija `currentPeriodEnd` a
      `addPlanPeriod(now, MENSUAL)` cuando `ctx.nextCharge` es null; nunca honra
      `trial_end`. `consumeTrialConversionCredit` (día 7) ya existe pero no
      cambia estado ni fecha. BLOQUEANTE: confirmar que el Payment Link de Stripe
      tenga `trial_period_days=7` (hoy la suscripción cobró y quedó Mensual).
- [ ] **/activar muestra "USD 68"** (precio global Clubify) en vez de "USD 80"
      (precio de Sellea). Lee `/api/landing-plans` (global), no el precio por
      marca. La página de facturación sí es brand-aware (WhiteLabelPaymentLink).
- [ ] Mensaje WhatsApp "Próximo cobro: 30 sept" y panel admin (ESTADO Activo,
      VENCE Sep 30) dependen del ciclo del trial de arriba.

---

## 2026-08-30 — Sellea: pago→crear cuenta tal cual Clubify (/activar) (Jhon)
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** feat/commissions-auto-cutoffs (commit 0ff64bf8)

### Qué cambié
- **`check-pending` ahora reconoce el pago de Stripe.** `checkPendingPayment`
  solo miraba `PendingHotmartPayment`; si no hay, ahora lee
  `PendingStripePayment` (marcas con Stripe, ej. Sellea). Sin esto, un
  comprador de Sellea que SÍ pagó veía "Todavía no vemos un pago" en /activar.
  Nuevo `checkPendingStripePayment` (nombre/teléfono/monto del evento Stripe;
  periodicidad null → el signup toma el plan de la suscripción al consumir).
- **`/activar/layout.tsx` (NUEVO)** con `AuthBrandServer`: la página de crear
  cuenta hereda el color de la marca. Sin layout salía en verde Clubify.
- **`authBrandCss` cubre gradientes** `from/via/to-brand` + `accent-brand`. El
  aside con degradado de /activar quedaba verde (el override por atributo no
  alcanza las vars `--tw-gradient-*`). Scopeado a `.brand-auth`.

### Cómo es el flujo (para entenderlo)
Ambas marcas: pagar → caer en `/activar` → llenar datos → `POST /auth/signup`
crea el tenant y consume el pago pendiente → ACTIVE. NO hay auto-creación de
cuenta. El redirect Stripe→/activar NO está en el código: es un ajuste del
Payment Link en el panel de Stripe ("after completion" → URL /activar).

### Qué toqué de PRODUCCIÓN
- Deploy backend (check-pending) + frontend (/activar layout + gradientes).
  Sin migración, sin DB.

### Qué falta / qué hay que validar del otro lado
- [ ] **OPERATIVO (dueño):** en cada Payment Link de Sellea en Stripe, poner
      "After completion → Redirect to" = `https://www.selleala.com/activar`.
      Sin eso, el comprador queda en la página de Stripe y solo llega a
      /activar por el correo de recuperación (async), no directo.

### Riesgos y avisos
- `check-pending` no recibe marca: consulta Hotmart y luego Stripe por email.
  Hotmart tiene precedencia (Clubify intacto).
- Gradientes de marca en `.brand-auth` afectan a TODAS las páginas de auth de
  marcas blancas (login/signup/activar/prueba/afiliado): antes salían en verde
  Clubify (bug), ahora en el color de la marca. Clubify (sin `.brand-auth`)
  intacto.

---

## 2026-08-30 — Fix: /prueba de Sellea salía en verde Clubify (faltaba layout) (Jhon)
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** feat/commissions-auto-cutoffs (commit cdfdcaa1)

### Qué cambié
- `app/prueba/layout.tsx` (NUEVO) con `AuthBrandServer`. La página no tenía
  layout propio → no recibía la clase `.brand-auth` ni el `authBrandCss` → todo
  lo `brand` (pill "🎁 Prueba", botón `.btn-primary`, links `text-brand`) salía
  en VERDE Clubify aunque la marca fuera Sellea (naranja #FF4D3D). Mismo patrón
  que `/login`, `/registro-afiliado`, `/affiliate`.

### Qué toqué de PRODUCCIÓN
- Redeploy frontend. Sin backend, sin DB.

### Riesgos y avisos
- El root layout solo siembra el CONTEXTO de marca (para el logo); NO inyecta el
  override de color. Toda página pública en dominio de marca necesita su
  `layout.tsx` con `AuthBrandServer` o saldrá en verde. Regla durable.

---

## 2026-08-30 — Fix: /prueba de Sellea no veía el enlace de Stripe (semilla SSR) (Jhon)
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** feat/commissions-auto-cutoffs (commit edc05276)

### Qué cambié
- `lib/server-brand.ts` `resolveAuthBrandForHost`: ahora copia
  `trialCheckoutUrl`+`trialDays` a la semilla SSR de la marca. Sin eso,
  `useAuthBrand` (que omite el fetch del cliente cuando hay semilla SSR) dejaba
  `brand.trialCheckoutUrl` en undefined → `/prueba` mostraba "Prueba no
  disponible" aunque el admin ya había pegado el enlace de Stripe.
- El backend YA devolvía los campos (verificado por curl a
  `branding-by-host?host=www.selleala.com`). Solo faltaba en el SSR del front.

### Qué toqué de PRODUCCIÓN
- Redeploy frontend. Sin backend, sin DB.

### Riesgos y avisos
- Aditivo: otras marcas cargan `trialCheckoutUrl: null` en la semilla si no
  tienen enlace (comportamiento idéntico al de antes). Clubify (brand null) usa
  su vía global `/api/branding`, intacta.

---

## 2026-08-30 — Sellea: correo y cumpleaños OBLIGATORIOS en el registro de tarjeta (Jhon)
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** feat/commissions-auto-cutoffs (commit b8823a32)

### Qué cambié
- En el formulario público de instalación de tarjeta (`/c/[cardId]`), el correo
  y el cumpleaños pasan de opcionales a **obligatorios SOLO para Sellea**
  (`brand.slug` = `sellea`/`selleala`). Las demás marcas y Clubify quedan igual.
- Frontend (`c/[cardId]/page.tsx`): `FormFields` marca ambos como requeridos,
  quita el "(opcional)" de la etiqueta (nuevas claves i18n `card.email_required`,
  `card.birthday_required` + sus `_err` en es/en/pt/it), valida al enviar y
  bloquea el botón hasta completarlos. `BrandBadgeBrand` gana `slug?` (aditivo).
- Backend (`passes.service.ts` `enrollPublic`): exige correo + cumpleaños válido
  cuando la marca es Sellea (400 con mensaje claro), como defensa ante un POST
  directo a la API. Resuelve la marca por `resolveByWhiteLabelId`.

### Qué toqué de PRODUCCIÓN
- **Sin migración** (las columnas `email`/`birthday` ya existen y son nulables;
  solo se refuerza a nivel de app). Despliegue backend + frontend.

### Qué falta / qué hay que validar del otro lado
- [ ] Verificar en vivo en un dominio Sellea que ambos campos salen requeridos y
      que otra marca (o Clubify) los sigue mostrando opcionales.

### Riesgos y avisos
- Gate por slug hardcodeado (`sellea`/`selleala`), mismo criterio que
  `slug-alias.ts`. Si Sellea cambiara de slug habría que ajustarlo aquí.
- Un cliente Sellea que ya se había registrado sin correo/cumpleaños, al
  reinstalar deberá completarlos (backfillea datos faltantes, no duplica).

---

## 2026-08-30 — Sellea: página dedicada de prueba /prueba (por marca) (Jhon)
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** feat/commissions-auto-cutoffs (commits 1a88dd51, fc0ea78b)

### Qué cambié
- Página dedicada de prueba SIN migración (Settings por-marca
  `landing.trial.checkoutUrl.<slug>` + `landing.trial.days.<slug>`).
- Admin: Superadmin → Marcas → **"Enlace de prueba (N días)"** (pega la URL de
  Stripe + días). Endpoints `GET/PATCH /superadmin/white-labels/:id/trial-config`.
- `branding-by-host` expone `trialCheckoutUrl`+`trialDays` → `useAuthBrand`.
- `/prueba` (TrialSignupClient) BRAND-AWARE (logo/color/nombre de la marca, ya no
  `<Logo>` Clubify), usa el enlace y días de la marca; flujo botón→Stripe→/activar.
  Marca blanca sin enlace → "prueba no disponible". Clubify intacto.
- 🚨 SELLEA-ONLY: `consumeTrialConversionCredit` ahora exige el enlace de prueba
  configurado (opt-in por-marca) además del trial_end → otras marcas TAL CUAL.

### Qué toqué de PRODUCCIÓN
- Backend (deployment fc9c16c3) + frontend (Vercel) desplegados. Sin migración.

### Qué falta / qué hay que validar del otro lado
- [ ] OPERATIVO: crear en Stripe (Sellea) el Payment Link con 7 días de prueba y
      pegarlo en Superadmin → Marcas → Sellea → "Enlace de prueba".
- [ ] Cohete 🚀 del panel afiliado (pendiente error de consola).

### Riesgos y avisos
- Aislado por marca: solo Sellea (única con enlace de prueba) recibe la feature.

---

## 2026-08-29 — Sellea: enlace de prueba 7 días + varios fixes de marca (Jhon)
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** feat/commissions-auto-cutoffs (commits c219c013, 0dfbcce4)

### Qué cambié
- **Batch UI de Sellea (frontend, c219c013):** registro de afiliado muestra
  monto fijo "$N pago único" (no %); link de términos → relativo + se CREÓ
  `src/app/terminos/page.tsx` brand-aware (fin del 404); tabs verdes → naranja
  (`.tab-active` en panel-brand-theme, admin + `.brand-auth`); panel de afiliado
  con theme de marca (`app/affiliate/layout.tsx`).
- **Prueba de 7 días (backend, 0dfbcce4):** ADITIVO, no cambia la compra directa.
  El "demo 7 días" es un Stripe Payment Link con `trial_period_days=7` (se crea en
  Stripe, externo). El negocio queda ACTIVE desde el día 0 (webhook de siempre) y
  a los 7 días Stripe cobra. NUEVO: `stripe.service.consumeTrialConversionCredit`
  consume 1 crédito de la marca SOLO en el cobro real de una suscripción que tuvo
  prueba (`trial_end`), idempotente, race-safe. La compra directa (sin prueba) no
  entra.

### Qué toqué de PRODUCCIÓN
- Frontend desplegado (Vercel, ready). Backend desplegado (Railway, deployment
  97225ad0). Sin migración de DB.

### Qué falta / qué hay que validar del otro lado
- [ ] **Operativo (no código):** crear en Stripe (cuenta de Sellea) el Payment
      Link con 7 días de prueba y pegarlo como enlace externo de la prueba.
- [ ] Cohete 🚀 del panel de afiliado "no abre" — pendiente de reproducir en el
      navegador (revisar consola). El código es un toggle correcto sin blocker.
- [ ] `/terminos` tiene contenido genérico/editable — que lo revise legal.

### Riesgos y avisos
- El consumo de crédito en la conversión es best-effort (si falla, el negocio
  queda activo igual). Solo afecta negocios que entraron por prueba con Stripe.
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** feat/commissions-auto-cutoffs (commit 9e7c5122)

### Qué cambié
- Regla del dueño: "las fechas = cuando se activan los créditos, y la marca
  blanca no las modifica". Raíz: `activateTenant` calculaba el periodo desde el
  `currentPeriodEnd` previo si era futuro → apilaba el tiempo de PRUEBA/ventana
  ilimitada (Vizage 28-sep en vez de 14-sep; Farmacia 26-oct en vez de 28-ago).
- `activateTenant`: `newPeriodEnd = addPlanPeriod(hoy, periodicidad)` (anclado a
  la activación, sin apilar).
- `PATCH /tenants/:id/billing`: admin de MARCA BLANCA ya no fija `nextChargeDate`
  arbitrario (se ancla a hoy+periodo); plataforma conserva el override.

### Qué toqué de PRODUCCIÓN
- **Desplegado backend** (`desplegar.cjs backend`; swap verificado, deployment
  6c23a6ea Online, /api 200). Sin migración.
- DATOS: Vizage ya corregido ayer (28-sep→14-sep). **PENDIENTE de aplicar**
  `backend/scripts/fix-sellea-period-anchor.cjs --apply` (lo corre Jhon; el
  clasificador bloquea escrituras a prod desde la sesión) → Farmacia FarCentro
  26-oct→28-ago. **OJO: Farmacia queda VENCIDA y el cron le cobrará 1 crédito a
  SELLEA** — decisión aprobada por el dueño (anclado estricto a la activación).

### Qué falta / qué hay que validar del otro lado
- [ ] Correr el script de datos de Farmacia (arriba). Los otros 5 negocios de
      Sellea ya estaban correctos (currentPeriodEnd = último cobro + periodo).

### Riesgos y avisos
- Cambio en lógica de facturación (activación por crédito). Solo afecta el
  cálculo del próximo cobro al activar; no toca renovaciones (webhook/cron) ni
  otras marcas más allá de la regla general de anclaje.

---

## 2026-08-28 — Panel de comisiones de Sellea muestra MONTO FIJO, no % (Jhon)
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** feat/commissions-auto-cutoffs (commit 657399c8)

### Qué cambié
- El motor ya generaba la comisión fija de Sellea, pero **el panel de referidos
  seguía mostrando y pidiendo PORCENTAJES** (Configuración, columnas de las
  tablas de influencers/embajadores, modales de creación). Desinformaba.
- `getConfig` (backend) ahora devuelve `commissionMode` + `fixed{negocio,
  influencer,embajador}`, resuelto por `user.whiteLabelId`. Marcas no-fijas →
  `PERCENT_RECURRING` + `fixed:null` (UI de % idéntica a la de siempre).
- `admin/referrals`: el modo se resuelve una vez en el componente raíz y se
  propaga por contexto (`useCommissionMode`). En FIXED_ONCE: ConfigTab muestra
  panel de montos fijos (y oculta el socio global); columnas "%" → monto fijo;
  modales de creación → campo de monto fijo de solo lectura. i18n es/en/pt.

### Qué toqué de PRODUCCIÓN
- **Desplegado backend** (`desplegar.cjs backend`; nuevo deployment Online, ID
  coincide) **y frontend** (READY). Sin cambios de DB ni de variables.
- Verificado en prod: `/api/referrals/public-terms` → Sellea `{fixedOnce:true,
  negocio 30, influencer 80, embajador 40}`; sin Origin (Clubify) `{fixedOnce:false}`.

### Qué falta / qué hay que validar del otro lado
- [ ] Confirmar visualmente en Sellea → Referidos → Configuración que se ven los
      montos fijos (no %). `getConfig` es con auth → no se pudo curl-verificar.

### Riesgos y avisos
- Aislado por marca. Si el fetch de config falla / no hay permiso, cae a
  `PERCENT_RECURRING` (UI de % de siempre) → nunca rompe otras marcas.

---

## 2026-08-28 — Mensaje de credenciales del afiliado: dice la MARCA, no "Clubify" (Jhon)
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** feat/commissions-auto-cutoffs (commit d92de228)

### Qué cambié
- `AffiliateCredentialsModal.tsx`: el mensaje que el admin copia/envía al nuevo
  afiliado (influencer/embajador) decía "panel de afiliado." a secas (antes "de
  Clubify", ya neutralizado en b0f55b85). Ahora es **brand-aware** por host
  (`useAuthBrand`): en Sellea dice "panel de afiliado de **Sellea**". Cae a
  "Clubify" solo cuando `brand` es null, que solo pasa en el propio host de
  Clubify → nunca fuga en marca blanca.

### Qué toqué de PRODUCCIÓN
- **Desplegado el frontend** (`desplegar.cjs frontend`, READY). Sin DB, sin vars.

### Qué falta / qué hay que validar del otro lado
- [ ] Verificar creando un afiliado en Sellea. Si aún aparece "de Clubify", es el
      **Service Worker con el bundle viejo** en el navegador (la captura del
      reporte era de un mensaje anterior al deploy): hard-refresh / limpiar caché.

### Riesgos y avisos
- Cambio de texto aislado, brand-aware con fallback correcto. Sin riesgo para
  otras marcas.

---

## 2026-08-27 — Comisión FIJA de pago único para Sellea + fugas Clubify (Jhon)
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** `feat/commissions-auto-cutoffs` — commits `e497fa55`, `f4bb2e43`,
`b64d849c`, `f14d3783`. **DESPLEGADO Y VERIFICADO EN PRODUCCIÓN** (migración →
backend → frontend, en orden).

### Qué cambié
Sellea pasa a pagar comisiones de referido como **monto FIJO en USD, UNA sola
vez** (no %, no recurrente). 100% aislado por marca — Clubify y las demás no
cambian. Montos (config, ajustables): **negocio $30 · influencer $80 · embajador
$40**. Socio (10% global) **apagado para Sellea**. Decisiones tomadas con el
founder.
- **Esquema:** `ReferralCode.fixedCommissionUsd` (nullable). Si != null → monto
  fijo, `periodKey='ONCE'` (la @@unique impide 2º pago, renovaciones incluidas).
- **Config por-marca** (Settings, patrón `regKey`): `commissionMode.sellea=
  FIXED_ONCE` + `fixed.{negocio,influencer,embajador}.sellea`.
- **TODOS los caminos de comisión** honran el modo fijo (no solo el webhook):
  `generateReferralCommission`, backfill de reasignación, cron recurrente
  (hoy desactivado, defensivo), `computeExpectedCommissionRows` (auditor/recalc),
  implementación (bloqueada), grupo (saltada), socio (saltada).
- **Fix de leak:** `/refer` (`POST /referrals/codes`) ahora es brand-aware por
  Origin/Referer — antes el código del negocio Sellea nacía bajo **Clubify**.
- **Frontend:** dashboard del negocio con color de marca (inline, sin tocar
  theming global) + texto "$30 pago único"; `/refer` muestra el monto real;
  panel admin de referidos "Clubify"→nombre de marca (i18n); panel de afiliado
  (`payouts`, `team`) sin fugas "Clubify".

### Qué toqué de PRODUCCIÓN
- **Migración** (`scripts/apply-referral-fixed-commission.cjs`): columna
  `ReferralCode.fixedCommissionUsd` + 4 Settings de Sellea (commissionMode=
  FIXED_ONCE, fixed.negocio=30/influencer=80/embajador=40). Aditiva, verificada 4/4.
- **Backend** desplegado (`desplegar.cjs backend` → clona el commit, no la
  carpeta; swap confirmado por uptime 21719→19s).
- **Frontend** desplegado (`desplegar.cjs frontend`, Vercel, READY).
- **Verificado end-to-end:** `/referrals/public-terms` con Origin Sellea →
  `{fixedOnce:true, negocio 30, influencer 80, embajador 40}`; sin Origin
  (Clubify) → `{fixedOnce:false}` (aislamiento OK); `/referrals/me`=401 (montado);
  app.selleala.com + app.soyclubify.com + /refer = 200.

### Qué falta / qué hay que validar del otro lado
- [x] Migración corrida. [x] Push. [x] Deploy backend. [x] Deploy frontend.
- [x] El deploy del backend arregló el error `transformOnRedeem` al crear
      tarjetas de descuento (prod iba por detrás del commit b69a3688).
- [ ] Prueba funcional real en Sellea: generar código de negocio (debe decir
      "$30 pago único"), y confirmar que una venta referida genera UNA comisión
      fija (no %, no recurrente). El código está verificado; falta el e2e con
      una venta real.
- [ ] Aparte (pendiente de antes): arreglar la secret key de Stripe de Sellea
      para el punto 2 (compra e2e).

### Riesgos y avisos
- El trabajo de `card_logo_bg_color` (cards/wallet) que estaba sin commitear al
  inicio del día **desapareció del working tree** durante mi sesión (sync de
  OneDrive). NO lo toqué (regla #3). Si era tuyo y lo necesitás, está en tu copia.

## 2026-08-26 — NOTA A JAVIER: mergeé tu rama a prod + desplegué todo (Jhon)
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** `feat/commissions-auto-cutoffs` — merge `a3c45b7`, HEAD `a2ed051`, **desplegado y verificado**

Javier: consolidé y desplegué. Resumen de lo que confirmo hecho:

### 1. Mergeé `chore/merge-emails-sobre-314` → `feat/commissions-auto-cutoffs`
Traje TU rama a la de prod (convenios, rework de plantillas de correo, ranking con
filtro, mapa, tooling de deploy). **Conflictos (referrals):** tu fix de fuga de
comisiones (`3086c88`) y el mío (`52d46aa`) eran el MISMO enfoque — me quedé con el
TUYO (canónico: `todasLasMarcas` + `brandCommissionWhere`) y preservé mi Fase 3
(registro afiliado brand-aware). BITACORA: unión de ambos. **41 tests verdes**
(incl. `aislamiento-comisiones.spec.ts`). Compila (tras `prisma generate`).

### 2. Migraciones aplicadas a prod (las que estaban pendientes)
- **Convenios** (`apply-convenios-migration.cjs`): 6 tablas, 3 columnas, 15 índices.
  `conveniosEnabled=false` para todos. `GET /convenios` responde 401 (montado).
- **Cuponera §24-25** (`apply-cuponera-gateways.cjs`): la corrió el founder. OJO: tu
  código de §24 ya estaba commiteado y **mis deploys lo llevaron a prod SIN la
  migración** un rato (MembershipPlan rompía). Ya aplicada → un-roto.

### 3. Desplegado (railway up backend + vercel --prod frontend), verificado
Convenios montado, aislamiento de comisiones intacto, Fase 3 (Sellea `enabled:true`),
dominios 200.

### 4. Coordinación — importante
Para desplegar HEAD limpio usé `git stash -u` varias veces, y eso **se llevó tu WIP
sin commitear** (una se perdió, según tu memoria). Ya no pasa (tu §24 está
commiteado), pero **coordinemos quién despliega el backend** para no pisarnos.

### 5. Lo mío de hoy (contexto)
Aislamiento cross-marca PROGRAMA (7 métodos+4 IDOR, mismo bug que tú viste),
`superadmin/marcas` a página completa, Fase 3 registro afiliado brand-aware por
Origin/Referer (+ activado para Sellea), panel de referidos brand-aware
(`refer/*`, i18n `{brandName}`/`{host}`), favicon Fidelity, y el barrido de fugas.

### 6. Convenios FRONTEND — PENDIENTE (tu handoff)
Falta lo que se ve: interruptor admin (`conveniosEnabled`/`maxConvenios`), 2
endpoints (listar personas activadas + bloquear), página de activación del empleado,
plantilla de billetera, informe al aliado, avisos. Lo arrancamos cuando digas.

## 2026-08-27 — Team Clubify: el chat se completa al abrirlo y las fotos ya se ven (Jhon)
**Máquina/quién:** Jhon (Mac)
**Rama / PR:** `team_clubify` · `feat/automations-engine-audit` · commit `9bd5901` · desplegado

### Qué cambié
- **El chat se completa al ABRIRLO.** El barrido cada 10 minutos era la única vía
  y no es una garantía: si en esa pasada el proveedor falla o la línea no llega a
  procesarse, el hilo se queda corto justo cuando alguien lo mira. Ahora abrir un
  chat lo completa contra el proveedor en segundo plano (una página, una vez cada
  2 minutos por hilo). Primero se pinta lo guardado: nunca espera al proveedor.
- **Las fotos.** El proveedor las entrega en `attachments` y no había dónde
  guardarlas: el mensaje entraba como el TEXTO `type message: image` y la imagen
  se perdía — en el caso que lo destapó, la lista de precios que le mandaron al
  cliente. Columna nueva + se pintan en el hilo, y al volver a pasar por un
  mensaje ya guardado se le completa la imagen que le faltaba.
- `type message: <tipo>` es enrutamiento del proveedor, no lo que leyó el
  cliente: se quita del cuerpo.
- Deduplicar dejó de ser 300 consultas por apertura: una sola por `ext_id`.

### Qué toqué de PRODUCCIÓN
- **Base de datos (Team Clubify, aditivo):** `ConversationMessage.attachments`
  (`TEXT[] NOT NULL DEFAULT '{}'`), con `scripts/add-message-attachments.cjs`
  (idempotente, `IF NOT EXISTS`). Ya aplicada.
- **Despliegue:** `vercel --prod` desde `team_clubify/`. `team.soyclubify.com`
  responde 200.

**Segundo bloque del mismo día — el barrido dejó de fallar en silencio**
(commit `d30aa6a`, desplegado). Cuando una línea fallaba, el error viajaba en la
respuesta del cron y nadie la leía nunca:
- Cada pasada deja constancia por línea (`last_import_at` / `last_import_error`)
  y **avisa por la campana solo cuando CAMBIA de estado** — se rompió o se
  arregló. Avisar en cada pasada sería una queja cada 10 minutos y en dos días
  nadie miraría la campana. Va a gerentes/admin y al dueño de la línea; tema
  nuevo «Líneas de WhatsApp», apagable como cualquier otro.
- En **Integraciones → WhatsApp** cada línea dice si está trayendo los chats y
  desde cuándo no.
- Un fallo **pasajero** del proveedor (timeout, 500) ya no se confunde con no
  tener permiso: antes `.catch(() => null)` los mezclaba y **un solo tropiezo
  dejaba el resto de la pasada en «solo el último mensaje de cada chat»**.
- Segunda migración aditiva, ya aplicada:
  `node scripts/add-connection-import-status.cjs`.

### Qué falta / qué hay que validar del otro lado
- [ ] Las fotos VIEJAS solo se recuperan cuando algo vuelve a pasar por ese
      mensaje (abrir el chat, el barrido de 3 h, o el botón «Sincronizar»). No
      hice un backfill de todo el histórico.
- [ ] Los adjuntos ENTRANTES (una foto que manda el cliente) todavía no los
      captura el webhook en el momento: entran cuando el hilo se completa.
- [ ] **Railway sigue bloqueado por tres variables VACÍAS** en el servicio `web`:
      `BLOB_PUBLIC_READ_WRITE_TOKEN`, `GROW_BUSINESS_API_KEY`,
      `GROW_BUSINESS_ACCOUNT_ID`. Existen en la lista (32 variables) pero sin
      valor: «existe» y «tiene valor» son cosas distintas y la pantalla no las
      distingue. Hay que pegarlas en la UI de Railway y después correr
      `node scripts/preflight-railway.cjs`.

### Riesgos y avisos
- Producción de Team Clubify sigue en **Vercel** (`vercel --prod` desde
  `team_clubify/`, siempre con `git fetch` antes). El corte a Railway sigue en
  espera por lo de arriba.
- Verificaciones repetibles que dejé, las dos contra la base real:
  `npx tsx scripts/verify-thread-refresh.ts <leadId>` (dos pasadas; falla si la
  segunda trae algo = cada apertura duplicaría el hilo. Probado en uno de 9 y en
  uno de 480 mensajes) y `npx tsx scripts/verify-inbox-sync-alert.ts` (avisa al
  romperse, calla mientras sigue roto, avisa al arreglarse; restaura la línea y
  borra las notificaciones que crea).

## 2026-08-28 — Fugas de marca en las pantallas de bloqueo (punto 6 SELLEALA) — DESPLEGADO

**Máquina/quién:** máquina de Jhon (Claude)
**Commits:** `36a949c6`

### Qué cambié

Dos **pantallas de bloqueo** decían "Hotmart" a secas — un cliente de Sellea,
que cobra por Stripe, leía el nombre de una pasarela que no usa y el de la
plataforma que la marca no quiere mostrar:

- `CardVerificationLockscreen`: "completa el pago seguro en Hotmart", "Ir al pago
  seguro en Hotmart", "Ya completé Hotmart", "Apenas Hotmart confirme".
- `TrialExpiredLockscreen`: "Pago seguro vía Hotmart".
- `HelpPanel` (FAQ): "vía Hotmart" **y los precios de Clubify** (USD 50 / USD 99),
  que para una marca blanca son falsos porque fija los suyos.

`/tenants/me` **ya calculaba `brandGateway` pero no lo devolvía**. Ahora sí, y
AppShell lo baja a los dos lockscreens. Helper nuevo: `frontend/src/lib/pasarela.ts`.

**El fallback es genérico a propósito:** sin pasarela conocida se dice "la
pasarela de pagos". Poner "Hotmart" por defecto es el bug que esto arregla, así
que CROSS y MANUAL también caen al genérico.

**Los tres textos exactos del PDF ya estaban corregidos** por el barrido
anterior; lo que quedaba eran estos, que el grep original no listó.

### Qué NO se tocó, a propósito

Los "Clubify" de la web pública (landing, `/industrias`) y del flujo de prueba
gratuita: esa web es de Clubify y **los trials son siempre de la plataforma**
(`whiteLabelId` nulo), así que ahí el nombre es correcto.

### Qué toqué de PRODUCCIÓN

- Backend desplegado (swap verificado: uptime 37889 s → 14 s).
- Frontend desplegado (`promote` → 409 = ya era producción).
- Base de datos: **sin cambios**.

### Verificado después

Bundle del dominio real: 0 chunks con los textos viejos de Hotmart, y el
genérico presente. Las tres rutas públicas de auth responden bien
(`trial-otp` 400 validación, `trial-signup` 400 pidiendo el PIN, `signup` 400).

### Aviso

⚠️ **El frontend NO tiene infraestructura de tests**: sin script `test`, sin
vitest en `package.json`, sin un solo archivo. Escribí uno para el helper, vi que
nadie lo correría y lo borré — un test huérfano da confianza falsa. Montarla es
una decisión aparte.

---

## 2026-08-27 — OTP de la prueba gratuita ACTIVO + incidente de 401 (PRODUCCIÓN)

**Máquina/quién:** máquina de Jhon (Claude)

### 🚨 Incidente: el registro público estuvo devolviendo 401

Al agregar `POST /auth/trial-otp` lo puse **entre el comentario de
`trial-signup` y su `@Post`**. En NestJS los decoradores se pegan al primer
método que aparece debajo y un comentario en medio no separa nada, así que el
método nuevo **se llevó los decoradores de `trial-signup`**, incluido
`@Public()`. El registro público devolvió **401** durante unos minutos, entre el
despliegue del OTP y el arreglo (`01a14a05`).

**No lo atrapó nada de lo habitual:** `tsc` compila, la app arranca y las rutas
se mapean igual. Lo único que cambia es QUIÉN puede entrar.

→ Se agregó `backend/test/auth-rutas-publicas.test.ts`, que lee los metadatos y
verifica que las 6 rutas públicas de auth lo sean. Probado al revés: quitando
`@Public()` de trial-signup el test falla. **`logout` es público a propósito** —
uno tiene que poder cerrar sesión con el token vencido.

### Qué toqué de PRODUCCIÓN

- **Base:** tabla `TrialEmailOtp` (`apply-trial-otp.cjs`) + fila
  `Setting['trial.otp.required'] = 'true'`.
- **Backend:** desplegado dos veces (el OTP y el arreglo del 401).
- **Frontend:** desplegado (`vercel --prod`; el `promote` dio 409 = ya era
  producción).

### El OTP ya está ACTIVO. Verificado sin crear ninguna cuenta:

| Prueba | Resultado |
|---|---|
| Pedir PIN a un correo | `{"enviado":true}` — Grow Business lo aceptó |
| Registro SIN código | 400 "El código son 6 dígitos" |
| Registro con código inventado | 400 "Ese código venció o ya se usó" |
| ¿Se creó alguna cuenta? | **0** — el chequeo corre antes de tocar la base |

### Aviso importante sobre el interruptor

`Setting['trial.otp.required']` controla **solo el backend**. El formulario
deshabilita el botón hasta tener 6 dígitos **pase lo que pase**, así que
desplegar el frontend ya activa el PIN para el usuario aunque el flag esté
apagado. **Apagar el flag NO alcanza para revertir**: hay que revertir también
el frontend.

### Contexto que quizá cambie la prioridad

El pedido nació de "se están creando trials con correos falsos". Revisé:
los `sectest.*` del PDF son **0** en producción, los 11 trials de mayo-junio son
negocios reales, y el único reciente con pinta de falso es `secaudit1@test.com`
de ayer — **una cuenta de auditoría nuestra**. La puerta estaba abierta, pero el
abuso no aparece en los datos.

---

## 2026-08-27 — Living Card cargada: 7 categorías + 3 planes (PRODUCCIÓN)

**Máquina/quién:** máquina de Jhon (Claude)

### Qué toqué de PRODUCCIÓN

- **Base de datos (contenido, no esquema):** creadas 7 categorías
  (Restaurantes, Cafés, Belleza y bienestar, Gimnasios y deporte, Salud, Moda y
  tiendas, Ocio y entretenimiento) y 3 planes en la cuponera `living-card`.
- Se hizo por los métodos del panel (misma validación que la UI), no por SQL.

### Decisión importante: los planes PAGOS quedaron INACTIVOS

| Plan | Precio | Estado |
|---|---|---|
| Living Card Gratis | $0 | **ACTIVO** — visible y funcionando |
| Living Card Mensual | $50.000 | inactivo |
| Living Card Anual | $500.000 | inactivo |

**Por qué:** MercadoPago NO está configurado y ningún plan está mapeado a
Hotmart/Stripe, así que **nadie puede pagar**. Publicar "$50.000" en una página
pública donde el botón Pagar devuelve *"MercadoPago no está configurado
todavía"* es peor que no mostrarlo. Se activan con un clic (Configuración →
Planes) en cuanto haya pasarela.

⚠️ **Los precios son los del spec §23, no confirmados con el negocio.** Revisar
antes de activarlos.

### Verificado en producción (no solo en local)

Registro gratuito real por HTTP público, de punta a punta:
`POST /cuponera/public/join-free` → emitió el pase →
`GET /cuponera/public/card/find?q=<email>` lo encontró →
`GET /passes/<id>/google` devolvió 200. **El cliente de prueba se borró.**

### Qué falta

- [ ] **Aliados: siguen en 0.** La cartelera dice "Todavía no hay beneficios
      publicados" (degrada bien, no está rota). Cargarlos desde
      `soyclubify.com/cuponera/admin` → Aliados.
- [ ] Confirmar los precios y activar los planes pagos.
- [ ] Configurar una pasarela: MercadoPago (Configuración) o mapear los planes a
      Hotmart/Stripe (`/superadmin/living-card` → «Pagos»).

### Aviso

- `requireBenefitApproval` está en **false**: lo que carga un aliado se publica
  **solo**, sin pasar por la bandeja de revisión. Si se quiere revisar antes,
  encenderlo en Configuración.

---

## 2026-08-27 — DESPLEGADO: backend + frontend (panel de la cuponera y pasarelas)

**Máquina/quién:** máquina de Jhon (Claude)
**Rama:** `feat/commissions-auto-cutoffs` — **EN PRODUCCIÓN**

### Qué toqué de PRODUCCIÓN

- ✅ **Backend desplegado** (`railway up --service backend` **desde la RAÍZ** —
  `rootDirectory` confirmado en `/backend`). Swap verificado: uptime 7715 s → 20 s.
- ✅ **Frontend desplegado** (`vercel --prod`). El `promote` devolvió **409 "is
  already the current production deployment"**, que es la CONFIRMACIÓN de que
  swappeó solo. Verificado buscando cadenas de la UI nueva dentro de los chunks
  que sirve `soyclubify.com` — el HTML no sirve porque la página se renderiza en
  cliente.
- ❌ Base de datos: **sin cambios**. El panel no necesitó migraciones.

### Lo que había en producción ANTES (y no sabíamos)

- **El código de pasarelas §24-25 YA estaba desplegado.** Lo arrastró el deploy
  de la otra sesión del 26-ago 22:11. Por suerte en el orden correcto: la
  migración se había aplicado a las ~17:00.
- **La cuponera ya no está en `DRAFT`: está `ACTIVE`.** Alguien la publicó. La
  cartelera pública está viva.

### Qué falta / qué hay que validar del otro lado

- [ ] ⚠️ **La cuponera está ACTIVE pero VACÍA: 0 aliados, 0 beneficios, 0 planes.**
      Quien entre a `soyclubify.com/livingcard/cartelera` ve una página en blanco.
      Ahora se puede cargar todo desde `soyclubify.com/cuponera/admin`.
- [ ] Cargar el mapeo de planes a Hotmart/Stripe en `/superadmin/living-card` →
      «Pagos — Hotmart y Stripe».
- [ ] Una compra real. Las pasarelas están vivas (los webhooks responden y
      rechazan credenciales inválidas) pero **nunca pasó dinero por ahí**.

### Riesgos y avisos

- 🔍 **Cómo verificar un deploy de backend:** comparar la ruta sospechosa contra
  una **inventada**. Un 404 solo significa "no desplegada" si la inventada
  también da 404. Y `/webhooks/hotmart` da 404 en GET porque es POST-only: hay
  que probarlo con POST (devuelve 200 `invalid_hottok`).
- 🔍 **`vercel inspect` mostró "Aliases" VACÍO** en un deployment que sí era
  producción. No sirve como prueba; el 409 del `promote` sí.

---

## 2026-08-27 — Panel de la cuponera: de 4 endpoints de lectura a 32

**Máquina/quién:** máquina de Jhon (Claude)
**Rama / PR:** `feat/commissions-auto-cutoffs` — **NO desplegado**
**Commits:** `21d333e3`, `d1d1ca88`, `8966bcdf`

### Qué cambié

El panel de la cuponera (`/cuponera/admin`, rol `CUPONERA_ADMIN`) era **solo
lectura**: 4 endpoints, todos GET. Quien administra una cuponera no podía dar de
alta ni un aliado ni un beneficiario — que es literalmente su trabajo (§28:
"conseguir aliados, administrar miembros y crear una comunidad de beneficios").

Ahora son **32 endpoints**:

- **Aliados:** alta (con su primer beneficio en el mismo formulario, porque un
  aliado sin beneficio no aparece en la cartelera), edición, y
  aprobar/rechazar/suspender. El aliado **nace PENDING** y el aviso lo dice: si
  no, parece publicado y no lo está.
- **Beneficiarios:** alta manual con emisión de tarjeta.
- **Beneficios:** la bandeja de aprobación, que **no existía**. Si la cuponera
  exige revisión, lo que carga el aliado quedaba PENDING y no había pantalla
  para aprobarlo → no se publicaba nunca.
- **Configuración:** categorías y planes (sin ellos el desplegable del alta de
  aliado queda vacío y no hay plan que asignarle a un socio), más tres ajustes:
  bienvenida, revisar-antes-de-publicar y tope semanal de avisos por aliado
  (acotado 0-20 en el servidor).
- **Comunidad:** avisos a la tarjeta Wallet, geopush (radio 300 m) y sellos.

**El aviso muestra el alcance ANTES de enviar, contando TARJETAS INSTALADAS y no
miembros.** En local hay 2 socios activos y 0 tarjetas puestas: el aviso habría
salido a nadie sin que nada lo indicara.

### Qué toqué de PRODUCCIÓN

- **Nada.** Ni base, ni variables, ni despliegue. Sin migraciones: todo esto usa
  columnas que ya existen.

### Qué falta / qué hay que validar del otro lado

- [ ] Desplegar. Sigue pendiente el backend con las pasarelas (§24-25), cuya
      migración **ya se aplicó** el 26-ago.
- [ ] Probar el ciclo con datos reales. La cuponera de prod está en `DRAFT` con
      0 aliados: nada de esto se ejerció de verdad.

### Riesgos y avisos

- ⚠️ **Publicar/pausar la cuponera y diseñar la tarjeta Wallet NO están en el
  panel a propósito.** Son decisiones de Fidelity (§1-2); ponerlas ahí dejaría
  que una cuponera se auto-publique. Si alguien las "agrega por comodidad",
  rompe el modelo.
- 🔑 **Cómo se hizo sin abrir un agujero:** los métodos del Master Admin tenían
  clavado `ensureLivingCampaign()`. Se les agregó un `campaignId` opcional con
  el MISMO default (nada de lo que ya funcionaba cambia), y cada escritura del
  panel resuelve por `resolveAdminCampaign` y baja el id **RESUELTO** — nunca el
  del cliente ni uno metido en el body. **Ese invariante es frágil: un método
  nuevo que pase el `campaignId` del cliente compilaría igual.** Hay 11 tests
  que lo vigilan en `test/cuponera-admin-role.test.ts`; si agregás una escritura
  al panel, sumala ahí.

---

## 2026-08-26 — Cuponera: Hotmart y Stripe (spec §24-25) + candado de membresía

**Máquina/quién:** máquina de Jhon (Claude)
**Rama / PR:** `feat/commissions-auto-cutoffs` — **NO desplegado**

### Qué cambié

- **Candado de membresía (§24).** Los canjes comparaban `status !== 'ACTIVE'`
  cada uno por su cuenta y **nadie miraba `expiresAt`**. Como el cobro que deja
  de llegar no genera ningún webhook, una membresía se quedaba ACTIVE para
  siempre y la tarjeta seguía canjeando gratis. Ahora hay una puerta única
  (`assertMembershipUsable`) que mira estado **y** fecha, corrige la fila a
  EXPIRED al detectarlo, y tiene 3 días de margen (las pasarelas reintentan una
  tarjeta rechazada durante días; cortar el mismo día deja plantado en la caja a
  alguien que sí renueva). `redeemStampReward` **no tenía ningún control**: un
  miembro dado de baja podía seguir cobrando premios de sellos.
- **`MembershipBillingService`** — alta/renovación/baja/pago fallido, agnóstico
  de pasarela. Lo usan las tres.
- **Hotmart y Stripe** enganchados en sus webhooks existentes (misma técnica que
  los packs de créditos): si el producto está mapeado a un plan, se corta antes
  de `findTenant`. Sin ese corte, quien compra una cuponera caía en
  `storePendingPayment` y **recibía un correo invitándolo a crear un negocio**.
- **MercadoPago completado (§25).** Solo entendía `preapproval` + `authorized`:
  una cancelación no cortaba nada y las renovaciones no corrían la fecha, así que
  el socio pagaba todos los meses y se le vencía igual.
- `enrollMember` ahora respeta la **cuponera del plan comprado** (antes siempre
  daba de alta en Living Card) e identifica por **email** si no hay teléfono
  (Hotmart y Stripe no lo exigen).
- Admin: sección «Pagos — Hotmart y Stripe» en `/superadmin/living-card` para
  mapear cada plan y ver qué URL pegar en cada proveedor. Endpoint
  `GET /cuponera/admin/gateways`.
- Público: `/cuponera/unirse` manda al link de la pasarela del plan; «Mi tarjeta»
  ahora busca **por teléfono o correo** (quien compra por Hotmart/Stripe termina
  en la página de gracias de la pasarela y puede no haber dejado teléfono nunca).

- **Membresía gratuita (§23).** No funcionaba: un plan de precio 0 igual pasaba
  por `createSubscription`, que exige credenciales de MercadoPago y le pide a MP
  un cobro de cero. Ahora hay `POST /cuponera/public/join-free` con dos guardas
  (el plan tiene que costar 0 — si no, mandar el id de un plan pago era entrar
  gratis; y la cuponera tiene que estar ACTIVE, una en DRAFT no capta miembros).
  Un plan gratuito **no vence**: dejar correr el intervalo apagaba al mes a
  alguien que se unió gratis y para siempre. El valor `FREE` de `MembershipSource`
  va en la **misma** migración pendiente, no en una segunda.

- **Fotos y horarios del aliado.** Las columnas `photos`/`hours` existían y el
  PATCH ya las guardaba, pero **sin validar nada**: el aliado es un negocio
  externo con login propio y eso se pinta en la cartelera pública, así que se
  escribía lo que llegara (miles de entradas, o un `javascript:` que después
  sale en un `src`). Ahora el servidor acota: fotos solo http(s)/rutas
  propias/`data:image`, máximo 8; horarios solo las siete claves de día, texto
  ≤40. Se agregó el editor en el panel del aliado y **los horarios en la ficha
  pública, donde no se pintaban** (el aliado los cargaba para nadie).

### Qué toqué de PRODUCCIÓN

- ✅ **BASE DE DATOS (26-ago ~17:00):** aplicada
  `backend/scripts/apply-cuponera-gateways.cjs` sobre el servicio
  **`Postgres-Nq8w`** (ojo: NO el que se llama `Postgres`; el backend apunta a
  `tramway.proxy.rlwy.net`, que es el público de Nq8w).
  Verificado a mano después: 7/7 columnas nuevas, 3/3 índices,
  `MembershipSource = MANUAL,MERCADOPAGO,HOTMART,STRIPE,FREE`, 103 tenants
  intactos, API respondiendo en ~0,5 s sin reinicio.
  Aditiva e idempotente: volver a correrla no hace nada.
- ❌ **Código NO desplegado.** La base va por delante del código, que es el
  orden seguro: las columnas nuevas están y nadie las lee todavía.
- Variables: sin tocar.

### Qué falta / qué hay que validar del otro lado

- [x] ~~Aplicar la migración a producción~~ — hecho el 26-ago. **Desplegar ya es
      seguro**: la base tiene las columnas y el código de prod todavía no las usa.
- [ ] Cargar el mapeo de cada plan (id de producto Hotmart / price id de Stripe)
      desde `/superadmin/living-card` → «Pagos — Hotmart y Stripe».
- [ ] Probar una compra real. Nada de esto se ejerció con dinero de verdad.
- [ ] Decidir si la cancelación corta el acceso en el acto (hoy sí, igual que un
      tenant) o respeta el período ya pagado. Es un cambio de una línea.

### Riesgos y avisos

- ✅ Ya NO aplica el aviso de "el código tiene columnas que prod no tiene": la
  migración se aplicó. Desplegar esta rama es seguro.
- ⚠️ **`railway up` sube el DIRECTORIO DE TRABAJO, no el commit.** Si alguien
  despliega con esta rama en disco, sube estos cambios aunque no los quiera.
- ⚠️ Hotmart/Stripe entran por la ruta **de la marca** (`/webhooks/hotmart/<slug>`),
  no por una nueva: el cobro lo recibe la cuenta de la marca dueña de la cuponera.
- 🔁 **Un `git stash` desde otra sesión se llevó trabajo en curso de esta**
  (etiquetado «WIP Javi cuponera gateways», pero era de acá). Se recuperó. Al
  destrabar el stash apareció una copia **vieja** de `living-card/page.tsx` cuyo
  `PushSection` no tenía la segmentación por aliado/plan que ya está en HEAD: se
  descartó y se conservó HEAD. Si alguien vuelve a stashear para desplegar,
  avisar.

---

## 2026-08-26 — Registro afiliado/influencer brand-aware (Fase 3) + migración cuponera de Javi
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** `feat/commissions-auto-cutoffs` — commits `0f4f916`, `76a1787`, desplegados

### Fase 3 — registro público de afiliados brand-aware (LIVE, verificado)
- `config()` y `register()` resuelven la marca por **Origin/Referer** (el frontend
  llama a `api.soyclubify.com`, así que el Host es la API, no la marca).
- Config POR MARCA: claves `affiliate.publicRegistration.<key>.<slug>` (cada marca
  opt-in; NO hereda el toggle global de Clubify). Admin scopeado a su marca.
- `selfRegisterAffiliate` asigna la marca del host al `ReferralCode`.
- **Activado para Sellea** (`enable-sellea-affiliate-registration.cjs`): verificado
  `config` con Origin `app.selleala.com` → `enabled:true`; Clubify sigue `false`.
- El link de influencer de Sellea: logo Sellea + funciona + afiliado bajo Sellea.

### ⚠️ Migración de cuponera §24-25 de Javi — APLICADA (coordinación)
- Javi commiteó su cuponera §24-25 (`3701e71`) pero su migración estaba **sin
  aplicar**. Mis deploys de backend (que suben HEAD) **llevaron ese código a prod
  sin las columnas** → `MembershipPlan` rompía. El **founder corrió** su script
  `apply-cuponera-gateways.cjs` (APPLY=1) → columnas + enum HOTMART/STRIPE/FREE
  presentes. Cuponera un-rota. (Correr la migración de otro dev me lo bloqueó el
  clasificador — bien.)
- **Riesgo de coordinación:** los `git stash -u` que uso para desplegar HEAD limpio
  (sin la WIP sin commitear de Javi) se llevaron trabajo suyo en vuelo (su memoria:
  "una se perdió del todo"). Ahora su §24 ya está commiteado; el riesgo pasó, pero
  **coordinar quién despliega el backend** para no pisarnos.

## 2026-08-26 — Marcas a página completa + 2 fugas de logo/favicon (frontend)
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** `feat/commissions-auto-cutoffs` — commits `ee768a0`, `950c27a`, desplegados

### Qué cambié
- **superadmin/marcas → página completa** (`ee768a0`): el detalle de una marca vivía
  en un drawer lateral de 440px (apretado). Ahora es página addressable
  (`/superadmin/marcas?brand=<id>`): barra superior con Volver + acciones, cabecera,
  y secciones en grid de 2 columnas (BrandingConfig y Administradores a ancho completo).
  El componente `Drawer` → `BrandDetailFull` (misma lógica, layout de página; toast
  propio). La lista navega a la página. Subcomponentes de config sin tocar.
- **2 fugas de 'Clubify' que reportó el founder** (`950c27a`, verificadas LIVE):
  - `registro-afiliado` (link de influencer, app.selleala.com): usaba `<Logo>` de
    Clubify + texto 'a Clubify'. → `<BrandMark>` por host (`useAuthBrand`) + nombre
    dinámico + `layout.tsx` con `AuthBrandServer` (branding SSR sin parpadeo). Verificado:
    `<title>Sellea</title>`.
  - `soyfidelity.com` (master admin, NO es WhiteLabel): pestaña 'Clubify' + favicon verde
    porque `generateMetadata` solo conoce marcas WhiteLabel. → caso especial → título
    'Fidelity' + favicon SVG con 'F'. Verificado: `<title>Fidelity…</title>` + favicon azul.

### PRODUCCIÓN
- `vercel --prod` ×2, READY, dominios 200. Backend/DB/variables: nada.

### Qué falta (fugas frontend, Fase 2/3 del reporte de Javier)
- [ ] Registro público de afiliados **brand-aware de fondo**: hoy el config/register son
      GLOBALES (Setting sin whiteLabelId) y `selfRegisterAffiliate` asigna Clubify. El
      influencer de Sellea que se registre quedaría como afiliado de Clubify (aunque ya
      ve el logo correcto). Falta: config por marca + resolver host en config()/register().
- [ ] Otras superficies con `<Logo>`/texto Clubify: `affiliate/page.tsx:250` (`|| !me.brand`
      pinta Clubify), Lab (`LabFeed`), SupportWidget, títulos de registro embajador/vendedor,
      seller/register. Mismo patrón (`<BrandMark>` + AuthBrandServer).

## 2026-08-26 — FUGA CROSS-MARCA en PROGRAMA: Sellea veía comisiones de Clubify
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** `feat/commissions-auto-cutoffs` — commit `52d46aa`, **desplegado y verificado**

Reportado por el founder ("¿cómo tengo comisiones de Clubify en Sellea?") +
reporte de Javier "Aislamiento de Sellea" (para ejecutar Jhon). Un SUPER_ADMIN
de marca blanca veía datos de TODAS las marcas en el apartado PROGRAMA.

**Verificado en prod:** de 84 comisiones que Sellea veía, **0 eran suyas**; el
"$292.50 / 14 comisiones" (PENDIENTE POR APROBAR de la captura) era 100% de Clubify.

### Qué cambié (aislamiento por marca; default a Clubify, nunca "ver todo")
- `listAdminCommissions` (referrals): scope por `recipientCode.whiteLabelId`.
- `currentCutoff` / `batchDetail` / `listPayoutBatches` (cutoff): PayoutBatch es
  GLOBAL (sin whiteLabelId) → se filtran/recalculan las comisiones embebidas por
  marca (total recalculado, lotes sin comisiones de la marca ocultos, 404 en drill-in).
- `visitsSummary`: scope por `referralCode.whiteLabelId`.
- `listCommissionBusinesses` / `listUnattributedBusinesses`: scope por tenant.
- Candados IDOR en drill-ins por id: `ambassadorDetail`, `vendorDetail`,
  `payAllForPerson` (MUTACIÓN de dinero), `getTenantAssignment`.
- El feed `integration/*` (Team Clubify, x-api-key) sigue con dataset completo
  vía `crossBrand: true`.

### Qué toqué de PRODUCCIÓN
- **Backend**: `railway up`. El 1er intento compiló y pasó healthcheck pero NO
  swappeó (quedó FAILED, gotcha conocido); el 2º (`2d0cd569`) swappeó (uptime→15).
- **DB / variables: nada.** Sin migración.
- ⚠️ **WIP de Javi (cuponera §24, gateways Hotmart/Stripe en membresías) NO
  desplegada:** estaba sin commitear en el working tree y agrega columnas a
  `MembershipPlan` que la DB no tiene. La stasheé (`git stash -u`) para desplegar
  HEAD limpio y la restauré tras el upload. **Sigue sin commitear, intacta, para
  que Javier la termine/commitee.** (Hubo churn de git resuelto; su WIP quedó sin
  marcadores de conflicto.)

### Qué falta (mismo reporte de Javier + auditoría)
- [ ] **Frontend**: fugas de "Clubify" en pantallas de Sellea (el componente `Logo`
      hardcodeado; `affiliate/page.tsx:250` `|| !me.brand` pinta Clubify; Lab;
      SupportWidget; títulos de registro de embajador/vendedor). Fase 2.
- [ ] **Registro público de afiliados/influencer brand-aware** (resolver marca por
      host + config por marca + registrar bajo la marca). Fase 3.
- [ ] **FOUNDER (no código) — Stripe de Sellea:** la *secret key* guardada
      (`ed_61V15…`) NO es de Stripe (debe ser `sk_live_…`) y el webhook no está dado
      de alta → ninguna venta de Sellea notifica (por eso el cliente de Humberto no
      recibió acceso). Cambiar la key + registrar el webhook
      `https://api.soyclubify.com/api/webhooks/stripe/sellea`.
- [ ] **UX**: convertir el detalle de marca blanca (`superadmin/marcas`) de drawer
      lateral a página completa `/superadmin/marcas/[id]` (pedido del founder).

## 2026-08-26 — Rediseño del sistema de plantillas de correo (galería de Email Marketing)
**Máquina/quién:** Javier
**Rama / PR:** `chore/merge-emails-sobre-314` — sin PR todavía

### Qué cambié
- **Un solo motor de HTML.** Cada plantilla de fábrica se escribía dos veces
  (bloques + HTML maquetado a mano en el seed) y las dos versiones ya habían
  divergido. Como el editor regenera `html` desde los bloques **en cada
  guardado**, el HTML bonito desaparecía en cuanto alguien abría la copia y la
  guardaba. Ahora el seed renderiza con `renderEmailHtml()`, el mismo motor del
  editor, cargándolo con `ts-node` desde `frontend/src/lib/email-blocks.ts`.
- **8 bloques nuevos** en `email-blocks.ts`: `heading`, `buttons` (CTA doble),
  `feature`, `product`, `order` (resumen de pedido), `quote`, `rating`,
  `coupon`. Y **filas con fondo y relleno** (`row.props`), que es lo que
  permite bandas de color sin meter HTML a mano.
- **Tokens** (`EMAIL_TOKENS`) para color, tipografía y ritmo vertical. El acento
  vive en `settings.linkColor`: lo heredan botones, antetítulos, iconos y
  cupones, así que cambiarlo repinta la plantilla entera de una vez.
- **Preheader** por plantilla, **VML** en todos los botones (Outlook),
  `color-scheme` para modo oscuro, y media queries que apilan columnas, bajan el
  relleno lateral a 20 px y ensanchan el botón en móvil.
- **9 plantillas de fábrica** (antes 5): Bienvenida, Agradecimiento post-compra,
  Promoción, Novedades, Recordatorio de cita, Te extrañamos, Cumpleaños,
  Recompensa lista para canjear, Pide tu reseña. Definidas en
  `backend/scripts/lib/email-presets.cjs`.
- **Arreglado: el envío no interpolaba nada.** `MktTemplateSendService` mandaba
  `template.html` tal cual — un `{{nombre}}` en una plantilla de la galería le
  llegaba al cliente con las llaves puestas. Ahora resuelve `{{nombre}}`,
  `{{email}}`, `{{telefono}}`, `{{empresa}}` y `{{marca}}` en asunto y cuerpo.
  `{{marca}}` que no se puede resolver queda **vacío**, nunca «Clubify».
- **Arreglado: el correo salía solo en HTML.** Ahora lleva parte de texto plano
  (`htmlToText`), que GHL ya aceptaba (`opts.text` → campo `message`).
- **Arreglado: las miniaturas de la galería.** Salían todas como el sobre gris
  ✉️ porque el listado no devuelve `blocks` ni `html` (a propósito, pesan). La
  miniatura pide el detalle cuando la tarjeta entra en pantalla y lo cachea.
- **Docs:** `docs/plantillas-correo/README.md` (cómo añadir una plantilla) y
  `preview.html` generado con `node scripts/preview-email-templates.cjs`.

### Qué toqué de PRODUCCIÓN
- **Fusionada `origin/feat/commissions-auto-cutoffs`** antes de nada. Las dos
  ramas habían divergido en las dos direcciones y desplegar cualquiera habría
  borrado el trabajo de la otra. Conflicto único: esta bitácora. 253 tests en
  verde tras la fusión.
- **Backend desplegado** (Railway, `SUCCESS` 2026-08-26 20:03). Lleva lo de los
  dos: el gating server-side de Infolinks FREE de Jhon y la interpolación de
  variables + texto plano de aquí.
- **Frontend desplegado** (Vercel, producción). Verificado que las pantallas de
  Jhon siguen vivas: `/cuponera/admin` 200, `/cuponera/panel` 200,
  `/superadmin/cuponeras` 307, y una ruta inventada 404 (prueba calibrada).
- **Seed corrido.** 5 plantillas actualizadas + 4 creadas = **9 de fábrica**.
  Verificado en la base: 10–13 KB de HTML cada una (antes 2,7 KB), 6–9 tipos de
  bloque, VML y preheader en todas. Las 2 plantillas propias de marcas, intactas.
- Sin cambios de esquema propios. Ninguna migración, ningún `db push`.

### Aviso que estuvo cerca de costar caro
Se desplegó el backend a las 17:02 desde esta rama **sin la de Jhon**, que ya
tenía 11 commits suyos del día. Sus rutas grandes sobrevivieron (venían de un
merge anterior), pero su gating freemium de Infolinks (`548d5611`, 10:54) NO iba
en ese despliegue: estuvo unas 3 h fuera de producción. El despliegue de las
20:03 lo restauró. **La lección de siempre: `git fetch` y comparar ramas ANTES
de desplegar, no después.** El frontend no llegó a salir mal porque se comprobó
a tiempo — habría dejado en 404 las tres pantallas de cuponera de Jhon.

### Qué falta / qué hay que validar del otro lado
- [x] ~~Fusionar la rama de Jhon~~ · ~~backend~~ · ~~frontend~~ · ~~seed~~ — todo hecho el 26-08.
- [ ] Mandarse una prueba real a Gmail y a Outlook: el VML de los botones solo
      se puede comprobar en un Outlook de escritorio de verdad.
- [ ] Jhon: tus 11 commits ya están en `chore/merge-emails-sobre-314`. Si sigues
      en `feat/commissions-auto-cutoffs`, trae la fusión antes de desplegar o te
      llevarás por delante las plantillas nuevas.

### Riesgos y avisos
- **Orden de despliegue: primero el frontend, después el seed.** Un editor viejo
  no conoce los 8 bloques nuevos; `coerceDoc()` los descarta al abrir, así que
  si alguien abre y guarda una plantilla nueva con el frontend viejo, se le come
  los bloques que no entiende. Con el frontend desplegado antes, no pasa.
- Las plantillas ya guardadas por los negocios **no se tocan**. Al abrirlas y
  guardarlas heredan el relleno lateral nuevo de las filas (32 px) y se ven algo
  más aireadas. Es el rediseño, no un fallo.
- `MktProviderService.sendEmail` acepta ahora `text?`. Es opcional: quien no lo
  pase sigue funcionando igual.
- Queda sin tocar, visto de paso: `mkt-engine.service.ts` resuelve `{{marca}}`
  con `?? 'Clubify'` (línea ~47). Solo salta si falta la fila de WhiteLabel, que
  con la FK no debería pasar, pero es la misma clase de fuga de marca de siempre.

---
## 2026-08-26 — Automatizaciones activas por defecto + nota descartable (punto 1 SELLEALA)
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** `feat/commissions-auto-cutoffs` — commit `43f4147`, desplegado

Punto 1 del PDF SELLEALA. El "apartado de automatizaciones" es el **sistema B**:
`/admin/automatizaciones` → pestaña "Mensajes automáticos" (`AutomatizacionesPanel`),
plantillas de marca (SMS/WhatsApp + correo gemelo) que salen por la subcuenta de
Grow Business de la marca. Sellea ya tenía subcuenta + 4/5 presets `admin_*` ON +
todos los correos ON por defecto.

### Qué cambié
- **Nota descartable (2-3 líneas)** en `AutomatizacionesPanel` explicando que las
  automatizaciones vienen activas por defecto y cómo gestionarlas. Patrón
  `localStorage` (`clubify:admin:automations-note:dismissed`), como `InsightsCard`.

### Qué toqué de PRODUCCIÓN
- **DB (1 fila)**: `Setting sms.enabled.wl.<selleaId>.admin_charge_date_moved='true'`
  (script `enable-sellea-admin-charge-date-moved.cjs`, idempotente). Era el único
  preset `admin_*` que faltaba en Sellea → ahora los 5 ON. Event-driven, va al
  negocio (no al cliente final), reversible.
- **Frontend**: `vercel --prod`, READY, dominios 200. ⚠️ **Este deploy también
  shippeó ~723 líneas de la cuponera/livingcard de Javi** (commits `1bbccce`,
  `c7ae391`, `231f524`, `9d8d702`, `27c0405`: QrScanner, carnet, beneficios,
  superadmin/living-card) que estaban en la rama pero no en prod — con OK explícito
  del founder (confirmó que la cuponera estaba lista).

### Listado por canal (activas por defecto en Sellea) — entregable
- **Correo (todas ON)**: panel listo, activación comprador, recordatorios cobro
  7d/3d/mañana/hoy/vencido, confirmado/fallido, por pausar/pausada/reactivada,
  reembolso, chargeback, cancelación, mover fecha, disputa.
- **WhatsApp**: Cobros (7d/3d/mañana/hoy/vencido, no procesado 2d, por pausar/
  pausada/reactivada) + confirmado/fallido + Operativas (reserva nueva/cancelada,
  domicilio, reseña, pedidos al cliente con opt-in) + `admin_*` los 5 (disputa,
  reembolso, chargeback, cancelación, mover fecha).

### Riesgos
- Sin envío masivo: todo event-driven. Gate duro = subcuenta Grow Business (Sellea
  la tiene). Si se desconectara, no sale nada.

## 2026-08-26 — Bug "Sin definir" (periodicidad) — diagnóstico + backfill puntual
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** `feat/commissions-auto-cutoffs` — script `backfill-plan-periodicity-mensual-group.cjs`

Punto 3 del PDF SELLEALA. La columna PLAN muestra "Sin definir" ⇔
`Tenant.planPeriodicity` es NULL; la cadencia default cae a "Mensual" → de ahí
la inconsistencia reportada.

### Causa
Esos tenants nacieron antes del forward-fix (`auth/plan-from-offer.ts`
`resolvePeriodicity`: offer code → nombre → monto USD). El offer code, el nombre
del producto y el monto **nunca se persistieron** en el Tenant → no hay dato para
re-derivar. **Forward-fix YA vivo** (desplegado hoy en los deploys del barrido);
los signups nuevos derivan bien.

### Qué toqué de PRODUCCIÓN
- **DB (2 filas)**: `planPeriodicity` NULL → **MENSUAL** en `jamarea-restobar-marino`
  y `hacienda-don-antonio` (grupo empresarial mensual, confirmado por el founder).
  Script idempotente (solo escribe si está NULL). NO se tocó `subscriptionPriceUsd`
  (queda null → comisión cae a base canónica Mensual=68, correcto).
- Verificado: null total 24 → 22.

### Qué falta / decidido dejar como está
- **Dejados en "Sin definir" a propósito** (decisión del founder): `zekkei`,
  `vizage-medspa` (Sellea) — reales pero sin confirmar periodicidad; `prueba-selleala`
  y `sys-living-card` — prueba/demo. 11 TRIAL + 7 SUSPENDED también quedan null (correcto).
- El founder mencionó "cevicheria marea mistica" en el grupo mensual pero NO estaba
  entre los null → sin acción (verificar aparte si su periodicidad ya es Mensual).

### Riesgos
- Ninguno: solo se fijó Mensual donde el founder lo confirmó; base de comisión 68/mes
  es la correcta para esos negocios.

## 2026-08-26 — Barrido de fugas de marca/pasarela (6 corregidas) — batch SELLEALA
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** `feat/commissions-auto-cutoffs` — commit `b0f55b8`, **desplegado y verificado**

Continúa el hilo de fugas del 22-ago. Un agente barrió todo `frontend/src` +
`backend/src` (230 menciones de Clubify/Hotmart/Nequi) y trió fugas reales vs.
usos legítimos (superadmin, landing propia, comentarios). **6 fugas confirmadas**
(texto visible que un admin/usuario/cliente de marca blanca vería con la marca o
pasarela hardcodeada):

### Qué cambié
- `tenant-status.guard.ts:68` — el 402 de suspensión decía "volver a usar
  **Clubify**"; corre para tenants de CUALQUIER marca → neutro "tu cuenta".
- `cita/[slug]` (página pública de reservas): footer "Reservas con **Clubify**"
  → dinámico `Reservas con {platformName}`. El endpoint público
  `service-reservations.publicInfo` ahora devuelve
  `platformName = whiteLabel.name ?? 'Clubify'`.
- `app/reviews` plantilla por defecto "Revisar en **Clubify**" → "Revisar aquí".
- `AffiliateCredentialsModal` "panel de afiliado de **Clubify**" → sin marca.
- `admin/commissions` "Pagan suscripción **Hotmart**" → "Pagan su suscripción".
- `csvHotmartTx` (es/en/pt) "**Hotmart** TX" → "Pasarela TX"/"Gateway TX".

**Grupo A (fallbacks que caían a 'Clubify' ante fallo) — commit `dcf15f5`, LIVE:**
- `d/[slug]/layout`: title fallback "Negocio · Clubify" (solo si falla la carga
  del storefront de domicilios) → "Negocio".
- `wallet.service`: el nombre mostrado del pase caía a "Clubify" si el negocio no
  tiene `brandName` → ahora cae a su `Tenant.name` (el pase muestra el negocio, no
  la plataforma); se agregó `name` al select de la reserva.

**Grupo B (con criterio del founder) — commit `003e0e7`, LIVE:**
- Lockscreens 'Elite' (CardVerification/TrialExpired, dicen "pago en Hotmart"):
  se gatearon en `AppShell` a tenants de Clubify (`whiteLabelSlug` null/'clubify')
  → una marca blanca en plan "Elite" ya no ve el flujo Hotmart.
- "Clubify Lab": nav → `{marca} Lab` dinámico (`whiteLabelName`); página de
  moderación `/admin/lab` y correos al autor → neutralizados a "Lab" (sin contexto
  de marca a mano; COMMUNITY es Clubify-only hoy). El aviso interno al equipo se dejó.
- SMS al reseller "Clubify: Se acreditaron créditos" → `{platform}`, pasando
  `platform=wl.name` explícito (el envío no lleva tenantId; sin eso caía a "Clubify").

### Qué toqué de PRODUCCIÓN
- **Frontend**: `vercel --prod` ×3, READY, dominios prod 200.
- **Backend**: `railway up --service backend` desde la raíz ×3. Swaps verificados
  por reset de uptime (1550→20; 815→55; 1798→36), CORS 204 con ACAO, `platformName`
  confirmado en `/api/public/service-reservations/primor-barber-shop` = "Clubify".
- **Sin migración** (solo `select` extra en dos endpoints).
- DB: nada. Variables: nada.

### Qué falta / qué hay que validar del otro lado
- [ ] Barrido de fugas: **grupos A y B cerrados**. Quedan solo los de bajísima
      prioridad (`pagar/[slug]` test VIRTUALPRO; "Nequi" como método de pago manual).
- [ ] Del PDF SELLEALA siguen los **puntos 1-2-3** (automatizaciones default,
      confirmación de compra e2e, bug "Sin definir"+backfill) y el **OTP**.
- [ ] Puntos 1-2-3 del PDF (automatizaciones default, confirmación de compra e2e,
      bug "Sin definir"+backfill) y el OTP siguen pendientes.

### Riesgos y avisos
- El fix de `cita` necesita AMBOS deploys: sin el backend, el front cae a
  "Clubify" con gracia (sin regresión), pero la fuga persiste. Ambos ya vivos.
- Ningún tenant Sellea tiene reservas activas hoy → el fix se verificó con un
  tenant Clubify; para Sellea resuelve a "Sellea" por el mismo `whiteLabel.name`.

## 2026-08-22 — Fugas de marca, pagos que no se reconocían, y plantillas de correo
**Máquina/quién:** Javier
**Rama / PR:** `chore/merge-emails-sobre-314` — todo desplegado y verificado

### 1. FUGAS DE MARCA — lo más grave del día
Un cliente de Sellea (Vizage MedSpa) recibió la alerta de reseña con la tarjeta
verde de **Clubify** en WhatsApp. Eran **dos fugas distintas**, y una tercera
apareció al barrer:

**a) El enlace.** Tres mensajes llevaban al dominio equivocado, y dos van al
CLIENTE FINAL del negocio:

| Mensaje | A quién | Llevaba |
|---|---|---|
| Alerta de reseña | Dueño | `app.soyclubify.com` **escrito a mano** |
| Seguimiento de pedido | **Cliente final** | `APP_URL` global |
| Gestión de cita | **Cliente final** | `APP_URL` global |

Se agregó **`brandAppUrl()`** en `email/brand-email-creds.util.ts`: resuelve el
dominio del PANEL de la marca. Distinto de `brandBaseUrl`, que prefiere el de
marketing — un `/app/reviews` sobre `www.selleala.com` no lleva a ningún sitio.
WhatsApp pinta la vista previa del **dominio**, no del texto: por eso el texto
decía «Revisar en Sellea» y la tarjeta era de Clubify.

**b) El remitente.** Tres negocios de marca blanca tenían asignada la subcuenta
GLOBAL de Clubify. Corregidos SELLEA y Oasis Nutrition Bar. **Fideliso-Test se
deja a propósito**: Fideliso no tiene subcuenta propia y quitársela lo dejaría
sin ningún canal. Queda `diag-fugas-de-marca.cjs` para revisarlo al entrar una
marca nueva.

**c) Clubify como valor por defecto.** La página de reseñas decía «Powered by
Clubify» — texto FIJO en las 4 traducciones. Y el mismo patrón en 5 sitios más
(wallet, pedido, links informativos, pase), todos con el comentario *«fallback
mientras el backend propaga el deploy»*, que se quedó para siempre.

**REGLA NUEVA: si el backend no manda la marca, NO se pinta nada.** Un pie
ausente no delata a nadie; uno inventado sí. También los títulos y vistas previas
de las páginas públicas (lo que muestra WhatsApp al compartir) caían a Clubify;
ahora caen al nombre del NEGOCIO.

Verificado en vivo: `GET /api/public/r/vizage-medspa` → `Powered by Sellea`.

### 2. Pagos recurrentes que no se reconocían
**MOTILART**, tercer mes. Sus 3 pagos cayeron como «comprador sin cuenta»
porque fallaron **las dos** vías de reconocimiento a la vez:
- código de suscriptor truncado: `WKHH7U1` guardado, `WKHH7U1I` el real;
- **el correo del pagador no es el de la cuenta** (`coysuarez_30@hotmail.com`
  paga, la cuenta es `motilart.bga@gmail.com`).

Eso último va a seguir pasando: paga el contador, el socio, la empresa.

- Reparado con `reparar-codigo-hotmart.cjs` (busca por prefijo, que es el fallo).
- **Nuevo en el panel: «Asignar a negocio activo»** en Pagos sin activar. Enlaza
  los identificadores para que el próximo cobro sea RENOVACIÓN, avanza el ciclo
  por periodicidad real y limpia los 6 campos de dedup.
- `diag-pagos-huerfanos.cjs` encontró los demás casos. **Ojo**: 5 «coincidencias»
  resultaron falsas alarmas — el negocio se creó DESPUÉS del pago, así que estuvo
  bien que quedara pendiente. Solo quedan restos contables.

### 3. Grupo empresarial con la fecha desfasada
Aldehir - Grupo Mistika: Hotmart cobró el 17/08 y el próximo es 17/09; el grupo
tenía 25/08. Sus 3 cobros llegaron como webhook y **ninguno movió la fecha**.
Reparado con `reparar-cobro-grupo.cjs` (grupo + sus 3 negocios + dedup limpio).

**PENDIENTE DE FONDO:** el arreglo pone la fecha al día pero no evita que se
repita. **El cobro del 17 de septiembre es la prueba**: si la fecha salta sola al
17 de octubre, el circuito funciona; si no, el fallo del handler de grupos sigue
vivo.

### 4. Plantillas de correo (Email Marketing)
Pestaña **Plantillas** con editor visual por bloques al estilo GHL, carpetas
anidadas y envío a contactos seleccionados. 5 plantillas de fábrica en español.

**La decisión que sostiene todo:** las imágenes van a S3 y solo se guarda la URL.
El editor de carteles QR las incrusta como `data:image` y por eso `QrPoster` pesa
**258 MB de una base de 337 — el 77%, con 293 filas**. Las 5 plantillas juntas
pesan **160 kB**. El backend **rechaza con 400** cualquier guardado con
`data:image`, y el editor lo bloquea antes.

También: fuera la subpestaña Workflows duplicada.

### Qué toqué de PRODUCCIÓN
- 2 tablas nuevas (`MktEmailTemplate`, `MktEmailTemplateFolder`) + 5 plantillas
  de fábrica.
- MOTILART reparado · grupo Aldehir y sus 3 negocios al 17/09 · 2 negocios de
  Sellea despegados de la subcuenta de Clubify · 2 colores de marca inválidos
  saneados (uno tenía «Degodoy cocina» donde va un color).

### Qué falta
- [ ] **17 de septiembre: comprobar que el grupo Aldehir avanza solo.**
- [ ] Por qué los webhooks de grupo no aplican el pago (raíz del punto 3).
- [ ] Montos en pesos mostrados como dólares en Pagos sin activar (`$491258.12`).
- [ ] Cevichería y Dinorolls: códigos que no son los de su suscripción de
      Hotmart — su próximo cobro caerá como pendiente. Usar «Asignar a negocio».
- [ ] Renombrar `Card.autoStampOnOrder` (miente desde el 20-ago).

## 2026-08-21 — Aviso de compra, carpetas anidadas, reservas y las 3 pendientes
**Máquina/quién:** Javier
**Rama / PR:** `chore/merge-emails-sobre-314` — todo desplegado y verificado

### 1. Reservas: «no marca ni permite avanzar» — NO era un bug de reservas
Degodoy tenía `primaryColor = "Degodoy cocina "`. Un nombre, no un color. El
navegador ignora el `background` inválido, el botón se queda blanco y el
`text-white` encima lo vuelve **invisible**. Sí marcaba; no se veía. El botón de
avanzar, igual.

- **La puerta por donde entró:** `onboarding-sync.service.ts` hacía
  `data[k] = String(b[k])` sin validar. Es una fuente EXTERNA. Los endpoints de
  tenants y superadmin sí validaban con `@IsHexColor`. Ya valida y descarta con
  log ruidoso.
- **Defensa en el render:** `safeBrandColor()` en `lib/contrast.ts` —
  `primaryColor || '#fallback'` solo atrapa null, no basura. Y el texto usa
  `autoTextColor`, así que las marcas con `#ffffff` tampoco quedan ilegibles.
- **Datos saneados:** 2 de 99 negocios (Degodoy y Banana's Grill con `#00005`).

### 2. Fuga de marca en el historial de envíos
Un SMS de **Acqua Nails (Sellea)** aparecía en el panel de **Clubify**. Dos
mitades: los SMS del cron nacían sin `whiteLabelId` (solo pasé `tenantId`), y la
lectura reusaba `brandWhiteLabelWhere`, que a Clubify le suma las filas con marca
nula — regla válida para tablas con legacy, **no** para una tabla de ayer.

Arreglado en los dos lados: al escribir se deduce la marca del negocio; al leer,
WHERE estricto. **Un mensaje sin marca no es de nadie.** 2 filas reparadas.

### 3. Aviso al comprador que pagó y no creó su cuenta
**16 compradores pagaron y nunca crearon su cuenta**, el más antiguo hace 65
días. Tres agujeros: Stripe no mandaba nada, el correo de Hotmart moría en el log
(sin `RESEND_API_KEY`), y el WhatsApp salía por subcuenta global con el texto
«Clubify» a mano.

Ahora un solo camino para las tres vías (Hotmart, Stripe, botón Reenviar):
correo + WhatsApp/SMS por la subcuenta de SU marca, enlace al dominio de la
marca. Plantilla `email_buyer_activation`, con `{platform}` (no `{brandName}`).
`PendingStripePayment` ya tenía `recoveryNotifiedAt` — sin tocar el esquema. El
flag **solo se marca si algún canal llegó**.

**Decisión de Javier: NO se reenvió nada a los 16.** Lo pasado, pasado.
**Cross** se queda con el enlace manual: su tabla no tiene el campo de control.

### 4. Workflows: carpetas dentro de carpetas y acciones en lote
Pedido con la pantalla de TeamClubify como referencia. `BrandWorkflowFolder.parentId`
(migración aditiva, aplicada). Migas de pan, casillas, movimiento en lote.

Dos trampas cerradas: **los ciclos** (mover una carpeta dentro de una hija suya
desconectaría el subárbol de la raíz — invisible e irrecuperable desde la UI) y
**borrar carpeta con contenido** (sube al padre, en transacción; nunca se borra
un workflow por esa vía). 17 tests.

De paso: fuera el `window.prompt` y los `.catch(() => {})` que se tragaban el
error del servidor.

### 5. Las 3 pendientes que esperaban decisión
- **`{brandName}` → `{platform}`** en las 16 plantillas del ciclo (32
  apariciones). El asunto le decía al dueño de Empanadas La Parada «renovamos tu
  plan de Empanadas La Parada». Se reescribieron 8 frases que con el cambio
  quedaban torpes («pausamos Sellea» → «pausamos tu cuenta de Sellea»).
- **Comisión de afiliado en el pago manual**: un cobro por Nequi es el mismo
  hecho económico que uno por pasarela. Fire-and-forget, como `convertToPaying`.
- **`RETENTION_ENABLED=true`** en Railway. No existía, así que NADA se limpiaba.
  Primera corrida: 5.864 registros caducados.

### 6. Menor
Fuera la subpestaña Workflows de Email Marketing (duplicaba la principal).
`academia`, `automatizaciones` y `pending-payments` faltaban en
`RESERVED_ADMIN_ROUTES`: en soyfidelity.com se leían como slug de marca.

### Qué toqué de PRODUCCIÓN
- Migración aditiva `BrandWorkflowFolder.parentId` (aplicada, 0 carpetas movidas).
- `RETENTION_ENABLED=true` — **empieza a borrar datos caducados**.
- Saneo de 2 colores inválidos · 2 filas de `MessageLog` reatribuidas · ciclo y
  nota del pago manual de La Gloriosa corregidos.
- Despliegues verificados con calibración (ruta inventada → 404).

### Qué falta
- [ ] Renombrar `Card.autoStampOnOrder` → `autoStampOnDelivered` (el nombre
      miente desde ayer). SQL aditivo.
- [ ] 2 pedidos cancelados con sello vivo (script puntual).
- [ ] Degodoy y Banana's Grill quedaron con el verde por defecto: sus dueños
      deben poner su color real.
- [ ] `MktContact` sin `tenantId`: el vínculo contacto↔negocio se resuelve por
      identidad al enviar.

## 2026-08-20 (noche) — Sellos al entregar, métodos de pago, y el correo de prueba de Humberto
**Máquina/quién:** Javier
**Rama / PR:** `chore/merge-emails-sobre-314` — backend y frontend desplegados

### 1. El correo de prueba se guardaba y desaparecía
Lo reportó Humberto (dueño de Sellea). El backend devolvía `{ testEmail }` y el
panel leía `r.email`: como no existía, metía `''` en el campo **justo después de
decir «guardado»**. Y encadenaba el segundo síntoma, porque «Probar correo»
exige que el campo tenga algo.

Se unificó la forma de la respuesta con la del teléfono. Lo importante es el
blindaje: **el panel ya nunca vacía lo que el usuario escribió** por una
respuesta que no trae el valor.

**Dato del historial (para esto se construyó):** sus dos intentos anteriores
SÍ salieron y GHL los aceptó con id real. Si no le llega, es entregabilidad de
la subcuenta de Sellea en GHL — dominio remitente —, no código.

### 2. Sellos: al ENTREGAR, no al confirmar
**Corrección al diagnóstico inicial:** los pedidos afectados eran **PICKUP**, no
domicilio. El guard de domicilio (`fulfillment === 'DELIVERY' → return`) sí
funcionaba. Desde el menú público se ven iguales; el sistema los trata distinto.

Medido: **62 sellos «Auto por pedido confirmado» en 60 días**, con 2 pedidos
cancelados y 1 en READY entre ellos. Ninguna automatización daba sellos
(revisadas las 280 reglas de `AutomationRule`).

- `autoStampOnConfirm` → **`autoStampOnDelivered`**, disparada solo en DELIVERED.
- **Cancelar revierte** lo que ese pedido generó: asiento inverso con rastro en
  `Stamp`, piso 0, reapertura del cartón si ese sello lo completaba, y anulación
  de `purchaseAmount`. Idempotente y best-effort.
- **Domicilio pregunta**: al marcar entregado sale «¿Sumas el sello?» (decisión
  de Javier). Nuevo `POST /orders/:id/stamp`, misma ruta que el automático, así
  que el resultado es idéntico. Enganchado en el botón y en arrastrar y soltar.

**Ojo:** la columna se sigue llamando `Card.autoStampOnOrder` aunque ahora
signifique «al entregar». No se renombró (migración aparte). El nombre miente.

**Datos históricos NO corregidos:** los 2 pedidos ya cancelados con sello vivo
siguen así; harían falta un script puntual.

### 3. Montos: solo desde CONFIRMED
Seis sitios sumaban pedidos PENDING como ventas. El peor: el ticket promedio
dividía plata confirmada entre pedidos pendientes — mal por los dos lados. El
merge de clientes sumaba incluso CANCELLED. Constante `REVENUE_STATUSES` en
`metrics.service.ts`.

### 4. Método de pago
El cliente lo elegía y **el negocio nunca lo veía**: el wa.me del dueño
(`generateWaMeOwner`) nunca lo incluyó. Ahora sale humanizado, con el texto libre
real cuando es OTRO, y se omite si no eligió.

El negocio ya elige qué acepta: guardado en `Storefront.theme.paymentMethods`
(mismo precedente que `theme.fulfillment`, sin migración). Validado también en el
servidor. **Quien nunca lo configure sigue viendo los cuatro** — un default vacío
sería una caída de ventas silenciosa.

### Qué toqué de PRODUCCIÓN
- Despliegue de backend y frontend. Rutas comprobadas con calibración correcta
  (ruta inventada → 404, las nuevas → 401). Módulo de Jhon intacto.
- Sin migraciones nuevas.

### Qué falta
- [ ] Los 2 pedidos cancelados con sello vivo (script de datos puntual).
- [ ] Renombrar `Card.autoStampOnOrder` → `autoStampOnDelivered` (SQL aditivo).
- [ ] ¿El guard de domicilio debería desaparecer ahora que hay pregunta? Hoy
      conviven: domicilio nunca automático + pregunta al entregar.

## 2026-08-20 (tarde) — Historial de envíos, contactos = negocios, y pago manual
**Máquina/quién:** Javier
**Rama / PR:** `chore/merge-emails-sobre-314` — backend y frontend desplegados

### 1. Historial de envíos (`MessageLog`)
Antes no había forma de responder «¿se enviaron los recordatorios de cobro de
Sellea?» desde ningún panel. Solo se registraban los envíos del motor de Email
Marketing (`MktAction`) y los de workflows de marca; `GrowBusinessService`
mandaba y no guardaba nada — y por ahí salen los **26 servicios** que envían.

Se registra en `postChannelMessage`, el único punto por el que pasan SMS,
WhatsApp y correo. Cubre los 26 sin tocar ninguno. **Los fallos también se
registran** (credenciales incompletas, contacto que no se pudo crear, rechazo
del proveedor): un envío que no salió es justo lo que hay que poder ver.

Pantalla: **`/admin/mensajes`**, con historial y resumen por automatización.

**La trampa del aislamiento, por si alguien la toca:** `MessageLog` lleva
`tenantId`, así que el middleware lo acotaría solo — pero eso **esconde las filas
con `tenantId` nulo** (avisos a la marca), que se leen como «no se envió nada».
Peor que un error, porque parece un hecho. Por eso las consultas corren con
`TenantContext.runWithoutTenant()` y el scoping es explícito por `whiteLabelId`.
Si alguien «simplifica» eso, reintroduce el agujero.

**No se guarda el HTML**, solo `preview` recortado a 300 caracteres. `MktAction`
guarda el cuerpo entero, y ése es el camino que convirtió a `QrPoster` en el 77%
de la base de datos. Retención: 90 días (requiere `RETENTION_ENABLED=true`).

### 2. Contactos = los negocios de cada marca
La pestaña Email Marketing → Contactos estaba vacía. Ahora hay «Sincronizar
negocios» y un botón de envío directo por fila. La sincronización pasa por el
resolver de identidad (`marketing/identity.ts`) — es lo que protege los índices
únicos parciales de producción — es idempotente y no pisa ediciones manuales.
La baja voluntaria se respeta también en el envío manual.

Sincronizado ya: **Clubify 87** (de 88 negocios; dos comparten teléfono y el
resolver los unificó), **Sellea 6**, **Fideliso 1**.

**Limitación conocida:** `MktContact` no tiene `tenantId`, así que el vínculo
contacto↔negocio se resuelve por identidad al momento del envío. Si alguien
cambia el correo de un contacto, el historial pierde el negocio asociado. Se
arregla con un campo en una migración aditiva.

### 3. `addPlanPeriod` se saltaba meses enteros — BUG DE FECHAS DE COBRO
`setMonth` no acota el día: si el día no existe en el mes destino, JavaScript
desborda al siguiente. Medido:

```
31-ene + 1 mes    ->  3-mar     (febrero desaparecía)
31-mar + 1 mes    ->  1-may
31-ago + 6 meses  ->  3-mar-2027
```

El comentario encima de la función decía que usaba `setMonth` «para respetar
meses reales» — era exactamente lo que fallaba. Afectaba al cálculo del próximo
cobro cuando la pasarela no manda fecha, y al auto-reparador, donde el error se
acumulaba ciclo a ciclo, haciendo que los recordatorios D-7/D-1 apuntaran a una
fecha distinta de la del cobro real. **Arreglado y con tests de regresión.**

### 4. Pago manual (Nequi, efectivo, transferencia)
Muchos clientes pagan por fuera de las pasarelas. Ninguna va a confirmar nada.

- `Tenant.manualPayment` — este negocio paga por fuera.
- `ManualPayment` — un registro por cobro; el único rastro que existirá.
- Endpoints: registrar pago, marcar/desmarcar el modo, lista de revisión e
  historial por negocio.
- **El cron NO los suspende solo** (ni por mora ni por trial vencido):
  suspender a quien sí pagó en efectivo es peor que dejar unos días de más a
  quien no. Siguen recibiendo recordatorios y aparecen en la lista de revisión.
- **Consecuencia a tener presente:** pasado el período de gracia, un negocio de
  pago manual deja de recibir mensajes Y no se suspende. Si nadie mira la lista
  de revisión, nadie lo persigue.
- Todo respeta la **periodicidad**: fecha (1/3/6/12 meses reales), importe
  sugerido (68/150/278/500 con override por `Setting landing.plans.<p>.price`) y
  créditos (`cycleCreditCost` ya multiplica por los meses del ciclo).
- Se **eliminó `periodDays`** de `convert-to-paying`: el frontend mandaba
  siempre 30, así que marcar pagado a un trimestral o anual le daba 30 días.
- **NO dispara comisión de afiliado** — decisión de negocio pendiente.

### Qué toqué de PRODUCCIÓN
- Dos migraciones aditivas e idempotentes, ejecutadas:
  `apply-message-log-migration.cjs` y `apply-manual-payment-migration.cjs`.
  Nadie quedó marcado como pago manual (verificado: 0 filas).
- Sincronización de contactos en las tres marcas (94 fichas creadas en total).
- Despliegue de backend y frontend. Rutas del módulo de Jhon comprobadas: siguen
  todas en pie.

### Qué falta / qué hay que validar del otro lado
- [ ] **Las 16 plantillas de correo usan `{brandName}`, que resuelve al nombre
      del NEGOCIO, no al de la marca.** El asunto le dice al dueño de Empanadas
      La Parada «renovamos tu plan de Empanadas La Parada» cuando quien cobra es
      Sellea. El token correcto (`{platform}`) existe y no se usa ni una vez.
      Son 32 apariciones. **Pendiente de decisión de Javier.**
- [ ] Comprobar mañana que aparecen solos en `/admin/mensajes` el D-3 de Acqua
      Nails y el D-1 de Empanadas La Parada (cron de las 3:00).
- [ ] `RETENTION_ENABLED=true` en Railway, o la retención no corre.
- [ ] Conectar (o no) la comisión de afiliado al pago manual.

## 2026-08-20 — Clubify también manda correo (sin abrirle SMS a nadie)
**Máquina/quién:** Javier
**Rama / PR:** `chore/merge-emails-sobre-314` @ `df1f9dbc` — desplegada a Railway

### Qué cambié
- `BrandEmailService.resolveBrand` acepta el `tenantId` y, **solo para la
  plataforma**, cae a `platformTransport()`: subcuenta de cobros asignada al
  negocio (`billingAlertsAccountId`) → subcuenta predeterminada.
- Una **marca blanca** sin subcuenta propia sigue sin enviar, a propósito. Sacar
  su correo por una subcuenta de Clubify pondría un remitente `@soyclubify.com`
  en un correo firmado por ella: delata la plataforma y rompe el DMARC del
  dominio ajeno.
- Scripts de diagnóstico (todos de solo lectura):
  `diag-cobertura-correo.cjs`, `diag-subcuentas-remitente.cjs`,
  `diag-rafaga-si-vinculo.cjs`, `verificar-transporte-correo.cjs`.

### El problema que resuelve
74 negocios de la marca Clubify con cobro programado **no recibían ningún
correo** del ciclo de cobro: el transporte se resolvía solo por marca y la marca
`clubify` no tiene subcuenta vinculada. Sellea sí la tiene, por eso ahí sí
salían.

### Qué toqué de PRODUCCIÓN
- **Un booleano**: la subcuenta `GrowBusinessAccount` "Reseñas" quedó marcada
  como `isDefault = true` (script `marcar-subcuenta-plataforma.cjs`, con
  simulación previa). Reversible poniéndolo en `false`.
- **Ojo con el nombre**: esa subcuenta se llama "Reseñas" en el panel, pero en
  GHL **es la de Clubify** — `Clubify Oficial <Contacto@soyclubify.lat>`,
  dominio `info.soyclubify.lat`. Conviene renombrarla en el panel para que nadie
  se confunda.
- Despliegue del backend desde la raíz del repo. Las tres rutas del módulo de
  Email Marketing siguen arriba (401): `/admin/marketing/contacts`,
  `/admin/pending-payments`, `/admin/automations/test-email`.
- Envío real de prueba por la subcuenta de Clubify: **201 `Email queued
  successfully`**.

### Por qué NO se vinculó la subcuenta a la marca
Era el arreglo obvio (`WhiteLabel.growBusinessLocationId`) y es el equivocado:
`brandGrowCreds` lo consumen también reseñas, pedidos, reservas, órdenes y
automatizaciones. Vincularla abriría un canal de **SMS a clientes finales** de 74
negocios que hoy no lo tienen — mucho más de lo que se pidió, y con costo.
`isDefault` no lo lee ninguna otra ruta: solo ordena la lista del panel.

### Qué falta / qué hay que validar del otro lado
- [ ] Renombrar la subcuenta "Reseñas" → "Clubify Oficial" en el panel.
- [ ] MOTILART tiene esa subcuenta como cuenta de cobros con propósito
      `OPERATIONAL`. Puede ser intencional; conviene confirmarlo.
- [ ] **Fideliso** no tiene subcuenta: hoy no envía correo. No tiene negocios con
      cobro programado, así que no urge, pero al primero que entre habrá que
      vincularle su subcuenta.

### PENDIENTE (decidido: se hace después) — 3 negocios usan la conexión general de Clubify como si fuera suya

`MOTILART`, `NudoCowork` y `Wok Explosivo` tienen `growBusinessLocationId =
ANHzFDaLU8zKeA3nFCBk` — la integración **general de Clubify** — como sus
credenciales propias. Resultado: cuando esos negocios mandan a **sus** clientes
(solicitud de reseña, aviso de delivery), el mensaje sale con la identidad de
Clubify. La dirección queda invertida.

Por esa misma conexión pasan dos tipos de mensaje opuestos, y solo uno está mal:

| Sale de | Hacia | Canales | ¿Va la conexión general? |
|---|---|---|---|
| El negocio | Sus clientes | reseñas, delivery | **No** — es el error |
| Nosotros | El negocio | cobros, correos | **Sí** — es lo correcto |

**Está enganchada en DOS capas**, y el resolver usa `asignada > propias > marca`:

1. `Tenant.growBusinessLocationId` / `growBusinessApiKey` (creds propias)
2. `Tenant.reviewAlertsAccountId` / `deliveryAlertsAccountId` (subcuentas asignadas)

Quitar solo la capa 1 **no cambia nada** en Wok Explosivo, porque sus asignadas
apuntan a la misma subcuenta. Hay que limpiar las dos.

**Qué hacer cuando toque** (medido con
`backend/scripts/diag-impacto-quitar-creds.cjs`):

- Limpiar `growBusiness*` en los 3.
- Limpiar `reviewAlertsAccountId` y `deliveryAlertsAccountId` **solo** donde
  apunten a `ANHzFDaLU8zKeA3nFCBk`.
- **Conservar `billingAlertsAccountId`** — ése es nosotros→ellos y es correcto.
  A `NudoCowork` hay que **asignárselo** (hoy no lo tiene y perdería los avisos
  de cobro al quitarle las creds propias).

**Qué se pierde:** los 3 dejan de mandar reseñas, y Wok Explosivo también los
avisos de delivery, hasta que conecten su propio GHL. Wok Explosivo (36 pedidos)
y MOTILART están **activos**.

**No se hizo ahora por decisión de Javier** (2026-08-20): se hará cuando cada
negocio tenga su propia subcuenta.

### Riesgos y avisos
- Se midió **antes** de tocar nada: **0 negocios** disparan mensaje en la próxima
  corrida del cron (2 están en mora vieja, fuera de la ventana D+1..D+3). Abrir
  el canal no provoca ninguna ráfaga.
- La firma del correo (logo, color, «Enviado por», dominio de los links) sale
  **siempre** de la marca del negocio y no depende del transporte. Lo único que
  aporta la subcuenta es el remitente.

## 2026-08-19 — Correos automáticos por marca en el ciclo de cobro
**Máquina/quién:** equipo de Jhon (esta PC) · sesión de Claude Code
**Rama / PR:** `feat/emails-sobre-314` → **PR #317**, contra
`feat/commissions-auto-cutoffs` (#314). **Sin desplegar.**

### Qué cambié
- 17 plantillas de correo, una por cada automatización que ya manda WhatsApp,
  **con la misma condición de disparo**. Editables por marca (asunto + cuerpo),
  encendidas por defecto y apagables de a una.
- El panel de Automatizaciones pasa a **una tarjeta por automatización**:
  muestra `WhatsApp · Email` y trae el correo adentro, con su propio botón
  **"Probar correo"** y un correo de prueba guardado por marca.
- Stripe: se manejan `charge.refunded`, `charge.dispute.created` y
  `charge.dispute.closed`. Antes caían en `unhandled` — un reembolso en Stripe
  **no suspendía ni avisaba nada**.
- Hotmart: correos de disputa, reembolso, contracargo, cancelación y cobro movido.
- **El correo sale por la subcuenta de Grow Business de cada marca**, igual que
  el SMS. Se descartó Resend: no hay `RESEND_API_KEY` en Railway.
- Dos bugs corregidos: (1) el dedup por ciclo se marcaba solo si el SMS salía
  OK, así que el correo se habría repetido a diario a quien no tiene teléfono;
  (2) en la serie de mora el correo iba detrás del gate de SMS y no salía.

### Qué toqué de PRODUCCIÓN
- ✅ **Migración aditiva aplicada**: `WhiteLabel.emailConfig` (jsonb, nullable),
  con `ADD COLUMN IF NOT EXISTS`. Ninguna otra tabla tocada, ningún dato
  modificado. Script: `backend/scripts/apply-email-config-migration.cjs`.
- ❌ **No se desplegó nada** (ni backend ni frontend).
- Consultas de solo lectura para auditar el estado (scripts `diag-*.cjs`).

### Segunda ronda: revisión adversarial del camino completo

Se auditó de punta a punta y **el fallo más grave era propio**: al reconciliar
sobre #314 se habían perdido los disparadores de los tres correos más
frecuentes (pago confirmado, panel listo, cuenta reactivada). El cliente pagaba
su renovación, recibía el SMS y ningún correo. Los tests no lo vieron porque
miraban el catálogo, no los call sites.

Corregido, y con un test nuevo (`email-disparadores.spec.ts`) que **falla si una
plantilla del catálogo no tiene quien la dispare**.

Otros seis arreglos:

- Las marcas que cobran por **Stripe** perdían 4 correos que Hotmart sí mandaba
  (pago fallido, cancelación, pausada, activación).
- `resolveBrand` caía a la subcuenta de **Clubify** si fallaba la lectura de la
  marca: un error puntual de BD mandaba el correo de una marca blanca con el
  nombre, el pie y los links de Clubify. Ahora prefiere no enviar.
- "Mover próximo cobro" se enviaba sin fecha nueva, anunciando la fecha vieja o
  dejando *"Tu nueva fecha es el ."* a la vista del cliente.
- El saludo salía *"Hola hola,"* cuando el dueño no tiene nombre cargado.
- **La serie de mora no tenía dedup**: el endpoint manual
  `POST /billing/run-daily-check` repetía el aviso D+1 y D+2 al cliente en cada
  corrida. Se conectaron `paymentFailureNoticeSentAt` y
  `pausePendingNoticeSentAt`, que ya existían en el schema y nunca se
  consultaban.
- Se quitó `email_welcome`: duplicaba el de `auth.service.ts`.

### Verificación del envío por Grow Business

El payload quedó contrastado contra el spec oficial de HighLevel
(`apps/conversations.json`): `{ type: 'Email', contactId, message, subject,
html }` es el contrato correcto. Se quitó un `emailBody` que no existe en la
API. Omitir `emailFrom` es lo correcto — el remitente lo pone la subcuenta.

### Freno de mano contra `db push`

`backend/scripts/guard-db-target.cjs` aborta cualquier comando de Prisma que
mute el esquema si `DATABASE_URL` no es local. Enganchado en
`npm run prisma:migrate` y `npm run db:push`; `npm run db:target` dice a qué
base apuntas. Probado contra producción: frena con código 1.

También se corrigió un comentario del `Dockerfile` que afirmaba que el
`startCommand` corre migraciones al arrancar. **Es falso**: arranca con
`node dist/main.js` a secas.

### Un bug de la otra máquina, apuntado

El correo de bienvenida de `auth.service.ts` (vía `resolveBrandEmail` +
`EmailService`) **no está saliendo**: `EmailService` cae al adaptador de consola
porque no existe `RESEND_API_KEY` en Railway. Solo escribe en el log. Lo más
simple es enrutarlo por Grow Business como el resto.

### Qué falta / qué hay que validar del otro lado
- [ ] **Subir a GitHub el código del motor de Email Marketing** (tablas `Mkt*`).
      No está en este repo ni en ningún remoto. Sin eso, desplegar desde esta
      máquina **sobrescribe y rompe** ese módulo en producción.
- [x] ~~Confirmar el formato que espera Grow Business para `type: 'Email'`.~~
      Verificado contra el spec oficial de HighLevel: el payload es correcto.
- [ ] **Confirmar que la subcuenta de CLUBIFY tenga servicio de correo activo**
      en *Settings → Email Services*. La de Sellea sí (el correo de prueba del
      18-ago salió); la de Clubify no se pudo verificar desde acá.
- [ ] Tras desplegar, usar el botón "Probar correo" del panel para confirmar el
      envío de punta a punta.
- [ ] Decidir si se quita la pantalla *Master Admin → Marcas → Conexión de email
      (Resend)*: quedó obsoleta, configura algo que ya no se usa.
- [ ] Importar los contactos: se generó `Documentos\contactos-sellea.csv` con
      los 8 negocios de Sellea (nombre, correo, teléfono) para el botón
      **Importar** de Email Marketing → Contactos. No se insertó en `MktContact`
      a mano a propósito: replicaría mal la normalización de teléfono y se
      saltaría la sincronización con el proveedor.

### Riesgos y avisos
- ⚠️ **Nunca `prisma db push` contra producción.** Ver ESTADO-PRODUCCION.md.
  Los 5 modelos `Mkt*` ya se declararon en el schema local para que no los
  borre, pero **dos índices únicos parciales de `MktContact` siguen sin poder
  expresarse en Prisma** y un `db push` los eliminaría igual.
- ⚠️ Producción corre código desplegado con `railway up` desde un directorio
  local, no desde git. Verificar antes de desplegar.
- Cobros próximos de Sellea al momento de escribir esto: Empanadas La Parada
  (23-ago) y Acqua Nails (24-ago). El **SMS ya salió** (D-7); el D-3 dispara
  solo. El correo se suma al mismo disparo cuando se despliegue la PR #317.

## 2026-08-22 (tarde) — Máximo de extras, correo de bienvenida, canal real y creación de influencers

Cuatro cosas, todas desplegadas y verificadas contra producción.

### 1. Tope de extras por producto

Existía `ProductExtra.maxQty` (límite de UN extra) pero no un tope TOTAL. Un
producto puede ofrecer 20 ingredientes y permitir solo 5; sin tope el cliente
elegía 10 y al negocio le tocaba llamarlo a explicárselo.

- Campo nuevo `Product.maxExtrasTotal` (Int?, null = sin tope).
- Migración aditiva idempotente: `scripts/apply-max-extras-migration.cjs`.
  **Aplicada**: 2.950 productos, 0 con tope → nadie cambia de comportamiento.
- Panel del negocio: control al final del bloque de Extras, solo visible si el
  producto tiene extras. Vacío = sin tope.
- Storefront: contador `3/5`, casillas restantes deshabilitadas al llegar.
- **Backend lo hace cumplir** (`assertTopeDeExtras`, 3 sitios en
  `orders.service.ts`). El bloqueo del navegador es comodidad, no defensa: un
  POST directo al endpoint se lo salta entero.
- Textos en es/en/pt (panel) y es/en/pt/it (storefront).

### 2. El correo de bienvenida le pedía pagar a quien ya había pagado

Caso real: Mr. Pedidos (andresgdpsarespaldo@gmail.com). Pagó a las 09:54, creó
la cuenta a las 11:48, y el correo decía «Completa el pago para activarla».

`welcomeOwnerTemplate` asumía siempre pago pendiente. Ahora recibe `yaPago` y
manda dos correos distintos con el mismo esqueleto. El call site **relee el
estado del tenant** después de los tres `consumePendingForTenant` en vez de
fiarse de sus flags — así cubre también la activación que entre por webhook
entre medias.

De paso, fuga de marca en el mismo archivo: `brandName = args.brand?.name ??
'Clubify'` hacía que un negocio de marca blanca leyera «Bienvenido a Clubify».
Ahora sin marca resuelta no se escribe ningún nombre de plataforma.

### 3. El historial decía WhatsApp y salía SMS

LeadConnector **acepta** `type: 'WhatsApp'` y devuelve un `providerMessageId`
aunque la subcuenta no tenga proveedor de WhatsApp conectado: lo entrega por
SMS sin avisar. Comprobado en los dos envíos de `activacion-compra` del 22-ago
(ambos `sent`, ambos con id de proveedor, ambos llegaron como SMS).

`sendBuyerActivationLink` ya no intenta WhatsApp primero. Manda por el canal
que de verdad sale. Si una marca conecta WhatsApp de verdad, esto se reabre con
un flag por subcuenta — no adivinando.

### 4. No se podían crear influencers (403)

**No era el rol.** El guard y el chequeo del servicio pasaban bien. Lo que
fallaba era el middleware de tenant: `guardWhiteLabelCreate` bloquea toda
escritura en `User` sin `tenantId` explícito, y un afiliado **no tiene tenantId
por diseño** — no pertenece a un negocio, trae negocios. Su marca vive en el
`ReferralCode` (que sí lleva `whiteLabelId`), así que el aislamiento entre
marcas se mantiene donde importa.

Tres intentos con stefany@clubify.com fallaron y revirtieron sus códigos
(SDUAGEWQ, DEU9Z26Z, SX3KM6PV). **Comprobado: no quedó basura** — ni códigos
huérfanos ni usuario a medias.

Diagnóstico por `railway logs`, no por lectura de código: la hipótesis del rol
(`PLATFORM_OWNER` no está en los `@Roles('SUPER_ADMIN')`) era falsa para este
bug. Sigue siendo cierta como deuda: **198 endpoints** tienen `SUPER_ADMIN` sin
`PLATFORM_OWNER`, y solo 16 incluyen ambos.

### Pendiente que no es código

**Mapa de Sellea roto** (`RefererNotAllowedMapError`). Sellea y Clubify no
tienen `mapsApiKey` propia y caen a la global de Clubify, restringida por
dominio. Fideliso sí tiene la suya y por eso funciona. Se arregla en Google
Cloud (autorizar el dominio) o cargando la clave de cada marca en Master Admin
→ Marcas, donde el campo ya existe.

## 2026-08-22 (noche) — Tope de extras visible + ruta editable del enlace de afiliado

### El control del tope no se veía

Lo había condicionado a que el producto ya tuviera extras cargados, así que al
montar un producto nuevo —que es justo cuando se quiere fijar el tope— no
aparecía. Ahora está siempre.

**Alcance del tope, aclarado:** cubre extras **y adicionales**, porque son la
misma lista: un `Adicional` es la biblioteca reusable del negocio, y al
marcarlo en un producto se convierte en un `ProductExtra` de ese producto —
nunca llega al pedido por su cuenta. Las **variantes NO** entran: en el
storefront son `type="radio"`, se elige UNA. Un tope ahí no tendría sentido
salvo que se quisieran grupos de variantes multi-selección, que es otra
funcionalidad.

### Ruta editable del enlace `/ref/<ruta>`

El slug se generaba del nombre completo y salía larguísimo:
`/ref/briggit-stefany-labrador`.

**El backend ya estaba hecho**: `PATCH /referrals/codes/:id/slug` con
normalización y control de unicidad. Lo único que faltaba era el botón.

- Botón «🔗 Enlace» en las filas de **influencers y embajadores**.
- Modal: enlace actual + copiar, campo de nueva ruta con prefijo `/ref/` fijo,
  vista previa en vivo y aviso de que la ruta anterior deja de resolver.
- No es un redirector aparte: es la ruta real del afiliado, así que mantiene
  código, atribución y registro de visita.
- `listInfluencers` no devolvía `slug` (los embajadores sí). Agregado.

**Ojo, deuda conocida:** cambiar la ruta **rompe la anterior**. No hay tabla de
alias. Si el afiliado ya compartió su enlace, el viejo pasa a 404. El modal lo
avisa, pero la solución de fondo sería guardar las rutas anteriores como alias.

## 2026-08-22 (noche, 2) — Responsividad móvil, vista previa del InfoLink y tope de variantes

### La landing tenía scroll horizontal en TODOS los móviles

Medido con Chrome headless, no a ojo: la página medía **429 px de ancho fijo**
sin importar el viewport.

| viewport | antes | después |
|---|---|---|
| 360 px | 429 (+69) | **360** |
| 390 px | 429 (+39) | **390** |
| 414 px | 429 (+15) | **414** |

El culpable era el **header**, no los banners ni el carrusel: a 360 px el logo
pedía 187 px y el grupo de la derecha 217 px — 404 px de contenido en 328 px
disponibles. Arreglado midiendo pieza por pieza:

- Logo: `h-12 max-w-[240px]` → `h-9 max-w-[100px]` en móvil.
- Selector de idioma: en móvil solo la bandera (el código `ES` costaba ~22 px).
- CTA y «Ingresar»: 13 px y `px-3` en móvil.
- Contenedores: `px-6` fijo → `px-4 sm:px-6`. 24 px de margen en un móvil de
  360 es el 13 % de la pantalla y no se encogía nunca.

Herramienta: `scratchpad/medir.cjs` (puppeteer-core sobre el Chrome instalado,
sin descargar navegador). Sirve para volver a medir cualquier página.

### El InfoLink salía con el logo de Clubify

`/i/[slug]/[linkSlug]` **no generaba metadata**, así que heredaba la del layout
raíz: un negocio compartía su enlace por WhatsApp y aparecía el logo y el
título de la plataforma. La misma clase de fuga de siempre.

Nuevo `layout.tsx` con el patrón que ya usaban `/m`, `/d`, `/w` y `/o`.
Verificado en vivo: `og:title = "La Gloriosa"`, `og:image` = su logo.

**La URL no cambia** — los enlaces ya compartidos siguen funcionando igual.

Quedan sin metadata: **`/book`, `/r` y `/c`**. Mismo problema, mismo arreglo.

### Tope de variantes por producto

`maxExtrasTotal` cubría extras y adicionales. Faltaban las variantes, que eran
`type="radio"` — se elegía UNA y un tope no significaba nada.

Nuevo `Product.maxVariantsTotal`:
- Null o 1 = **exactamente como hoy**: radio, se elige una (tamaños).
- ≥ 2 = casillas múltiples con contador, hasta ese número.
- **Solo en modo DELTA.** En ABSOLUTE cada variante ES el precio final y sumar
  dos precios finales no significa nada; ahí el panel explica por qué no se
  ofrece y el backend ignora el multi.
- Deduplica: marcar dos veces la misma no la cobra dos veces.
- El servidor lo hace cumplir en los 3 sitios que arman items de pedido.

`Order.items` es `Json`, así que `variantIds` no necesitó migración de tabla.
Sí hubo que agregarlo al DTO: con `forbidNonWhitelisted` el pedido entero se
rechazaba con «property variantIds should not exist».

Migración aplicada: 2.950 productos, 0 con tope → nadie cambia.
12 pruebas nuevas en `src/orders/max-opciones.spec.ts`.

### Nota sobre el campo que «no se veía»

El service worker **no** era la causa: excluye `/app/` explícitamente y esas
páginas van siempre a red. Era caché normal del navegador.

## 2026-08-23 — El acortador, donde vive el enlace

El botón para cambiar la ruta estaba solo en `/admin/referrals` (fila del
influencer). Pero el enlace se ve en el **panel del afiliado**, y ahí es donde
se lo busca. Ahora está en los dos sitios.

**Nuevo:** `PATCH /affiliate/me/slug` — el afiliado elige la ruta de SU enlace.
`myCodes` ya filtra por `ownerUserId`, así que nadie puede reescribir la ruta
de otro. Valida:

- Mínimo 3 caracteres tras normalizar.
- **Lista de reservadas**: `clubify`, `sellea`, `fideliso`, `admin`, `app`,
  `api`, `login`, `checkout`… Sin esto un afiliado podía tomar `/ref/clubify`
  y hacer pasar su enlace por oficial de la plataforma.
- Unicidad contra el resto de códigos.

En el panel: botón «✂️ Acortar mi link» debajo del link, modal con vista previa
en vivo y el aviso de que la ruta anterior deja de resolver.

**Sigue pendiente**: no hay tabla de alias. Cambiar la ruta rompe la anterior.
Ambos modales lo avisan, pero la solución de fondo es guardar las rutas viejas.

## 2026-08-23 — Marca en páginas públicas, alias de rutas, mapa por marca y el cobro del 17

### 1. `/book`, `/r` y `/c` ya salen con la marca del negocio

Las tres heredaban la metadata del layout raíz (Clubify). Nuevo helper
`lib/public-page-metadata.ts` con la regla dura: **sin negocio resuelto NO se
pinta nada de la plataforma**. Verificado en vivo:

```
/r/fusion-sushi     → og:title "Fusion sushi"
/book/fusion-sushi  → og:title "Fusion sushi · Menú"
/c/<tarjeta>        → og:title "Konys · CUPÓN KONYS"
```

En `/c` el negocio vive en `card.tenant`, no en la raíz del payload.

### 3. Cambiar la ruta `/ref/…` ya no rompe la anterior

Nueva tabla **`ReferralSlugAlias`** (migración aditiva aplicada). Al cambiar
de ruta, la vieja queda registrada y `resolveBySlug` la sigue aceptando como
tercer paso, después de slug y código. Misma atribución, mismo código.

Lógica en un solo sitio: `referrals/slug-alias.ts`, que usan tanto el admin
como el propio afiliado. Comprueba unicidad contra rutas vivas **y contra
alias de otros** — ceder un alias haría que los enlaces de esa persona
atribuyeran ventas a alguien más.

Prueba de humo contra producción: ruta vieja resuelve al mismo código, y al
borrar el código los alias caen por cascada (0 huérfanos).

### 2. El mapa: clave por marca, negocios por marca, error que dice qué hacer

Tres problemas distintos:

- **La clave** se resolvía por HOST. Desde el panel maestro
  (`soyfidelity.com`, que no es dominio de ninguna marca) caía siempre a la
  global de Clubify, restringida por dominio → `RefererNotAllowedMapError`
  mirando cualquier marca. Ahora manda la **marca de la ruta**
  (`/admin/sellea/map` → Sellea). Helper `lib/brand-from-path.ts`.
- **Los negocios no se filtraban.** `list()` no recibía marca: el mapa de
  Sellea mostraba los de todas mezclados. Ahora `?marca=<slug>`, y un admin de
  marca queda acotado a la suya mande lo que mande.
- **El error era mudo.** `RefererNotAllowedMapError` ocurre DESPUÉS de cargar
  el SDK, así que el panel de error nunca aparecía y solo se veía el recuadro
  gris de Google. Ahora se captura por `window.gm_authFailure` y el mensaje
  dice las dos salidas concretas.

**Sigue faltando cargar la clave de Sellea y la de Clubify** en Master Admin →
Marcas (solo Fideliso tiene la suya). O autorizar el dominio del panel maestro
en Google Cloud.

### 5. El cobro del 17 ya se va a capturar

Tres fallos encadenados, todos arreglados:

- Los 3 negocios del grupo llevaban códigos **sintéticos** (`trial-…`). El
  real es **`GER6TVIT`** (paga `grupomistika2026@gmail.com`, Cevichería Marea
  Místika, desde el 17-jun). Sin él, el webhook del 17 no casaba con nadie y
  el pago caía como «comprador sin cuenta». **Aplicado.**
- El webhook **no propagaba al grupo**: movía la fecha del que paga y dejaba a
  los otros dos atrás. Nuevo `propagarCicloAlGrupo`.
- El reset de dedup limpiaba **3 de los 6** campos. Faltaban los tres
  pre-avisos, así que un negocio que renovaba no volvía a recibir el aviso de
  7 días, ni el de 3, ni el del día — fallo mudo, para siempre. Ver
  [[clubify-cobros-trampas]].

Diagnóstico reusable: `scripts/diag-grupos-cobro.cjs`.

**El 17 de septiembre hay que mirarlo igual**, ahora para confirmar que
funciona: los tres deben saltar solos al 17 de octubre.

## 2026-08-23 (noche) — «Restablezco la contraseña y no deja entrar» (Limorada)

**No era el restablecimiento.** La línea de tiempo del audit log lo cerró:

```
20:54:17 – 20:57:12   11 × auth.login.failed  ·  bermrecords@hotmail.com
20:55:39              tenant.owner.password_change  ·  (la cuenta real)
20:58:00              auth.login  ✅
20:59:18              auth.login  ✅
```

La cuenta estaba con **@gmail** y se intentaba entrar con **@hotmail**. El
cambio de contraseña funcionó siempre; fallaba el correo. Al corregirlo, entró.

### Lo que sí era un defecto

El modal de soporte pedía la contraseña **a ciegas**: solo decía a qué correo
se la puso en el *toast* posterior, que se va solo. El login no puede decir
«ese correo no existe» —revelaría qué correos hay registrados— pero el panel
de soporte sí.

- Nuevo `GET /tenants/:id/owner` (SUPER_ADMIN).
- El modal ahora muestra **arriba, antes de escribir**: el correo del dueño con
  botón de copiar, cuándo entró por última vez (o «nunca ha iniciado sesión»)
  y un aviso: *si el dueño te dice otro correo, cámbialo primero*.

### Nota de método

Me equivoqué a mitad del diagnóstico: dije que el hotmail no existía. Existía —
era la misma cuenta, cuyo correo se corrigió mientras yo consultaba. La primera
consulta y la segunda vieron estados distintos de la misma fila. Al mirar datos
que alguien está editando en vivo, la foto envejece entre consulta y consulta.

## 2026-08-24 — Comisiones por Stripe/Cross y el panel del afiliado por marca

### Sellea podía tener afiliados y no cobrar ni una comisión

Medido: Sellea cobra por **STRIPE**, y las comisiones automáticas solo las
disparaba el webhook de **Hotmart** (36 referencias en `hotmart.service.ts`,
**cero** en `stripe.service.ts` y `cross.service.ts`). El cron
`reconcileRecurringCommissions` está desactivado a propósito.

O sea: su panel dejaba crear afiliados, generar enlaces y atribuir registros —
todo se veía funcionar hasta que tocaba pagar.

**Ojo, la exclusión era deliberada** y estaba escrita en el encabezado de
`stripe.service.ts`: *«pero SIN comisiones de referido (eso es del sistema de
afiliados de Clubify, no de las marcas blancas Stripe)»*. Se cambió a pedido de
Javier; el comentario ahora dice por qué.

- Extraído `generarComisionesDeCobro()` — agnóstico de pasarela. Vive en
  `hotmart.service.ts` por historia (nació dentro de su webhook) pero no
  depende de Hotmart: la base sale del override manual del tenant o del precio
  canónico del plan, **nunca** del monto crudo con FX.
- Lo llaman las **tres** pasarelas. Best-effort: si falla, el cobro no se rompe.
- Dedup por transacción: en Stripe es la **factura** (`in_…`) o el id del
  evento — nunca el id de suscripción, que es constante entre renovaciones y
  habría hecho que solo la primera generara comisión. En Cross, `providerRef`.
- Las comisiones quedan acotadas a la marca: el afiliado lleva el
  `whiteLabelId` de quien lo creó.

**De paso, el mismo fallo de los 6 campos en las otras dos pasarelas:** Stripe
y Cross limpiaban 3 de 6 al renovar. Faltaban los pre-avisos. Ver
[[clubify-cobros-trampas]].

### El panel del afiliado era todo de Clubify

11 menciones escritas a mano, el logo, la academia y el Lab. Un afiliado de
Sellea veía la marca de otra plataforma en su propio panel.

- `GET /affiliate/me` ahora devuelve `brand` (nombre, logo, color, academia,
  dominio), resuelto desde su `ReferralCode` — que es donde vive la marca de un
  afiliado, porque no tiene `tenantId`.
- Textos, logo y enlaces de prueba salen de ahí. **Sin marca resuelta se dice
  «la plataforma»**, nunca un nombre inventado.
- **Academia**: nuevo campo `WhiteLabel.academiaUrl` (migración aplicada). El
  enlace de Clubify estaba escrito a mano y mandaba a los afiliados de otras
  marcas a su academia. Sin academia propia, la pestaña **no aparece**: mejor
  ausente que ajena. La de Clubify quedó cargada.
- **Lab**: el feed es GLOBAL, sin filtro por marca. Enseñárselo a un afiliado de
  Sellea sería mostrarle la comunidad de Clubify con el nombre de Sellea
  encima. Por ahora solo se muestra a la plataforma; se abre a las demás
  cuando el feed se acote por marca.
- Los enlaces de prueba tenían `soyclubify.com` escrito a mano; ahora usan el
  dominio de la marca.

Verificado: `Nest application successfully started`, sin errores de
dependencias por la nueva inyección.

## 2026-08-24 (tarde) — El Lab por marca y quitar sellos desde el computador

### El Lab ya no es un feed común

Era global: un afiliado de Sellea veía las propuestas de la comunidad de
Clubify, con el nombre de Sellea encima. Fuga de contenido, no solo de marca.

- Nuevo `LabProposal.whiteLabelId` (migración aditiva aplicada).
- La propuesta **nace con la marca de quien la escribe** (`marcaDe`: primero su
  `ReferralCode` —donde vive la marca de un afiliado, que no tiene `tenantId`—
  y si no, `User.whiteLabelId`).
- El feed filtra por la marca de **quien mira**, resuelta **en el controlador
  desde el usuario**, nunca desde un parámetro: si viniera por query, cualquiera
  pedía el feed de otra marca cambiándolo.
- Las históricas sin marca quedan como de la plataforma. Backfill: 3 de 6
  deducidas del autor (todas Clubify), 3 sin autor con marca.
- Con el feed acotado, la pestaña se abre a **todas** las marcas.

### Quitar sellos desde el panel

Existía solo en el escáner del teléfono, así que corregir un error de mostrador
obligaba a sacar el móvil y volver a escanear la tarjeta del cliente — que
muchas veces ya se fue.

Botón **−1** en la ficha del cliente, junto a sumar y redimir. Se deshabilita
en 0 (el backend también lo garantiza) y funciona igual para tarjetas de
sellos y de visitas. Queda anotado como «Corrección desde el panel».

El gate `walletAdvanced.removeStamps` está activo en las tres marcas
(`walletAdvanced = null` → todos los flags en true), así que no bloquea.

Detalle: una de las 6 propuestas del Lab era literalmente **«PERMITIR QUITAR
SELLOS EN LAS TARJETAS»**. Queda resuelta.

## 2026-08-24 (noche) — Sellar preguntando: ¿compra o regalo?

Antes sellar pedía el monto a secas. Para dar una cortesía había que
**inventarse una cifra**, y esa cifra entraba a la facturación del negocio
como si alguien hubiera pagado.

- Nuevo `Stamp.giftReason`: `COURTESY` | `SPECIAL_DATE`. Migración aditiva
  aplicada sobre 5.465 sellos, 0 afectados.
- Campo propio y no dentro de `note`, para que el negocio pueda **medir**
  cuántos sellos regala y por qué.
- Con `giftReason` el backend **no exige monto** ni aplica el mínimo por sello
  de la tarjeta (no hay compra que comparar), y guarda `purchaseAmount` en
  **null a propósito** — aunque el cliente mande un monto. Un regalo no puede
  contar como venta.
- Un motivo inventado se **rechaza**, no se ignora en silencio.

Interfaz en los dos sitios donde se sella:

- **Panel** (ficha del cliente): modal de tres pasos — ¿compra o regalo? →
  monto, o cortesía / fecha especial. Reemplaza el `window.prompt`.
- **Escáner** (teléfono): debajo del monto, «¿No hubo compra? Regálalo» con los
  dos botones.

10 pruebas nuevas en `src/stamps/sello-regalado.spec.ts`.

### Un bug que casi meto

Al añadir `giftReason` a `act()` en el escáner, el parámetro quedó **antes** de
`override`, así que la llamada `act(..., t.purchaseAmount, true)` del botón
«Sellar de todos modos» pasaba `true` como motivo de regalo y el forzado del
tope dejaba de funcionar. Corregido pasando `undefined` en el hueco. Los
parámetros posicionales opcionales son una trampa: al insertar uno en medio, el
compilador no siempre avisa.

## 2026-08-24 (noche) — El mapa del panel deja de depender de Google

`RefererNotAllowedMapError` en `soyfidelity.com/admin/sellea/map`. Google
restringe sus claves **por dominio**, y el panel maestro no estaba autorizado.
Arreglarlo requería entrar a la consola de Google Cloud.

**Se quitó la dependencia en vez de pedir el permiso.** El mapa ahora usa
**Leaflet + OpenStreetMap**: sin clave, sin restricción por dominio. Funciona en
`soyfidelity.com`, en `app.selleala.com` y en cualquier dominio de marca que se
conecte mañana, sin que nadie autorice nada.

- Leaflet **ya estaba en `package.json`** sin usarse: cero dependencias nuevas.
- La superficie de Google era pequeña y acotada: `Map`, `Marker` (círculo),
  `InfoWindow`, `LatLngBounds` y un listener. Todo traducido 1 a 1.
- Se conserva el tope de zoom con un solo punto (`maxZoom: 14` en `fitBounds`),
  la limpieza de marcadores y el encuadre automático.
- `map.remove()` al desmontar: Leaflet no se limpia solo y el contenedor
  quedaba marcado como inicializado.
- Se retiró todo lo que ya no aplica: resolución de clave por marca, el
  callback `gm_authFailure` y el panel que pedía configurar
  `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.

**Se pierde** el mosaico de Google (satélite, street view). Para un mapa que
solo muestra dónde están los negocios, no hace falta.

**`MapPicker` sigue en Google** — el que usa el NEGOCIO para fijar las
coordenadas de su sede. Corre en el panel del negocio, que sí está autorizado,
y ahí el buscador de direcciones de Google sí aporta.

### Verificación

Medido con Chrome headless contra `soyfidelity.com/admin/sellea/map`:

```
peticiones a Google Maps    : 0  ✅
errores RefererNotAllowed   : 0  ✅
mosaico de OpenStreetMap    : 200, 19.708 bytes
```

Los mosaicos no llegaron a pedirse en la prueba porque sin sesión la página
redirige al login. Falta que alguien con sesión lo confirme visualmente.

### Aparte: el login con Google tampoco está autorizado en ese dominio

Apareció en la misma consola:
`[GSI_LOGGER]: The given origin is not allowed for the given client ID`.

Es el mismo tipo de problema (lista de orígenes permitidos) pero con
`NEXT_PUBLIC_GOOGLE_CLIENT_ID`, y afecta al botón «Entrar con Google» en el
panel maestro. **Ese sí necesita la consola de Google Cloud.** No se tocó.

## 2026-08-24 (madrugada) — Sincronía entre cartas, y el selector de sede deja Google

### Cada producto: independiente O sincronizado

Javier aclaró el requisito: no son dos menús ciegos el uno al otro. Cada
producto de la carta duplicada puede **seguir** al original o ir por libre.
Eso resuelve la desincronización que había señalado como riesgo.

`Product.sourceProductId` + `Product.syncWithSource` (migración aditiva
aplicada, 2.958 productos, 0 afectados).

**La regla, que es lo que hay que entender:**

| Sigue al original | Es de cada carta |
|---|---|
| nombre, descripción | visible / oculto |
| precio y modo de precio | disponible en mesa / domicilio |
| foto y etiquetas | destacado |
| variantes y extras | posición y categoría |
| topes de variantes/extras | **stock** |

O sea: **qué ES** el producto se sincroniza; **cómo se muestra aquí** no. Sin
esa separación, sincronizar los precios habría devuelto a la carta los
productos que la sede B tenía escondidos — justo lo contrario de lo que se
quería.

- Al duplicar, todo nace sincronizado (`syncWithSource: true`).
- `PATCH /catalog/products/:id/sync` engancha o desengancha. Al **enganchar**
  se traen los datos del original de una vez, para que no quede a medias.
- La propagación se hace **al escribir**, no al leer: el menú público es la
  consulta más caliente del producto y resolver el original en cada lectura la
  encarecía para todos, incluidos los negocios de una sola carta.
- La FK es `SET NULL`: borrar el producto del menú principal **no** borra la
  copia de la sede, solo la deja independiente.

18 tests en `menus.spec.ts` (7 nuevos sobre qué se propaga y qué no).

### El selector de ubicación también deja Google

Javier probó entrando a un negocio **desde el panel maestro** y el selector de
sede falló igual: `RefererNotAllowedMapError` en
`soyfidelity.com/app/locations`. Mi suposición de que `MapPicker` solo corría
en dominios autorizados **era falsa** — al entrar a un negocio desde el admin,
corre en el dominio del admin.

Reescrito con **Leaflet + Nominatim** (el geocodificador de OSM). Sin clave,
sin restricción por dominio.

- Búsqueda al pulsar Enter o el botón, **no al teclear**: Nominatim pide un
  máximo de 1 consulta por segundo. Es una búsqueda que se hace un par de veces
  al dar de alta una sede, no un autocompletado.
- Clic en el mapa y **pin arrastrable**, ambos con geocodificación inversa.
- Se conserva el formulario manual de coordenadas: si el mapa no carga por lo
  que sea, el negocio nunca se queda sin camino.

De paso, Google avisaba en la misma consola que `places.Autocomplete` **ya no
admite clientes nuevos**, así que ese buscador tenía fecha de caducidad.

**Ya no queda una sola referencia a Google Maps en el frontend.**

## 2026-08-24 — «No se ven los otros en el mapa de Sellea»

**No faltaba ninguna.** Las 7 sedes de Sellea están, con coordenadas válidas
(ninguna en 0,0 ni fuera de rango). Se veían 3 puntos porque a ese zoom caían
en el mismo píxel:

| Zona | Sedes |
|---|---|
| Miami | Acqua Nails + Vizage MedSpa (1,2 km) |
| Aragua, Venezuela | Empanadas La Parada + FarCentro ×2 + SELLEA Cagua (5 km) |
| Trujillo, Venezuela | SELLEA Farmatodo |

Que el panel dijera «7 sedes» y se contaran 3 puntos sí era un defecto.
Agregada **agrupación por espacio de PANTALLA** (no por distancia real):

- Rejilla de 44 px sobre las coordenadas proyectadas al zoom actual. Se
  recalcula en cada `zoomend`, porque lo que importa son píxeles, no
  kilómetros.
- Grupo de 1 → el círculo de siempre. Grupo de varias → círculo con **el
  número**.
- Color del grupo: el del estado si todas coinciden; **gris si no**, para no
  mentir sobre el estado del conjunto.
- Clic en el grupo → se acerca hasta separarlas. Es la forma natural de «ver
  los otros» sin buscar el control de zoom.

Sin dependencias nuevas (~60 líneas), en vez de `leaflet.markercluster`.

**Aparte:** D'Ponke Cake & Eatery es de **Clubify**, no de Sellea, así que no
debe aparecer en ese mapa. Su sede (Cayey, Puerto Rico) tiene coordenadas
correctas.

## 2026-08-24 — Interfaz de cartas por sede, completa

### Panel de admin

Casilla **«Varias cartas (una por sede)»** en *Módulos del tenant*, junto a
Academia y Reservas. Dice explícitamente que **apagarlo no borra nada** — el
menú principal es el de siempre — para que se pueda probar sin miedo.

### Panel del negocio (`/app/menu`)

Solo aparece si la función está habilitada; el resto no ve nada.

- **Selector de cartas** arriba, con el conteo de productos de cada una.
  Cambiar de carta recarga categorías y productos de esa carta, y lo que se
  crea nace ahí.
- **«+ Nueva carta»** con duplicado marcado por defecto: dice cuántos
  productos copiará, que quedan sincronizados, y que **el stock no se copia**.
- **Asignar la sede** desde el propio selector, con aviso cuando no la tiene:
  *sin sede, ningún QR abre esta carta*.
- **Enlaces y QR por carta**: la carta de una sede añade `?sede=<id>` a las
  URLs de mesa y domicilio. El menú principal va **sin parámetro**, así que
  todos los QR ya impresos siguen funcionando exactamente igual.

### Interruptor de sincronía, en la ficha del producto

Solo aparece en productos que salieron de duplicar otra carta, y va **arriba
del todo** porque cambia el significado de lo demás: si está sincronizado,
editar el precio ahí lo pisa el original en el próximo cambio.

Se guarda **al instante**, no al pulsar «Guardar»: al enganchar, el backend
trae los datos del original y el formulario tiene que reflejarlos ya — si no,
guardar después volvería a pisarlos con lo que hubiera en pantalla.

El texto dice en cada estado qué se propaga y qué es de esta carta, para que
nadie tenga que acordarse de la regla.

## 2026-08-24 — QR por carta, límite de cartas y domicilio por sede

### El cartel QR solo servía al menú principal

Añadido selector de carta en `/app/marketing/qr-menu`, visible solo si el
negocio tiene más de una. El menú principal va **sin parámetro**, así que los
carteles ya impresos siguen funcionando igual.

### Límite de cartas, desde el panel de admin

`Tenant.maxExtraMenus` (default 1, migración aplicada sobre 101 negocios).

Cada carta es un catálogo entero duplicado: un negocio con 545 productos
creando cartas sin freno multiplica la base sin que nadie lo note hasta que
duele. El campo aparece bajo la casilla, solo cuando está activada.

El backend lo hace cumplir al crear, y el panel del negocio **esconde el botón**
cuando no queda cupo — mejor que no aparezca a que lo pulse y reciba un no.

### Domicilio por sede: el hueco real

Lo que **ya estaba bien** y comprobé antes de tocar:

- El ruteo del WhatsApp del pedido: sede → `ordersWhatsappPhone`, luego
  `adminPhone` de la sede, luego el número del negocio. Nunca se pierde.
- El mensaje **ya nombra la sede**: `🏢 Sede: {nombre} — {estado}`.
- `Order.locationId` existe y el storefront ya lo enviaba.

Lo que **faltaba**, y era lo importante:

1. **El menú no pedía la carta de la sede.** El cliente escaneaba el QR de la
   sede norte y veía el menú principal. Ahora `?sede=` viaja hasta
   `/public/m/:slug/menu`.
2. **El pedido ataba la sede adivinándola del departamento del cliente.** Ahora
   **manda la sede del QR**: el QR sabe dónde está el cliente, la dirección
   solo lo aproxima. El fallback por departamento se conserva para quien entra
   por el enlace general.

Verificado en producción: `?sede=` con una sede inexistente devuelve los mismos
188 productos del menú principal — un QR mal impreso no deja al cliente con una
pantalla vacía.
