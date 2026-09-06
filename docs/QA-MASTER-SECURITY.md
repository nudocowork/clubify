# QA MASTER SECURITY — Clubify

> **Qué es esto.** El plan de endurecimiento de Clubify y el registro de lo que
> ya se auditó, con evidencia reproducible. Está pensado para que otra sesión lo
> abra y siga trabajando sin repetir lo hecho ni romper lo que funciona.
>
> **Regla que manda sobre todas.** No se marca nada como bueno porque el código
> «parece correcto». Se demuestra contra producción, con un comando que
> cualquiera pueda repetir. Si no se puede demostrar, se marca `NO VERIFICADO`.

**Última actualización:** 2026-09-05 · **Rama:** `main`

---

## 0. Antes de tocar nada

Léete esto o vas a romper cosas que hoy funcionan:

1. **[docs/ESTADO-PRODUCCION.md](ESTADO-PRODUCCION.md)** — qué corre hoy y las
   reglas duras.
2. **[docs/BITACORA.md](BITACORA.md)** — qué hizo la otra máquina.
3. **Este producto se trabaja desde DOS máquinas** que despliegan al mismo
   producción. `git fetch` antes de afirmar que algo no existe, y antes de
   empujar.
4. **Desplegar solo con `node scripts/desplegar.cjs backend|frontend`.**
5. **Nunca `prisma db push` contra producción.** Script SQL aditivo e
   idempotente. Modelo: `backend/scripts/apply-club-migration.cjs`.
6. **Nunca `git add -A`.** Por rutas explícitas.
7. **Territorios ajenos:** comisiones, afiliados y contabilidad los lleva Jhon.
   Se pueden LEER y auditar; para cambiarlos, avisar antes. Cuando haga falta
   colgar algo de ahí, usar tabla propia sin FK — como
   `AffiliateSaleAlert`.

---

## 1. Hallazgos abiertos, por gravedad

### 🔴 P0-1 · Las copias de seguridad no se hacen desde hace dos meses

**Estado: ABIERTO. Bloqueado — necesita credenciales.**

`.github/workflows/backup.yml` corre cada noche a las 3 AM y **falla siempre**.

```bash
gh run list --workflow=backup.yml --limit 60 | awk '{print $2}' | sort | uniq -c
#   60 failure      ← 60 de 60, desde al menos el 2026-07-08
gh run view <id> --log-failed | grep "Falta env var"
#   [backup] ❌ Falta env var: DATABASE_URL
```

**Causa:** los secretos del repositorio están vacíos. Y el aviso de fallo
tampoco llegaba, porque `SENTRY_DSN` también lo está: **fallaba en silencio**.

**Faltan en `Settings → Secrets and variables → Actions`:**
`PROD_DATABASE_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
`BACKUP_ENCRYPTION_KEY`, `SENTRY_DSN`.

El código del respaldo está bien hecho (cifrado, retención 30 días). Solo le
faltan las llaves.

**Después de arreglarlo, falta lo más importante: RESTAURAR UNA COPIA.** Un
respaldo que nunca se ha restaurado no es un respaldo, es un archivo. Se
restaura en una base vacía y se cuentan las filas de `Tenant`, `Customer`,
`Order`, `Pass`, `Commission`.

**Sin verificar:** si Railway tiene sus propias instantáneas. Hay que mirarlo en
su panel. Hoy es lo único que hay.

---

### 🔴 P0-2 · Los límites de peticiones NO funcionan. Ninguno.

**Estado: ABIERTO. No se tocó a propósito — ver el riesgo.**

Demostrado en producción:

```bash
for i in $(seq 1 40); do
  curl -s -o /dev/null -w '%{http_code}\n' \
    "https://api.soyclubify.com/api/public/deliveries/by-phone/protein-station?phone=3150621706" &
