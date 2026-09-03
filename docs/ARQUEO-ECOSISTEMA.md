# Arqueo del ecosistema — Clubify PRO · TeamClubify · marcas blancas

**Fecha:** 2026-08-20 · **Rama:** `chore/merge-emails-sobre-314`

Siete auditorías en paralelo sobre tres bases de código. Todo lo marcado
**VERIFICADO** lo comprobé yo contra el código o contra producción después de que
el agente lo reportara. Lo demás queda como reportado, sin confirmar.

Hay una sección de **refutados** al final. Es la parte más importante del
documento: tres afirmaciones que sonaban ciertas y no lo eran, una de ellas mía.

---

## El terreno

| Repo | Qué es | Tamaño | Base de datos |
|---|---|---|---|
| `Clubify PRO` | El producto. Sirve Clubify, Sellea y Fidelity con un solo build | 250k líneas · 149 modelos | `tramway…:39155` |
| `team-clubify` | TeamClubify, CRM de closers | 58k líneas · 123 modelos | `reseau…:18064` — **distinta** |
| `Clubify` (viejo) | Prototipo Supabase, sin git, abril 2026 | 248 archivos | Supabase abandonada |

Se comunican **solo por HTTP** (`lib/server/clubify-api.ts`), nunca por base.

---

## P0 — Cuesta dinero o deja gente fuera, hoy

### 1. Cancelar y reactivar da acceso gratis indefinido · VERIFICADO
`backend/src/billing/billing.service.ts:261-300`

`reactivate` solo exige `status === 'SUSPENDED'` y regala 3 días de `TRIAL`, sin
límite de repeticiones. `cancelSubscription` no tiene precondición. El bucle es
cancelar → reactivar → 3 días → repetir.

**No hace falta tocar la API:** son dos botones en el panel del negocio
(`frontend/src/app/app/billing/page.tsx:100` y `:117`). 79 negocios activos.

Y el daño inverso: `cancel` pone `suspendedAt = now`, y `getStatus:373` deriva
`SUSPENDED` en cuanto ese campo existe. El que cancela **pierde el mes que ya
pagó**, aunque la respuesta le promete `accessUntil: currentPeriodEnd`.

**Arreglo:** `cancelAtPeriodEnd` en vez de suspender de una; y limitar
`reactivate` a una vez, o a `SUPER_ADMIN`.

### 2. El correo de recuperación de contraseña no llega a nadie · VERIFICADO
`backend/src/auth/auth.service.ts:567`

En Railway no hay **ningún** proveedor de correo — cero coincidencias de
`RESEND`, `SMTP`, `SENDGRID`, `MAILGUN`, `POSTMARK`. El adaptador activo es
`ConsoleEmailAdapter`, que solo escribe al log. Además la llamada no lleva
`await`: es una promesa suelta. La API responde `{ok:true}` y no pasa nada.

**Mitigado a medias:** la pantalla ofrece dos vías y la de **SMS sí funciona**
(sale por GHL). Quien elige correo —la opción principal— se queda fuera.

Son **8 tipos de correo** por esa vía muerta, incluida la alerta de *base de
datos llena* (`server-status.service.ts:878`).

**Arreglo:** repetir la migración que ya se hizo en `auth.service.ts:1384`
(pasar a `BrandEmailService`), o que el adaptador de consola falle ruidosamente
en producción.

### 3. `addPlanPeriod` se salta meses enteros · VERIFICADO empíricamente
`backend/src/common/plan-period.ts:63-67`

```
31-ene + 1 mes    →  3-mar     (febrero desaparece)
31-mar + 1 mes    →  1-may
31-ago + 6 meses  →  3-mar-2027
```

`setMonth` no acota el día. El comentario encima dice que se usa «para respetar
meses reales» — es justo lo que falla. Afecta al cálculo del próximo cobro
cuando la pasarela no manda fecha, y al auto-reparador, donde el error se acumula
ciclo a ciclo.

**Arreglo:** `setDate(1)` antes de `setMonth`, y luego
`setDate(min(día, díasDelMesDestino))`.

