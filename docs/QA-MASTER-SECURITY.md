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

Lo que NO existe es la capa de abajo. El JWT dice *quién eres* y el
`RolesGuard` *qué tipo de cosas puedes hacer*, pero **nada comprueba que el
objeto que pides sea tuyo**. No hay extensión ni middleware de Prisma: el
aislamiento depende, consulta a consulta, de que alguien escriba `tenantId` a
mano. Sobre 65 modelos que lo llevan, y con **tres patrones distintos** de
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

## 2. Lo que ya está construido

| Pieza | Dónde | Qué cubre |
|---|---|---|
| Prueba de humo en navegador limpio | `scripts/humo.cjs` | Primera visita, la condición que se nos escapó |
| Humo tras desplegar | `scripts/desplegar.cjs` | Avisa si acabas de romper el recorrido del cliente |
| CI en cada push | `.github/workflows/ci.yml` | Lint, typecheck, 51 spec, e2e con base, build. **Verde** |
| Sentry | back y front | Errores en servidor y en el navegador del cliente |
| Monitor de certificados | `wallet/cert-monitor.service.ts` | Avisa antes de que caduque el de Apple Wallet |
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
| 16 | Rate limiting | 🔴 ROTO | P0-2. Medir el panel ANTES de activarlo |
| 10 | API — rutas públicas | 🔄 | P1-2. 3 huecos en la primera pasada. Son **136** rutas, no 36 |
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
| 20 | Base de datos | 🔄 | Falta: índices, N+1, consultas lentas |
| 27 | Disaster recovery | ❌ | Definir RPO y RTO. Hoy no existen |
| 21 | Rendimiento | 🔄 | Fuentes arregladas. Falta medir de verdad |
| 22 | Carga | ❌ | Nadie sabe cuánto aguanta la plataforma |
| 37 | Dependencias | ❌ | `npm audit` no corre en CI |
| 38 | Secretos | 🔄 | Se sabe que faltan en GitHub. Falta buscar filtrados en el bundle |
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
| 2026-09-05 | Nada impedía que entrara una consulta nueva sin acotar el negocio | `arqueo-aislamiento-tenant.cjs --ci` en el CI, techo por archivo; comprobado que sabe ponerse en rojo |