done | sort | uniq -c
#   40 200        ← contra una ruta con @Throttle de 30/min. Ni un 429.
```

**Todos los `@Throttle` de la plataforma son decorativos**, incluido el de
`/auth/login`. No hay nada frenando fuerza bruta de contraseñas ni barridos.

El `ThrottlerGuard` SÍ está registrado como `APP_GUARD` en `app.module.ts`. La
sospecha principal es que **falta `trust proxy`** en `main.ts`: detrás del proxy
de Railway, Express no ve la IP real del cliente. Hay que confirmarlo antes de
dar la causa por buena.

**Por qué no se arregló ya:** al activarlo, los límites empiezan a aplicarse de
verdad y el global está en **100 peticiones/minuto**. Un dueño con el panel
abierto podría superarlo y quedarse fuera. **Hay que medir primero** cuántas
peticiones hace el panel en una sesión normal, y subir el global si hace falta.
Arreglar esto a ciegas tumba producción un lunes por la mañana.

#### Lo que faltaba saber, medido el 2026-09-05

**La causa está confirmada: `trust proxy` no existe en ninguna parte del
backend.** Lo único que lo menciona es un comentario en
`convenios/alianzas-publico.service.ts:78` que ya documenta el problema. El
`ThrottlerGuard` sí está bien registrado.

Y **no hay `getTracker` propio en ningún sitio**, así que el Throttler usa su
comportamiento por defecto: **limita por IP**. Eso es lo que convierte el
arreglo de una línea en un problema, y nadie lo había mirado:

```bash
grep -rn "getTracker" backend/src   # vacío → limita por IP
```

- **Los empleados de un mismo local comparten la IP del wifi.** Sus peticiones
  se suman contra el mismo cubo de 100/min. Tres personas con el panel abierto
  y el dueño se queda fuera sin haber hecho nada raro.
- **Peor: `POST /auth/signup` está en 3 por hora POR IP.** En el local de un
  negocio, el cuarto registro del día —empleado o cliente— no entra. Hoy no
  pasa porque el límite no se aplica; **el día que se active, sí**.
- El refresco automático del panel es moderado y no es el problema: 30 s en
  pedidos y actividad, 25 s en domicilios, 60 s en la pantalla de cocina.

**Por eso el arreglo no es solo `trust proxy`.** Activarlo a secas cambia «nadie
está limitado» por «los locales con varios empleados se autobloquean». La
solución de fondo es que **el cubo sea por usuario cuando hay sesión, y por IP
solo cuando no la hay** — que es justo donde importa la fuerza bruta:

```ts
// backend/src/common/guards/throttler-por-usuario.guard.ts  (PROPUESTO, sin hacer)
@Injectable()
export class ThrottlerPorUsuario extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // Con sesión, cada usuario tiene su propio cubo: dos empleados del mismo
    // local dejan de restarse entre ellos. Sin sesión (login, registro,
    // webhooks) se limita por IP, que es donde importa la fuerza bruta.
    return req.user?.id ? `u:${req.user.id}` : `ip:${req.ip}`;
  }
}
```

```ts
// backend/src/main.ts  (PROPUESTO, sin hacer)
// Railway termina TLS en su proxy: sin esto req.ip es la del proxy, la misma
// para todo el mundo, y el limitador no distingue a nadie.
app.getHttpAdapter().getInstance().set('trust proxy', 1);
```

**Orden para no romper nada**, si se aprueba: (1) el tracker por usuario y subir
`signup` a algo sensato por IP; (2) desplegar **eso solo**, con `trust proxy`
todavía apagado — no cambia nada porque nada se aplica aún; (3) activar
`trust proxy` en un despliegue aparte, y mirar los 429 en Sentry esa misma
tarde. Así, si algo se tuerce, se sabe cuál de los dos pasos fue.

**Sigue sin decidirse — es del dueño, no mío.** Aquí solo está medido el terreno
y escrita la propuesta.

---

### ✅ P0-3 · La ruta pública del pedido devolvía la ficha entera del cliente

**Estado: CERRADO el 2026-09-05.** Commit en `main`, desplegado y verificado.

`getPublicByCode` hacía `return { ...o }` — la fila entera de la base. La llave
es el código del pedido: **4 caracteres de un alfabeto de 30**, únicos en toda
la plataforma. Acertando un código cualquiera salían **nombre, teléfono y
dirección de casa** del cliente, más referencias de pago y el `whatsappLink`
(que lleva la dirección otra vez dentro).

Medido, no estimado:

```
448 pedidos / 810.000 combinaciones = 1 acierto cada 1.808 intentos
```

Y **empeora solo**: con 10.000 pedidos sería 1 de cada 81. Repetible con
`railway run node backend/scripts/arqueo-codigos-pedido.cjs`.

Verificación de que está cerrado:

```bash
curl -s "https://api.soyclubify.com/api/public/orders/CBR6" | python -c "
import sys,json; d=json.load(sys.stdin)
print([k for k in ['customer','deliveryAddress','whatsappLink','paymentRef'] if k in d])"
#   []
```

**Pendiente de esto mismo:** pasar la respuesta a **lista blanca** (elegir qué
sale) en vez de quitar campos uno a uno. Hoy es una lista negra, y la próxima
columna que alguien añada al modelo saldrá publicada sin que nadie lo note.

---

### 🟠 P1-1 · Los códigos de pedido son demasiado cortos

**Estado: ABIERTO.**

4 caracteres, 810.000 combinaciones, únicos globalmente. Aunque ya no filtren
datos personales, siguen permitiendo enumerar pedidos ajenos (artículos, notas,
total) y **calificar el pedido de otro** (`POST /:code/rate`).

Subirlos a 6 caracteres son 729 millones de combinaciones. **Solo para pedidos
NUEVOS** — los existentes se quedan como están, y el código se le enseña al
cliente, así que hay que mirar dónde se pinta antes de cambiarlo.

---

### 🟠 P1-2 · Las 136 rutas públicas nunca se han revisado de forma sistemática

**Estado: EMPEZADO.**

```bash
grep -rc "@Public()" backend/src --include=*.controller.ts | grep -v ":0" | sort -t: -k2 -rn
grep -rho '@Public()' backend/src --include=*.controller.ts | wc -l    # 136
```

**Corregido el 2026-09-05:** este apartado decía «36 rutas». Son **36
controladores** y **136 rutas**. El trabajo es casi 4× lo que figuraba aquí.
`auth.controller.ts` solo aporta 16.

En una sola tarde aparecieron **tres huecos reales**: pedidos sin teléfono, ver
pedidos ajenos con 7 dígitos del número, y la fuga de P0-3. Que salieran tres a
la primera significa que hay más.

**Revisadas y correctas:** las 9 de `superadmin.controller.ts` (van por token de
invitación o son datos de marca públicos).

**Método para las que faltan:** para cada ruta pública, responder por escrito:
¿qué llave la abre? ¿es adivinable? ¿qué devuelve de más? ¿tiene límite de
peticiones (hoy ninguno lo tiene de verdad)? ¿escribe algo?

---

### 🟠 P1-3 · Nada garantiza el aislamiento entre negocios. Hoy funciona porque está bien escrito a mano, 322 veces

**Estado: ABIERTO. Fase 11, primera pasada hecha el 2026-09-05.**

Lo primero, porque es la parte tranquilizadora y hay que decirla con datos: **el
aislamiento funciona donde se ha mirado.** El backend es *fail-closed* —
[auth.module.ts](../backend/src/auth/auth.module.ts) registra 6 guards globales
(`JwtAuthGuard`, `RolesGuard`, `TenantStatusGuard`, `TenantLockGuard`,
`InfoLinkOnlyGuard`, `MaintenanceGuard`), así que **todo pide sesión salvo lo
marcado `@Public()`**. Que 115 controladores no lleven `@UseGuards` no es un
hueco: es el diseño.

**CORREGIDO el 2026-09-05 (lo de abajo estaba mal escrito aquí antes).** Sí
hay un middleware de Prisma que inyecta `tenantId`:
[prisma-tenant-middleware.ts](../backend/src/common/prisma/prisma-tenant-middleware.ts),
registrado en `prisma.service.ts:17`. Y **sí funciona** en los requests HTTP
autenticados: comprobado levantando una app Nest con el mismo patrón de
interceptor, el contexto del `AsyncLocalStorage` llega al handler incluso
después de varios `await`. El comentario de `test/tenant-isolation.e2e.test.ts`
que lo afirmaba tenía razón — lo que se pierde es el contexto **dentro del
test**, no el del request real.

Lo que queda descubierto son los agujeros que **el propio middleware declara**
en su cabecera y no puede tapar:

- **`update` / `delete` / `upsert` SINGULARES.** Prisma no admite un filtro
  no-único en su `where`, así que no hay nada que inyectar. Son justo las
  operaciones que **escriben**.
- Todo lo que corre **sin contexto**: crons, scripts, colas y lo envuelto en
  `TenantContext.runWithoutTenant()`.
- `role === MARKETING` y `SUPER_ADMIN`, que lo saltan por diseño.

O sea: el JWT dice *quién eres*, el `RolesGuard` *qué tipo de cosas puedes
hacer*, el middleware acota casi todo… **menos la escritura por id**. Ahí solo
queda que alguien se acuerde de escribirlo a mano. Sobre 65 modelos que lo llevan, y con **tres patrones distintos** de
hacerlo conviviendo en el repo:

```ts
// 1) where compuesto            2) comprobar y luego escribir
findFirst({ where: { id, tenantId } })   findFirst({ where: { id, tenantId } }); update({ where: { id } })