### 4. El reloj de mora se reinicia con cada reintento de la pasarela
`backend/src/billing/billing.service.ts:1013-1015`

El día 0 es `lastPaymentAttemptAt`, que cada `invoice.payment_failed` reescribe a
`now`. Con los reintentos automáticos de Stripe (dos semanas), el cliente recibe
la secuencia D+1/D+2/D+3 tres o cuatro veces y **la suspensión nunca llega**.

**Arreglo:** persistir la fecha del *primer* fallo del ciclo.

### 5. Un reembolso rechaza la comisión equivocada
`backend/src/billing/hotmart.service.ts:2326-2337`

La rama PENDING marca `REJECTED` la comisión **más reciente**, sin filtrar por
transacción. Se reembolsa julio y se anula la comisión de agosto, que nadie
devolvió. El clawback de las PAID sí filtra por transacción; el de las pendientes
no.

---

## P1 — Marca blanca y confianza del cliente

### 6. Enlaces de Clubify en SMS que van a clientes finales · VERIFICADO
`APP_URL` en Railway vale `https://soyclubify.com`. Con eso:

| Mensaje | Va a | Enlace | Dónde |
|---|---|---|---|
| Alerta de reseña | Dueño del negocio | `app.soyclubify.com` escrito a mano | `reviews.service.ts:312` |
| Seguimiento de pedido | **Cliente final** | `soyclubify.com/o/…` | `customer-order-sms.service.ts:132` |
| Gestión de cita | **Cliente final** | `soyclubify.com/cita/…` | `service-reservations.service.ts:988` |

El SMS sale del número correcto de la marca; el enlace delata la plataforma.
Existe `brandBaseUrl()` (`email/brand-email-creds.util.ts:177`) y resuelve esto.

### 7. El checkout público dice «Prueba de integración» · VERIFICADO
`frontend/src/app/pagar/[slug]/page.tsx:172` — literal, junto al monto, mientras
el cliente teclea su tarjeta. Y si falla la red al cargar, la página afirma que
la marca no tiene plan configurado: un diagnóstico falso que hace abandonar.

### 8. Una marca nueva da 404 en su propio dominio · VERIFICADO
`frontend/src/middleware.ts:447` reescribe la raíz a `/<slug>`, que cae en
`app/[slug]/page.tsx` → `notFound()`. La landing es un archivo escrito a mano:
Sellea 490 líneas, Fideliso 465. Sin ese archivo, el dominio no sirve nada.

Además esas landings **ignoran la configuración de la marca**: color, Instagram y
correo están fijos en el código. Cambiarlos en el panel no cambia la landing.

### 9. El SMS y el correo dan días distintos · VERIFICADO empíricamente
`sms-templates.ts:187` no fija zona horaria (usa la del servidor = UTC en
Railway); `brand-email-templates.ts:366` usa `America/Bogota`.

```
1-sept 03:30 UTC  →  SMS: "1 de sept"   |   correo: "31 de agosto"
```

El mismo aviso le da al cliente dos fechas límite. *Nota: en local no se
reproduce, porque esta máquina está en `America/Bogota`.*

### 10. El registro de afiliados enseña el JSON crudo · VERIFICADO
`frontend/src/app/registro-afiliado/page.tsx:127-132` — el `throw` está dentro
del mismo `try` que lo captura, así que el mensaje útil siempre se pierde.

---

## P2 — Seguridad

### 11. Webhook de correo entrante sin firma · VERIFICADO
`backend/src/marketing/mkt-webhook.controller.ts:34-67` — `@Public()`, recibe
`rawBody` y **no lo usa**. Con el slug de una marca (público) y un correo:
dar de baja a ese contacto, o empujar su secuencia al siguiente paso.
*Módulo de Jhon.*

### 12. La clave de GHL está en claro en la base · VERIFICADO en producción
`PlatformIntegration.config.apiKey` — 40 caracteres, sin cifrar. Y
`GrowBusinessAccount.apiKey` tampoco se cifra.