// 3) guard delegado
async update(user, id) { await this.get(user, id); /* get() lanza Forbidden */ return prisma.x.update({ where: { id } }) }
```

Medido con el auditor nuevo:

```bash
cd backend && node scripts/arqueo-aislamiento-tenant.cjs
#   Consultas sin tenantId en el where : 425
#     la funcion SI acota (correctas)  : 322
#     delegan en un guard (revisar)    :  40
#     NADIE las acota                  :  63   (24 de ellas escriben)
```

**Revisados a mano, uno por uno: 12 casos. Los 12, correctos.** Entre ellos los
que peor pintaban:

| Caso | Por qué parecía un agujero | Por qué no lo es |
|---|---|---|
| `products.update/remove`, `badges.update/remove` | `update({ where: { id } })` pelado | `this.get(user, id)` compara `tenantId` y lanza `Forbidden` |
| `suppliers.remove`, `reminders.update`, `automations.remove` | ídem | comprueban con `tenantId` **antes** de escribir |
| `cancelByToken` (cancelar cita, público) | cancela con solo acertar la llave | `manageToken` = `randomBytes(16)`, 128 bits |
| `completarRegistro` (público, escribe sobre un cliente) | `POST /passes/:id/completar-registro` | `id` es UUID v4, y solo rellena campos **vacíos**: no pisa datos |
| `staff.controller` cambio de contraseña | `user.update({ where: { id } })` | el id es `user.id`, el propio usuario |

**El hallazgo, entonces, no es un agujero: es que no hay red.** Las 322 correctas
lo son porque alguien se acordó 322 veces. La 323 se escribirá el día que se
añada un endpoint con prisa, no la va a frenar nada, y no se va a enterar nadie
—ni el CI, ni una revisión, ni el tipado.

**Arreglo de fondo: HECHO el 2026-09-05.** El auditor corre en el CI con la
cuenta actual como techo. No arregla nada de lo que hay —no hace falta, está
bien— pero **impide que entre la 323**. Es la diferencia entre «esperemos que
nadie se equivoque» y «no se puede fusionar si te equivocas».

El techo es **por archivo**, no un número global: con un total, arreglar una
consulta en un sitio daría margen para colar una mala en otro y el CI se
quedaría callado.

```bash
cd backend
node scripts/arqueo-aislamiento-tenant.cjs --ci        # lo que corre el CI
node scripts/arqueo-aislamiento-tenant.cjs --sellar    # tras revisar a mano
```

Cuando alguien añada una consulta que no acote, el paso se pone rojo y **dice
qué archivo y qué consultas**, no solo que subió un número:

```
=== AISLAMIENTO ENTRE NEGOCIOS: hay consultas nuevas que no acotan ===
  src/crm/crm.service.ts   4 -> 6
  src/crm/crm.service.ts:1034  connectGrowBusiness() User.update(id)  [ESCRIBE]
```

Comprobado que sabe ponerse en rojo, no solo en verde: se bajó el techo de un
archivo a propósito y el paso salió con código 1 nombrando las consultas. Una
prueba que siempre pasa es peor que no tenerla.

**Y se puso en rojo de verdad a los cinco minutos**, con el primer código nuevo
que tocó: `sedeDeSoloPedidos()` del commit `434e9039` de la otra máquina. Se
revisó a mano — `where: { id: user.id }`, el usuario de la sesión leyendo su
propia sede, correcto— y de ahí salió la lección que importa:

> **Un candado que da falsos rojos se acaba sellando a ciegas, y entonces ya no
> candado nada.** El punto ciego era siempre el mismo: *usuario sobre sí mismo*
> —cambiar la contraseña, el perfil, el idioma, el 2FA—. El auditor ahora
> reconoce `where: { id: user.id }` y no lo marca. Eso solo quitó 14 falsos
> positivos (77 → 63) y 9 escrituras (33 → 24).

**Lo que queda de esta fase, y no se ha hecho:**

- ~20 casos huérfanos y los 40 delegados, sin revisar uno a uno. Se priorizó por
  daño, no se agotó la lista.
- El auditor **no sabe si el `id` viene de un `@Param()`** —o sea, si lo controla
  quien ataca— o de una consulta interna ya acotada. Ese es el discriminador que
  más falsos positivos quitaría.
- **La prueba de verdad sigue bloqueada:** dos cuentas de negocios distintos y
  un intento real de cruzarlas contra producción. Leer el código demuestra que
  el filtro está escrito; no demuestra que funcione.

---

### 🟠 P1-6 · Cualquiera puede dar de baja a un contacto ajeno, y falsear que respondió

**Estado: ABIERTO. Encontrado el 2026-09-05 en la fase 10. NO se tocó — el
arreglo cambia cómo se traga el webhook real y eso se decide con el dueño.**

`POST /api/webhooks/email-inbound/:slug` no verifica firma. El propio código lo
sabe: hay un `TODO(hardening)` en
[mkt-webhook.controller.ts](../backend/src/marketing/mkt-webhook.controller.ts).

Lo que dice el comentario de ese archivo es que da igual, porque *«solo sellamos
eventos que correlacionan con un envío nuestro por `providerMessageId` → un
evento forjado sin ese id no hace nada»*. **Eso no es cierto en dos ramas**, y
son justo las que hacen algo:

```js
const { contactId } = await this.actions.stampEvent({ ... });   // sin messageId -> null
if (kind === 'unsubscribe') {
  const cid = contactId ?? (await this.contactIdByEmail(wl.id, email));  // <-- respaldo POR EMAIL
  if (cid) await this.contacts.setOptOut(wl.id, cid, true);
}
if (isInteraction(kind)) {
  const cid = contactId ?? (await this.contactIdByEmail(wl.id, email));  // <-- el mismo respaldo
  if (cid) await this.engine.onContactInteraction(cid, wl.id);
}
```

El respaldo por email se salta la correlación entera. Y `detectKind` clasifica
por una subcadena, así que forjar el evento es escribir una palabra:

```bash
# Baja a una persona de las comunicaciones de esa marca
curl -X POST https://api.soyclubify.com/api/webhooks/email-inbound/<slug> \
  -H 'Content-Type: application/json' \
  -d '{"type":"unsubscribe","email":"victima@ejemplo.com"}'