Lo que lo hace un defecto y no una decisión: `WhiteLabel.growBusinessApiKey`
**sí** se cifra, y los secretos de pago también. Misma clase de secreto, tres
tratamientos distintos. Es la llave con la que salen todos los mensajes de todas
las marcas.

### 13. TeamClubify: autenticación que abre cuando falta la variable · VERIFICADO
- `lib/auth.ts:5` — `AUTH_SECRET || "dev-insecure-secret-change-me"`
- `app/api/cron/workflow-tick/route.ts:6` — `if (!secret) return true`, en los 22
  crons. Un typo en una variable de entorno deja el motor de mensajería
  invocable desde internet.

### 14. TeamClubify: una server action de comisiones sin validar sesión
`app/actions/closer-commissions.ts:29-54` — `createCloserCommission` no llama a
`requireUser()`, a diferencia de sus vecinas. Todo export de un módulo
`"use server"` es un endpoint POST.

### 15. TeamClubify: webhooks de mensajería abiertos
`middleware.ts:12` — todo `/api/webhooks` es público, sin secreto ni firma. Un
POST con `message=stop` da de baja a un lead y lo saca de sus workflows; con otro
texto finge una respuesta y dirige la rama del `wait_reply`.

---

## P3 — Datos e infraestructura

### 16. El 77% de la base de datos es una sola columna · VERIFICADO — hallazgo nuevo

Ningún agente lo vio; salió al medir producción.

```
QrPoster            293 filas   258 MB      ← 77% de la base
  └─ config.images  190 filas   217 MB
InfoLinkEvent     59.884 filas    22 MB
TOTAL de la base                337 MB
```

`QrPoster.config` es un `jsonb` con **imágenes en base64 embebidas**: 155 de 293
filas contienen `data:image`. Media de 788 KB por fila, la mayor 5,7 MB.

Se paga como almacenamiento de base de datos, entra en cada respaldo, y el S3 ya
existe (`S3_PUBLIC_URL` está configurado). **Es el arreglo con mejor relación
esfuerzo/beneficio de toda la lista.**

### 17. Dos claves foráneas calientes sin índice · VERIFICADO en producción
- `ReferralUse.tenantId` — se consulta en **cada webhook de pago** de Hotmart
  (`hotmart.service.ts:575, 1358, 2009, 2310`).
- `Stamp.customerId` — borrado y fusión de clientes hacen recorrido completo.

Dos `CREATE INDEX IF NOT EXISTS` en un script aditivo.

### 18. Sin retención en las tablas que crecen solas
`retention.service.ts:33` solo corre con `RETENTION_ENABLED=true` y cubre 4
tablas. Nadie borra nunca los `*WebhookEvent` (payload completo por webhook),
`MktAction` (congela el HTML de cada correo), `AutomationRun`, `InfoLinkEvent`.

### 19. TeamClubify no tiene freno de base de datos
`package.json` — `"db:push": "prisma db push"` a pelo, y el `README` lo instruye
como flujo normal de migración contra su producción. Clubify PRO sí tiene
`guard-db-target.cjs`.

Lo que se perdería: producción tiene un **índice único parcial** sobre
`CloserLead.phone_key`, aplicado a mano porque Prisma no sabe expresarlo
(`scripts/add-phone-key-unique.cjs:12`). Un `db push` lo borra en silencio y
reabre la duplicación de contactos que ese índice cerró.

Además `db:seed` contra producción crea usuarios con una contraseña **publicada
en el README**.

### 20. La CI no puede protegerte · VERIFICADO
`.github/workflows/ci.yml:121` — el lint del frontend termina en `|| true`.
No puede fallar. El del backend usa `--max-warnings=999`.

### 21. Seis modelos con el mismo nombre y forma incompatible
`User`, `SalesTeam`, `SalesTeamMember`, `Pipeline`, `Notification`, `Reminder`
existen en ambos schemas, sin `@@map`. Las bases son distintas —así que hoy no
choca— pero un `.env` cruzado haría que Prisma proponga eliminar ~140 tablas del
otro producto.