# O finge que contestó: reanuda el «esperar respuesta» y dispara email_reply
  -d '{"type":"reply","email":"victima@ejemplo.com"}'
```

**Lo único que hace falta** es el slug de la marca —que no es un secreto: va en
la URL— y un correo. No hace falta acertar ningún id interno.

**Daño:** no se filtran datos, pero se puede vaciar la lista de una marca a base
de bajas (un competidor deja a un negocio sin canal de correo) y corromper las
métricas y los workflows fingiendo respuestas. Y como **ningún límite de
peticiones funciona** (P0-2), se puede hacer en bucle.

**Lo bueno:** `setOptOut` y `contactIdByEmail` **sí** acotan por `whiteLabelId`,
así que no se puede saltar de una marca a otra. El aislamiento aguanta; lo que
falla es la puerta.

**Arreglo, a decidir con el dueño porque toca el flujo real del proveedor:**

1. Lo de fondo: verificar la firma sobre `req.rawBody` (el `TODO` que ya está
   escrito). El `rawBody` ya se guarda en `main.ts` para Stripe.
2. Mientras tanto, y más barato: exigir correlación real —quitar el respaldo por
   email para `unsubscribe` e interacción, o aceptarlo solo si a ese correo se le
   envió algo de esa marca hace poco. Hay que mirar antes cuántos eventos
   legítimos llegan hoy sin `messageId`, o se pierden bajas de verdad.

---

### 🟡 P2-1 · 121 filtros escanean la tabla entera por falta de índice

**Estado: ABIERTO. Fase 20, medido el 2026-09-05. No se aplicó ningún índice.**

```bash
cd backend && node scripts/arqueo-indices.cjs
#   Campos distintos usados en where : 653
#     ya indexados                   : 364
#     sin indice, pero acompanados   : 168   (el where lleva otro campo indexado)
#     SIN INDICE Y SIN ENTRADA       : 121   <-- estos si escanean la tabla
```

La distinción importa y es lo que hace la lista utilizable: un campo sin índice
**acompañado** de otro que sí lo tiene —casi siempre `tenantId`— no escanea
nada; Postgres entra por el índice y filtra el resto sobre pocas filas. Los 121
que quedan son los que no tienen por dónde entrar.

Los primeros, por veces que ocurren:

| Campo | Veces | Nota |
|---|---|---|
| `ReferralUse.tenantId` | 16 | Un `tenantId` **sin índice**. El modelo solo tiene `@@index([referralCodeId, status])` |
| `GrowBusinessAccount.deletedAt` | 15 | Borrado lógico sin índice, y se filtra en todo el flujo de mensajería |
| `ReferralCode.role` | 14 | |
| `Tenant.deletedAt` | 12 | |
| `ReferralUse.referralCode` | 12 | |
| `BusinessGroup.deletedAt` | 10 | |

**Verificado a mano y con matiz:** `Tenant.whiteLabelId` sale en el arqueo y se
usa en `tenant-context.interceptor.ts:38`, que suena a «en cada request». **No
lo es**: esa consulta tiene caché con TTL (`wlTenantCache`), así que el impacto
real es mucho menor. Se anota para que nadie se asuste al leer la lista.

**Nada de esto se ha aplicado, y hay dos razones:**

1. Un índice no sale gratis: ocupa disco y encarece **cada escritura**. La lista
   es para revisarla de arriba a abajo, no para aplicarla en bloque.
2. `ReferralUse` y `ReferralCode` son de **comisiones y afiliados**, territorio
   de Jhon (regla 7). Se audita, no se toca.

**Cuando se decida aplicar alguno**, va como script SQL aditivo e idempotente,
nunca `prisma db push`. Y con `CONCURRENTLY`, que no bloquea escrituras:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ReferralUse_tenantId_idx" ON "ReferralUse"("tenantId");
```

**Sin verificar:** el plan real. Esto es análisis estático — dice qué consulta
*puede* escanear, no cuál escanea de verdad ni cuánto cuesta. Para eso hace
falta `EXPLAIN ANALYZE` contra producción con los datos de verdad, y
`pg_stat_statements` para saber cuáles se llaman más.

---

### 🟠 P1-4 · 40 dependencias vulnerables en lo que se despliega, y nadie miraba

**Estado: ABIERTO. Fase 37. El CI ya impide que empeore desde el 2026-09-05.**

`npm audit` no corría en ninguna parte. Medido solo sobre lo que **se despliega**
(`--omit=dev`: vitest o `@nestjs/cli` no llegan al servidor y mezclarlos esconde
lo que sí):

```bash
node scripts/arqueo-dependencias.cjs
#   backend    critical 1   high 14   moderate 24   low 1
#   frontend   critical 0   high  8   moderate 10   low 1
```

Las que pesan **en este producto concreto**, no en abstracto:

| Paquete | Por qué importa aquí |
|---|---|
| `jsonwebtoken` (high) | Es la librería de la autenticación entera. Claves de tipo no restringido |
| `ws` + `socket.io-parser` (high) | El backend empuja pedidos en vivo por websocket. Exposición de memoria y agotamiento por adjuntos |
| `multer` (high) | Toda subida de archivos. DoS por limpieza incompleta |
| `sharp` (high) | Genera los QR y las imágenes de los pases. CVEs heredados de libvips |
| `tar` (critical) | Escritura arbitraria de ficheros por travesía de enlaces duros |

**No se actualizó ninguna, a propósito.** Subir 40 paquetes de producción de
golpe es exactamente la clase de cambio que tumba el sistema un lunes. Hay que
ir por tandas, empezando por `jsonwebtoken`, con `npm audit fix` sin `--force`
y corriendo la regresión entre tanda y tanda.

**Lo que sí se hizo, sin riesgo:** el mismo trinquete que en P1-3, en un job
propio del CI. Solo bloquea si suben las **críticas o altas** — un CVE nuevo de
nivel *moderate* en una dependencia de tercero avisa pero no deja a nadie sin
mergear un arreglo urgente. Un candado que estorba se acaba quitando.

```bash
node scripts/arqueo-dependencias.cjs --ci        # lo que corre el CI
node scripts/arqueo-dependencias.cjs --sellar    # tras revisar a mano
```

---

### ✅ P1-5 · Secretos filtrados: buscados y no encontrados

**Estado: CERRADO el 2026-09-05, con un pendiente que no depende del código.**

Lo que se comprobó, y con qué:

```bash
git ls-files | grep -iE "\.env"          # solo .env.example — ningún secreto versionado
grep -rnE "(sk_live_|AIza[0-9A-Za-z_-]{30,}|ghp_|xox[baprs]-|AKIA[0-9A-Z]{16})" backend/src frontend/src
#   4 resultados, los 4 son validaciones y enmascarado de la UI, no claves
grep -rhoE "NEXT_PUBLIC_[A-Z0-9_]+" frontend/src   # 6, todas legítimamente públicas
```