### 22. El prototipo muerto confunde
`Documentos/Clubify` — sin git desde abril, con su propio `CLAUDE.md` que
describe el producto **en presente**. Quien abra la carpeta equivocada recibe una
especificación convincente y obsoleta. Renombrarla cuesta un minuto.

---

## Refutados — lo que sonaba cierto y no lo era

Esta sección existe porque en este proyecto ya costó caro dar por buena una
afirmación sin volver a mirar.

### ❌ «TeamClubify apunta a la misma base de datos que Clubify PRO» — **lo dije yo**
Falso. Son instancias distintas: `tramway…:39155` contra `reseau…:18064`. El
`README` de team-clubify lo dice explícitamente y lo confirmé leyendo los dos
hosts. Se comunican solo por HTTP.

El riesgo real es otro y sigue en pie: team-clubify **no tiene guard** y su
`db:push` destruiría su propio índice único parcial (hallazgo 19).

### ❌ «El UNIQUE de dedup de comisiones podría no estar aplicado en producción»
Falso. `Commission_referralUseId_recipientCodeId_periodKey_key` **existe**. La
idempotencia del clawback por reembolso se sostiene.

### ❌ «Las tablas `Coupon` y `CouponUse` viven en producción con datos»
Falso. **No existen** en producción. El script que las creaba nunca se aplicó.

### ❌ «Faltan los índices de `Pass.legacyQrTokens`, `Tenant.whiteLabelId` y `Commission.availableAt`»
Falso. Los tres **están** en producción. Lo cierto del hallazgo es que no están
declarados en el schema — deriva de documentación, no de rendimiento.

---

## Lo que está bien, y conviene no romper

- **El aislamiento entre negocios funciona.** Guards *default-deny*, un dueño de
  negocio no alcanza rutas de superadmin, y la marca sale del token firmado, no
  de una cabecera.
- **Idempotencia de webhooks con *claim-before-run*** en las tres pasarelas: mata
  la carrera clásica comprobar→ejecutar→marcar.
- **El clawback de comisiones** usa asiento negativo en vez de reescribir el
  histórico. Tolera reenvíos.
- **El motor de workflows de TeamClubify** es lo mejor construido del ecosistema:
  claim atómico con lease, checkpoint por nodo, reintentos fuera del camino
  crítico, y comentarios que explican el *porqué* con la historia del bug.
- **`lib/api.ts`** del frontend: refresco único ante 401, redirección a cobros
  ante 402, impersonación por pestaña.
- **`/admin/tenants`** es el patrón de UI a copiar: esqueleto de carga, vacío
  distinguido de error, borrado en dos niveles.

---

## Lo que no se auditó

- Rendimiento real (no hubo perfilado ni carga).
- Wallet de Apple/Google a fondo.
- La Cuponera y Living Card.
- El frontend desplegado: `/superadmin` pide login, así que no pude verificar
  desde fuera qué build corre.
- Infraestructura: alta de dominios en Vercel, respaldos, plan de recuperación.

---

## Por dónde empezar

Ordenado por daño evitado sobre esfuerzo:

1. **Cerrar el bucle cancelar/reactivar** — es dinero que se escapa hoy.
2. **`addPlanPeriod` con clamp de fin de mes** — cinco líneas, arregla fechas de
   cobro mal calculadas.
3. **Sacar las imágenes de `QrPoster.config` a S3** — devuelve el 77% de la base.
4. **`brandBaseUrl()` en los tres SMS** — quita las fugas de marca.
5. **Zona horaria en `fmtSmsDate`** — una línea.
6. **Cambiar el texto del checkout** — una línea, y es donde se cobra.
7. **Guard de base en team-clubify** — copiar el archivo que ya existe.
8. **Índices en `ReferralUse.tenantId` y `Stamp.customerId`.**
9. **Migrar los 8 correos muertos**, empezando por el de contraseña.
10. **Cifrar las claves de GHL** como ya se cifran las de pago.