Las 6 variables `NEXT_PUBLIC_*` viajan al navegador de cualquiera **por
definición** —API_URL, APP_URL, LANDING_URL, S3_PUBLIC_URL, GOOGLE_CLIENT_ID,
GOOGLE_MAPS_API_KEY— y ninguna debería ser secreta. Ninguna lo es.

**Pendiente, y NO se puede cerrar desde el código:** la clave de Google Maps es
pública por diseño, pero **tiene que estar restringida por dominio** en Google
Cloud. Sin esa restricción, cualquiera que la copie factura contra la cuenta.
No aparece en el HTML ni en los 12 chunks de la home de producción, así que no
se pudo extraer para probarla. **Hay que mirarlo en la consola de Google Cloud:
APIs y servicios → Credenciales → Restricciones de aplicación → Sitios web.**

---

## 2. Lo que ya está construido

| Pieza | Dónde | Qué cubre |
|---|---|---|
| Prueba de humo en navegador limpio | `scripts/humo.cjs` | Primera visita, la condición que se nos escapó |
| Humo tras desplegar | `scripts/desplegar.cjs` | Avisa si acabas de romper el recorrido del cliente |
| CI en cada push | `.github/workflows/ci.yml` | Lint, typecheck, 51 spec, e2e con base, build. **Verde** |
| Sentry | back y front | Errores en servidor y en el navegador del cliente |
| Monitor de certificados | `wallet/cert-monitor.service.ts` | Avisa antes de que caduque el de Apple Wallet |
| Arqueo de dependencias | `scripts/arqueo-dependencias.cjs` | `npm audit` de lo que se despliega, en el CI. Bloquea solo si suben criticas o altas |
| Arqueo de indices que faltan | `backend/scripts/arqueo-indices.cjs` | Cruza los campos de los `where` con los indices del schema. Distingue escaneo real de filtro acompanado |
| Inventario de rutas publicas | `backend/scripts/arqueo-rutas-publicas.cjs` | Las 150 `@Public()` ordenadas por dano: si escriben, si la llave es adivinable, si ya se autentican por otra via |
| Arqueo de aislamiento entre negocios | `backend/scripts/arqueo-aislamiento-tenant.cjs` | Recorre el AST y ordena por riesgo las consultas que no acotan el negocio. **Corre en el CI** con techo por archivo |

```bash
node scripts/humo.cjs                 # a mano, contra producción
node scripts/humo.cjs --base=<url>    # contra un preview de Vercel
```

---

## 3. Las 45 fases: qué falta y en qué orden

Ordenadas por **daño evitado**, no por el número que traen en el documento
original.

### Ahora

| # | Fase | Estado | Nota |
|---|---|---|---|
| 26 | Backups | 🔴 ROTO | P0-1. Bloqueado: hacen falta credenciales |
| 26 | Prueba de restauración | ❌ | Sin esto no hay respaldo, hay archivos |
| 16 | Rate limiting | 🔴 ROTO | P0-2. Terreno medido: limita por IP y no hay getTracker. Propuesta escrita (cubo por usuario). Falta la decision |
| 10 | API — rutas públicas | 🔄 | P1-2. Inventario automatico hecho: **150** rutas, 111 abiertas de verdad, 49 escriben. 1 hueco nuevo (P1-6) |
| 11 | Multi-tenant / IDOR | 🔄 | P1-3. 12 casos revisados, 12 correctos. Auditor ya en el CI. Falta: ~20 huerfanos + 40 delegados, y las 2 cuentas de prueba |

### Después

| # | Fase | Estado | Nota |
|---|---|---|---|
| 30 | Primera visita | ✅ | `humo.cjs` |
| 6 | Service worker / PWA | ✅ | Auditado y corregido el 2026-09-05 |
| 3 | Navegadores (Playwright) | ❌ | Hoy solo Chrome. Falta WebKit y Firefox |
| 24 | Observabilidad | 🔄 | Sentry sí. Falta alerta por TASA: si los pedidos caen a cero un viernes a las 8 PM, algo pasó aunque todo responda 200 |
| 12 | Roles y permisos | ❌ | Matriz por rol contra API, no contra la UI |
| 13 | Autenticación y sesiones | ❌ | Con el rate limit roto, la fuerza bruta está abierta |
| 17 | Idempotencia | 🔄 | Club, alianzas y eventos ya usan bloqueo. Falta auditar pedidos y cupones |
| 20 | Base de datos | 🔄 | P2-1. Indices medidos: 121 escaneos de tabla. Falta N+1 (81 consultas en bucle) y consultas lentas reales |
| 27 | Disaster recovery | ❌ | Definir RPO y RTO. Hoy no existen |
| 21 | Rendimiento | 🔄 | Fuentes arregladas. Falta medir de verdad |
| 22 | Carga | ❌ | Nadie sabe cuánto aguanta la plataforma |
| 37 | Dependencias | 🔄 | P1-4. Ya corre en el CI con techo. Faltan las 40 por arreglar, empezando por `jsonwebtoken` |
| 38 | Secretos | 🔄 | P1-5. Buscados en git, codigo y bundle: **ninguno filtrado**. Siguen faltando los del backup en GitHub |
| 35 | Accesibilidad | 🔄 | Íconos de 26 px pendientes (guía: 44) |

### Lo que NO se puede hacer desde aquí

Marcar como `BLOQUEADO` y decir qué falta:

- **Dispositivos reales** — iPhone y Android de verdad. La emulación no
  demuestra el comportamiento del pase en la billetera ni el push real.
- **Credenciales de producción** — secretos del backup, panel de Railway.
- **Cuentas de prueba de dos negocios distintos** — sin ellas no se puede
  demostrar el aislamiento entre tenants, que es la prueba más importante que
  falta.
- **Pruebas de carga** — hay que acordar ventana y avisar, no se lanzan contra
  producción sin permiso.

---

## 4. Cómo trabajar esto

1. **Una fase por sesión.** Empezar cinco y no cerrar ninguna es peor que no
   empezar.
2. **Cada hallazgo, con evidencia repetible.** El comando exacto, en este
   documento. Sin comando, es una opinión.
3. **Arreglar solo lo que se pueda demostrar arreglado.** Si el arreglo tiene
   riesgo de tumbar producción (como el rate limiting), se documenta el riesgo y
   se decide con el dueño. No se decide solo.
4. **Después de cada corrección, la regresión.** `npx vitest run` en backend,
   `tsc --noEmit` en los dos lados, y `node scripts/humo.cjs`.
5. **Actualizar este documento** al cerrar algo: pasar el hallazgo a CERRADO con
   la verificación, y anotar lo nuevo que aparezca.
6. **Entrada en `docs/BITACORA.md` y push** al terminar. Es el único canal por
   el que la otra máquina se entera.

---

## 5. Registro de lo cerrado

| Fecha | Hallazgo | Verificación |
|---|---|---|
| 2026-09-05 | Ruta pública del pedido devolvía nombre, teléfono y dirección | `curl` sobre `/api/public/orders/CBR6` → sin datos personales |
| 2026-09-05 | «Mis pedidos» listaba pedidos ajenos con 7 dígitos del teléfono | Con 7 dígitos devuelve vacío; con el número completo, los 11 de siempre |
| 2026-09-05 | Se podían crear pedidos sin teléfono desde la API | La API responde 400 |
| 2026-09-05 | Bloqueo del service worker: primera visita rota en los 3 motores | `node scripts/humo.cjs` en verde |
| 2026-09-05 | El pedido se creaba y el WhatsApp no siempre se abría | Ventana nueva desde el gesto del usuario |
| 2026-09-05 | El empleado «solo pedidos» con sede veía los de TODAS las sedes | 6 tests en `orders/pedidos-por-sede.spec.ts`, incluido abrir por id |
| 2026-09-05 | Nada impedía que entrara una consulta nueva sin acotar el negocio | `arqueo-aislamiento-tenant.cjs --ci` en el CI, techo por archivo; comprobado que sabe ponerse en rojo |

### Abierto de eso mismo · roles y sedes (fase 12)

Al arreglar lo de arriba salieron dos cosas que NO se tocaron:

- **`TENANT_STAFF` con sede sigue viendo todos los pedidos.** Es deliberado: ese
  campo nació para los rankings de sellos por sede, y hay **52 empleados en 18
  negocios** con sede puesta que hoy ven todo. Apagárselo de golpe les cambia el
  trabajo sin avisar. Hay que revisarlo negocio por negocio y avisando. Medible
  con `railway run node backend/scripts/arqueo-empleados-sede.cjs`.
- **No existe el rol «solo escanear».** Los roles son `TENANT_OWNER`,
  `TENANT_STAFF`, `TENANT_ORDERS`. Un empleado creado «para que solo escanee»
  queda como `TENANT_STAFF` y ve casi todo el panel. No es un permiso que falle:
  es un rol que no existe. Hay que crearlo como se creó `TENANT_ORDERS`, y
  decidir antes qué ve (¿clientes? ¿el historial de sellos que él mismo puso?).
