# Bitácora de trabajo — traspaso entre máquinas

> Trabajamos este producto desde **más de una máquina**, y las dos despliegan al
> mismo producción. Esta bitácora es el único punto donde la otra máquina se
> entera de lo que pasó acá.
>
> **Regla: si tocaste producción o dejaste algo a medias, escribe la entrada y
> haz push. Aunque no hayas terminado.** Una entrada corta hoy vale más que una
> completa dentro de tres días.

## 2026-09-05 — El botón de Instagram del menú, y el «no me deja escribir» del escáner

**El login del escáner que se quedaba cargando ERA el fallo del service
worker.** Descomunal reportó `/scan` cargando sin fin y sin poder escribir el
correo. Encaja exacto: la página se pinta con el HTML del servidor pero React no
llega a hidratar, así que los campos no responden. Y `/scan` **no estaba** en la
lista de rutas que el `activate` se saltaba —solo `/c/`, `/r/`, `/q/`, `/cita/`,
`/signup`, `/prueba`, `/trial`—, así que le tocaba de lleno. Con el bucle fuera
ya no puede pasar. Comprobado: los 16 chunks de `/scan` responden 200.

**Interruptor para el botón de Instagram del menú.** El de WhatsApp existía
desde siempre (`Storefront.whatsappButtonEnabled`, en Ajustes del menú); el de
Instagram no, y la única forma de quitarlo era borrarle al negocio el usuario de
Instagram — con lo que también desaparecía de la página del link, donde sí lo
quiere. Ahora hay `instagramButtonEnabled` con el mismo criterio: apagado, la
API pública no manda el usuario y el chip no se pinta.

Migración aditiva ya aplicada a producción (100 tiendas, todas encendidas por
defecto: apagarlo es decisión de cada negocio).

## 2026-09-05 — El informe de QA de Protein Station: 9 defectos REALES, corregidos

Un negocio mandó un informe de pruebas de 14 páginas. **Se verificaron los 12
puntos uno por uno contra el código y contra producción. Ninguno era inventado.**
Afectaban a TODOS los negocios, no solo a ese.

**El crítico (`sw.js`): la primera visita se rompía en los tres motores.** El
`activate` hacía `await client.navigate(client.url)` sobre cada pestaña. Bloqueo
mutuo: `navigate()` no resuelve hasta que termina la navegación, y el `fetch` de
esa navegación no se despacha hasta que el worker acabe de activarse, que es lo
que espera a `navigate()`. Chrome y Firefox: pestaña colgada. WebKit: cancela lo
que hay en vuelo y el menú pinta «Negocio no disponible». **Recargando funciona,
y por eso nunca lo vimos: al que ya entró una vez no le pasa.** Y le volvía a
pasar a todo el mundo en la primera visita tras CADA deploy que cambiara
`VERSION`. Se quitó el bucle; `clients.claim()` + `PWARegister` ya hacían el
trabajo. `/d/` y `/w/` pasan además al bypass del `fetch`.

**El caro para el negocio: el pedido se creaba y el WhatsApp no salía.** Dos
`window.location` sobre la misma pestaña con 800 ms de diferencia, compitiendo.
Con datos móviles ganaba el temporizador y el mensaje no se enviaba nunca. Ahora
WhatsApp va en pestaña nueva desde el gesto del usuario.

Los otros siete: pedidos sin teléfono (front **y** API — arreglar solo el front
deja la API abierta; en MESA no se exige a propósito), «Volver al menú» que
llevaba al menú de mesa sin botón de pedir, emojis que WhatsApp convierte en
rombos (es de WhatsApp: `wa.me` devuelve U+FFFD por cada emoji de 4 bytes —
comprobado con curl; se cambiaron por símbolos del plano básico y hay test),
«Mis pedidos» que listaba los pedidos de otro con 7 dígitos de su teléfono,
«Boyaquí», el handle de Instagram usado crudo como href, y las 129 familias de
tipografías bloqueando el primer pintado de páginas que no usan ninguna.

**Antes de cambiar la búsqueda de «Mis pedidos» a `endsWith` se miró el formato
real de los teléfonos en producción**: 6.120 de 6.135 en formato simple, y los
15 raros ya no eran localizables ni con `contains`. No se rompió a nadie.

Pendiente, dicho en la respuesta al cliente: los iconos de 26 px (guía: 44) y
deduplicar la llamada al menú cuando se resuelve el idioma — esto último no se
tocó porque el orden de resolución del idioma es delicado y el menú hoy funciona.

Respuesta al negocio en PDF: `Documentos/Respuesta-Clubify-Protein-Station.pdf`
(fuera del repo, es de cara al cliente).

## 2026-09-05 — La suscripción del club se puede cobrar al mes o al año

**Tocada la base de producción.** `ClubPlan.periodicidad` (text,
`MENSUAL`|`ANUAL`, default `MENSUAL`), con
`scripts/apply-club-periodicidad-migration.cjs` — aditivo e idempotente, se
puede volver a correr. Aplicado ANTES de desplegar el backend, que es el orden:
al revés, el backend lee una columna que no existe. El único plan que había
quedó en `MENSUAL`, que es lo que era.

**Lo que cambia es el precio, NO el cupo.** El cupo se repone el día 1 de cada
mes en los dos casos: quien paga el año por adelantado recibe sus beneficios mes
a mes igual que el que paga cada mes, y por eso el anual se puede vender más
barato. Un cupo anual de golpe sería otro producto —el socio se lo gasta en
enero y al negocio le quedan once meses de cliente ya cobrado y sin nada que
darle—. Hay un test en `club-reinicio.spec.ts` que lo fija: si alguien hace que
el cupo dependa de la periodicidad, se cae.

Se nota en el formulario del plan (desplegable pegado al precio, con la etiqueta
y el ejemplo cambiando con él), en la lista de planes, en la ficha del plan y en
el informe de consumos («cobrado al año por N socios» — dividir entre doce para
que dijera «al mes» sería inventar: ese dinero entró entero en el alta).

`periodicidad` es TEXTO y no enum de Postgres, igual que `periodicity` en el
resto del sistema: añadir un valor a un enum en producción es una migración con
bloqueo. Lo que no se entiende cae en `MENSUAL`.

271 tests de club y escáner en verde. Desplegado backend y frontend
(`6ebe7448`), verificado en el paquete que sirve Vercel.

## 2026-09-04 (tarde) — El registro del socio, con la cara del alta de siempre

El paso que se hizo por la mañana era un formulario aparte: tres cajas sueltas
sin etiquetas, el cumpleaños en dos casillas de teclear y ni rastro del negocio.

Ahora es el mismo formulario que `/c/[cardId]`: logo y nombre del negocio
arriba, etiqueta encima de cada campo, y el cumpleaños en **dos listas** con los
meses traducidos y el aviso del regalo. Elegir «Marzo» no se equivoca; teclear
«03» sí.

El nombre se enseña **siempre y ya puesto** —es lo que le confirma al socio que
la tarjeta es suya—, y de solo lectura si el negocio ya lo tiene: cambiarlo se
pide en el mostrador, así un enlace reenviado sigue sin poder reescribir una
ficha ajena.

`lib/opciones-cumple` es de los dos formularios. Dos listas de meses en dos
archivos acaban siempre igual: una traducida y la otra en español para todos.

Con el formulario delante se quita la cabecera de arriba, que decía «muestra
este código al cajero» a alguien que aún no ha terminado de registrarse y dejaba
la marca tres veces en la misma pantalla.

## 2026-09-04 (tarde) — El nombre en la tarjeta se encoge, no se corta

`WalletPassPreview` cortaba con puntos suspensivos: «DEMO CLU…». Ahora el nombre
del negocio —y el del titular, que tenía el mismo defecto— **baja de tamaño en
tres escalones y salta de renglón**. `line-clamp-2` queda solo de tope para un
nombre disparatado; a dos renglones de 9px caben unos 60 caracteres.

De 9px no se baja: por debajo deja de leerse, que es justo lo que se quería
evitar. Y los escalones son fijos, no un ajuste continuo, para que el nombre no
acabe de un tamaño distinto en cada tarjeta.

Es un solo componente y lo usan los seis sitios donde se ve una tarjeta: alta de
tarjeta, edición, diseño del club, diseño de alianzas, la página de instalación
y la vista previa de sellos. Por eso el ajuste es general con un solo cambio.

**Lo que esto NO arregla:** si el recorte se ve en el pase YA INSTALADO, ahí
manda Apple. `logoText` lo pinta el sistema y no acepta tamaño; lo único que
podemos hacer —y ya está hecho— es no robarle sitio con el campo de cabecera
(`10/10` en vez de `10 / 10`).

## 2026-09-04 (tarde) — Redimir el cupo del club desde la ficha del cliente

Solo frontend: el backend ya tenía todo (`POST /club/caja/consumir/:membresiaId`
y `POST /club/caja/anular/:consumoId`, ambos abiertos a `TENANT_STAFF`). Lo que
faltaba era el botón en `/app/customers/[id]`.

Hasta ahora el cupo solo se descontaba desde el escáner, y eso deja fuera al
socio que llama por teléfono, al que pide para llevar y al código que no lee.
Se apuntaba en un papel.

**Lo que sigue sin haber, a propósito:** los botones genéricos de «Sellar» y
«Canjear». Son de la tarjeta de sellos y en un club hacen lo contrario de lo que
dicen —sellar REGALA cupo, canjear lo pone a cero—. El botón nuevo llama al
consumo del club: descuenta de a uno, deja `ClubConsumo` en el histórico, empuja
el pase al móvil y se puede anular.

Detalles que no son de adorno:

- **El saldo lo dice el servidor, no se resta a ojo.** Si otra caja consume a la
  vez, restar en el navegador deja el número mintiendo hasta recargar.
- **«Deshacer» al lado**, mientras no se salga de la ficha. Un clic de más aquí
  le quita un café de verdad a alguien que lo pagó, y mandarlo a buscar el
  consumo en el histórico del plan es demasiado lejos. Pasado ese momento, se
  anula desde `/app/club`.
- **Cuando no se puede, se dice por qué** («Membresía detenida», «Sin cafés este
  mes»). Un botón gris a secas hace que el negocio crea que la web está rota.

## 2026-09-04 (tarde) — El paso de registro tapaba el botón de instalar en 65 negocios

**Regresión mía, del commit de esta mañana. Corregida y desplegada (`74133bb2`).**

El formulario que le pide correo y cumpleaños al socio del club antes de
enseñarle los botones se estaba pintando en **cualquier** tarjeta: `getPublic`
calculaba las banderas para todos los pases, no solo para los de un plan.

Alcance medido contra producción: **955 pases de 65 negocios** cuyo cliente no
tiene correo o cumpleaños. Cada uno es alguien que abre la pantalla de «aún no
has terminado tu registro» y se encuentra una ficha en vez del botón «Añadir a
Apple Wallet» — justo la pantalla que el negocio le manda para instalarla.

El gate va ahora **en los dos lados a propósito**: el backend manda
`registro: null` sin club, y la vista comprueba además `data.club`. Taparle el
botón de instalar a todos los clientes de todos los negocios sale demasiado caro
como para colgarlo de un solo sitio.

Comprobado en vivo, no de memoria:

```
/api/passes/48e50250-…/public  → normal, registro=null      (botones a la vista)
/api/passes/af7b663f-…/public  → CLUB,   registro={faltaEmail:true, …}
```

**La lección, que es la de siempre:** el club se da de alta en el mostrador con
un dato y por eso necesita la ficha; **el resto de tarjetas ya pasó por el
formulario de su negocio**. Antes de añadir un paso a `/w/[passId]`, preguntarse
a cuántas de las ~5.900 tarjetas que NO son de club le cae encima.

### Y lo que NO era esto: Serendipity

Su tarjeta «Croissant» está activa, tiene 7 pases y **los 7 la instalaron**, dos
de ellos hoy mismo. Solo a uno (Ismael Serrate) le falta el cumpleaños. Es decir
que ahí el registro y la instalación funcionan; si siguen viendo algo raro hace
falta el enlace exacto y el negocio, porque en los datos no aparece.

Serendipity **no tiene el club encendido** (`clubEnabled = false`), pero eso es
otra cosa: el interruptor por negocio de `/admin/tenants/{id}`.

## 2026-09-04 — El club, en vivo: registro antes de instalar + arqueo de producción

Desplegado (`96b3d66f`, backend y frontend, desde `C:\dev\clubify` y por
`desplegar.cjs`). Tres cosas que se ven en el móvil:

1. **El socio del club termina su registro antes de ver los botones de
   instalar.** Se da de alta en el mostrador con un solo dato —el teléfono— y
   era el único cliente del negocio que nunca pasaba por un formulario. El
   endpoint `POST /api/passes/:id/completar-registro` es público por `passId`,
   igual que descargar el pase, y **solo rellena huecos: nunca pisa lo que el
   negocio ya puso**, así que un enlace reenviado no puede secuestrar una ficha.
   Se puede saltar: quedarnos sin el cliente por un cumpleaños sería peor.
2. **El nombre del negocio ya no se come con el contador** en la cabecera de
   Apple: `10/10` en vez de `10 / 10`. Vale para club y para sellos.
3. **La miniatura previa ya es el pase**: dos filas a partir de 6 sellos y los
   campos «Te quedan / Cliente» del club, no «Titular / Recompensa».

### Arqueo de producción (2026-09-04)

| negocio | club | plan | socios |
|---|---|---|---|
| DEMO CLUBIFY | ON | Café Plan, 10 café/mes | 3 (1 consumo) |
| NudoCowork | ON | **ninguno** | 0 |
| Serendipity | **OFF** | — | — |

Dos cosas quedan **pendientes de una persona**, no de código:

- **NudoCowork tiene el módulo encendido y ningún plan.** Quien entre a su panel
  ve el club vacío. El plan (nombre, cupo, precio) es decisión del negocio.
- **Serendipity está apagado** — por eso «no aparecía» al ir a instalarlo. Se
  enciende en `/admin/tenants/9213a632-686e-41a7-bbc8-be3f8a1bd30e`, interruptor
  **«Tarjeta de Club»**. Ya no hace falta SQL contra producción.

Los tres socios de Demo Clubify **no tienen correo ni cumpleaños**: son el caso
real que el paso de registro viene a cerrar, y sirven para verlo en vivo.

Para volver a preguntarle esto a producción sin escribir nada:
`railway run node scripts/arqueo-club.cjs` (y `arqueo-club-socios.cjs`,
`arqueo-modulos.cjs`).

### Y una fuga de marca que NO se tocó

En el panel de afiliado de Clubify (`/ref/nicolas-rojas`) aparece material de
apoyo **de Sellea**. No es un fallo de filtro: **`SupportMaterial` no tiene
columna de marca**. Se scopea por `audience` y por `scopeInfluencerId`, y nada
más — así que todo material con `scopeInfluencerId = null` lo ve *cualquier*
afiliado de *cualquier* marca. Arreglarlo pide columna nueva + backfill + el
selector en el editor admin. **Es territorio de Jhon (afiliados): no se tocó.**

## 2026-09-04 — El repo SALE de OneDrive. Las dos máquinas ya están fuera

**Esta es la causa de los ~8 despliegues que revirtieron producción ayer.**

El repo vivía dentro de OneDrive, que sincronizaba la carpeta entre las dos
máquinas — **incluido el trabajo sin commitear y el propio `.git`**. Con eso,
desplegar desde una copia atrasada borraba de producción lo que había subido el
otro, y el `git status` de cada uno mentía sobre lo que había en la otra
máquina.

Jhon ya movió la suya. Esta máquina también:

```
antes:  C:\Users\USUARIO\OneDrive\Documentos\Clubify PRO
ahora:  C:\dev\clubify
```

**La copia de OneDrive queda muerta. No trabajar ni desplegar desde ahí.**

### Lo que hubo que copiar a mano (no está en git)

```
backend/.env
frontend/.env.local
frontend/.vercel/        ← sin esto, vercel crea un proyecto NUEVO en vez de actualizar
```

Si algún día se vuelve a clonar, son esos tres. `team_clubify/` no está en esta
máquina.

### Las dos reglas que cierran el tema

1. **Desplegar SOLO con `node scripts/desplegar.cjs backend|frontend`, desde
   `main`.** Nunca `vercel --prod`, `railway up` ni `vercel promote` directos:
   esos suben la CARPETA local, y eso es exactamente lo que revirtió producción.
2. **Nada de `git add -A`.** Commitear por rutas explícitas.

### Y la que faltaba, que no era de OneDrive

Aparte del sincronizador había un segundo problema, y conviene no confundirlos:
**se estaban desplegando dos ramas distintas al mismo producción**
(`chore/merge-emails-sobre-314` y `feat/commissions-auto-cutoffs`, con 75 y 33
commits de divergencia). Cada despliegue sustituía al del otro **aunque las dos
copias estuvieran perfectamente al día**, porque `git pull` solo baja lo de tu
propia rama.

Eso ya está resuelto: las dos ramas están fusionadas en `main` y producción va
por `main`. **Que nadie vuelva a abrir una rama larga en paralelo**, o el
sincronizador dejará de ser el culpable y volveremos a lo mismo.

### Cómo saber si tu despliegue entró

`desplegar.cjs backend` ahora espera y avisa. Y la comprobación manual, que vale
para los dos: **pedir una ruta que solo exista en tu commit**. Si da 404
mientras otra da 401, tu código NO está arriba — `/api/health` seguirá diciendo
200 igualmente.

---

## 2026-09-03 — Fusión de las dos ramas a `main` + deploy: producción DES-cruzada

**Máquina/quién:** máquina de Jhon (Claude) · rama `main` · commit `e0e63b32`
**Estado: DESPLEGADO y verificado.** Ya NO hay freeze.

### Qué pasó

Producción estaba **partida en dos** (backend = `chore/merge-emails-sobre-314`,
frontend = `feat/commissions-auto-cutoffs`), por `vercel promote` a mano que movió
el puntero atrás. Se consolidó todo en `main` y se desplegó backend + frontend
desde ahí. **`main` es ahora la rama de producción** (la guarda de `desplegar.cjs`
ya lo exige).

### Cómo se hizo la fusión

Base `origin/main` → merge `origin/feat` → merge `origin/chore`, en un **worktree
aislado** (no se tocó el árbol principal, que tenía trabajo en vuelo). Conflictos:
los 2 que anticipó Javi (`docs/BITACORA.md` unido, `frontend/src/app/layout.tsx`
conservando los dos cambios — `NativeAppChrome`/`OverflowDebug` + `googleFontsUrls()`
plural) más 3 de documentación (`CLAUDE.md`, `ESTADO-PRODUCCION.md`, BITÁCORA) por
partir de `origin/main`; se tomó la versión de feat (la más nueva).

### Se INCLUYÓ push-notifications (decisión de Jhon)

`feat` traía `6c2cb505 feat(push)`: registro de dispositivos para notificaciones
nativas, con cambio de esquema. La tabla **`DeviceToken` ya estaba aplicada en
prod** (aplicada desde la otra máquina; se re-corrió `apply-device-tokens-migration.cjs`
y confirmó columnas + índices, 0 tokens). Aditiva, sin tocar tablas existentes.

### Verificación

- Backend `tsc` 0 · Frontend `tsc` 0 · `vitest src/convenios` 180/180.
- `vitest src/email src/integrations`: **38/39**. La única roja (`trial_started`
  sin correo gemelo, `brand-message-templates.spec.ts`) es **pre-existente en
  las dos ramas** (archivos idénticos), NO la causó el merge — Javi solo corría
  `convenios`. El SMS se manda igual; falta el correo gemelo o excluir el trigger
  del invariante (es mensaje al cliente, no al negocio). Pendiente de decidir.
- Deploy desde worktree limpio en `main`. Curls: `/hub`, `/app/alianzas`,
  `/app/club` → 200; `api …/cuponera/panel/card` → 401; `api …/public/alianzas/
  demo-clubify/ecopetrol` → 200. Prod ya no cruzada.

### PENDIENTE importante

- **Backfill del income capture Hotmart**: el backend estuvo días partido con la
  versión SIN `9f6bbc7f`, así que hay pagos LATAM (moneda local) que no entraron
  a Contabilidad esos días. Reconstruir desde `HotmartWebhookEvent` (dedup por
  txId). Antes se había aparcado; ahora son más días.
- Decidir lo de `trial_started` (correo gemelo o exclusión del test).
- De aquí en más **ambas máquinas despliegan solo desde `main`**. Las ramas
  `feat/commissions-auto-cutoffs` y `chore/merge-emails-sobre-314` ya están
  fusionadas en `main`.

## 2026-09-02 — Alianzas terminada en código, SIN desplegar (freeze) + guarda de rama

**Nada de esto está en producción. Freeze en pie: la fusión y el despliegue los
corre Jhon.**

### Qué pasó

Producción sirve un frontend **anterior** a las dos funciones nuevas. Se
comprueba en un segundo:

```
/app/alianzas   404      <- no existe en el build que corre
/app/club       404
/app/cards/new  200
```

Por eso Javier ve que del menú desaparecieron Alianzas y Tarjeta de Club, y que
el asistente de «nueva tarjeta» ya no ofrece las dos nuevas. **No es un cambio
de código: es el rollback.** Los interruptores del negocio están bien
—`demo-clubify` tiene `conveniosEnabled` y `clubEnabled` en `true` en la base de
producción—, así que al desplegar vuelven solas.

### Ramas

La fusión a `main` tiene que llevar **las dos** ramas o borra trabajo:

| rama | adelante de main | commits que la otra no ve |
|---|---|---|
| `chore/merge-emails-sobre-314` (alianzas + club) | 427 | 77 |
| `feat/commissions-auto-cutoffs` (Jhon) | 389 | 39 |

Los 39 de Jhon incluyen InfoLinks, el income capture de Hotmart y la app móvil
de iOS. Fusionar solo una de las dos ramas los borra de producción.

### Guarda de rama en `desplegar.cjs`

El script ya se negaba a desplegar por detrás de **tu** rama. El agujero: estar
al día con tu rama no dice nada de si tu rama tiene el trabajo del otro — hoy
las dos estaban «limpias y sincronizadas» sin verse 39 commits.

Ahora el despliegue sale de `main`, o de lo que diga `RAMA_PROD` dicho a
propósito. Desde otra rama muere y enseña los commits que le faltan.

**No cubre `vercel promote`**, y está escrito en el código: promover no pasa por
el script, coge un despliegue viejo que ya está en Vercel sin mirar git. Ahí la
única defensa es no usarlo.

### Alianzas — lo último que se tocó

La plantilla `Card` del convenio **ya no sale en el listado de Tarjetas**. El
filtro va en `list()` del servicio, no en la pantalla, porque ese listado lo
consumen once pantallas del panel. Estando ahí solo invitaba a errores: ofrecía
su enlace de alta genérico (que se salta el código de la empresa), el botón de
borrar (que arrastra los pases de todos los empleados), y salía como destino en
la tienda, en los pop-ups del menú, en los QR de mostrador y en el segmentador
de notificaciones.

Nota: la plantilla de **Tarjeta de Club** sigue apareciendo en ese listado. El
mismo argumento le aplica, pero es módulo de Javier y no se toca sin que lo
pida.

### La tarjeta ahora nace con la alianza (y se puede retocar)

La `Card` se creaba con el PRIMER empleado que activaba. Eso dejaba al dueño
repartiendo el enlace a ciegas, al primero en entrar fijando unos colores que
nadie eligió, y dos activaciones simultáneas podían crear dos plantillas.

Ahora se crea en la misma transacción que el convenio, y el panel trae un editor
con vista previa en vivo (logo del aliado, colores, título). La forma vive en
`alianzas-plantilla.ts` —puro, 13 tests que importan el módulo real— y la
comparten el camino temprano y el perezoso, que se queda como red para las
alianzas anteriores.

**El texto de recompensa se dejó fuera del editor a propósito**: en un pase de
alianza lo pisan los beneficios vivos en Apple, en Google y en la vista del
empleado. Editarlo no cambiaría nada visible y permitiría una tarjeta que promete
«20% de descuento» mientras la caja aplica el 10%.

### Al desplegar, comprobar

1. `/app/alianzas` y `/app/club` responden 200 (no 404).
2. El asistente de nueva tarjeta ofrece las cuatro.
3. `https://api.soyclubify.com/api/public/alianzas/x/y` da **404**, no 401.
4. El enlace del empleado carga: `/alianza/demo-clubify/ecopetrol`.

Las dos migraciones (`apply-convenios-migration.cjs`,
`apply-alianzas-migration.cjs`) **ya están aplicadas** en producción.


## 2026-09-02 — Los avisos al equipo salen por la línea 2, que no entrega

**Sin resolver. Javier decide dejarlo así por ahora.**

Jhon dice que no le llegó ningún aviso de la compra de `junior_hq@hotmail.com`
(ojo: con **q**, no con g — con la g no aparece nada y se pierde media hora).
Comprobado en producción: de nuestro lado los dos salieron bien.

```
16:06:20  Pago Hotmart recibido SIN cuenta aun  -> sent, con id de proveedor
16:09:54  Nuevo preregistro en Clubify          -> sent, con id de proveedor
```

`sent` significa que **Grow Business lo aceptó**, no que llegara al teléfono.

La causa casi segura llevaba escrita en `scripts/linea-de-envio.cjs` desde el
1 de agosto:

> OJO (2026-08-01): el default del código se cambió de 2 a 1 porque el WhatsApp
> del 2 fallaba en la entrega. Si vuelves a mover algo al 2, comprueba que los
> mensajes llegan de verdad antes de darlo por bueno.

El 1 de septiembre se movió la cuenta de plataforma a la línea 2 a petición de
Javier, **sin leer ese aviso ni comprobar la entrega**.

Para retomarlo:

- Volver a la línea 1 es un comando y es reversible (`linea-de-envio.cjs`).
- O arreglar la línea 2 en Grow Business: hay que ver por qué ese número acepta
  y no entrega.
- El acceso MCP que hay en la sesión apunta a OTRA subcuenta
  (`Corp. Grow Business`, `NrzXRiuKoid7RrjUW6dL`), no a la que envía
  (`Reseñas`, `ANHzFDaLU8zKeA3nFCBk`), así que la entrega no se puede verificar
  desde ahí.
- Prueba rápida para separar «es la línea» de «es su número»: mirar si a Javier
  le llegaron los mismos avisos, que salen por la misma línea.

Y una nota de método: al escribir esta entrada con un script de Python, un emoji
del cuerpo reventó la codificación y el fichero se guardó VACÍO — se commitearon
4178 líneas borradas. Se recuperó con `git checkout HEAD~1 -- docs/BITACORA.md`.
Para tocar la bitácora, editarla directamente; no generarla desde un script.

---

## 2026-09-02 — ALIANZAS **DESPLEGADO EN PRODUCCIÓN** ✅

Migraciones aplicadas y código arriba. El módulo existe en producción por
primera vez.

### Lo que se corrió, en este orden

1. `railway run node scripts/apply-convenios-migration.cjs` → 6 tablas, 3
   columnas (`Tenant.conveniosEnabled`, `Tenant.maxConvenios`,
   `Card.convenioId`), 15 índices, 12 claves foráneas.
2. `railway run node scripts/apply-alianzas-migration.cjs` → `activoAliado`,
   `aliadoToken` y el índice único parcial `(convenioId, documento)`.
   Resultado: `convenios: 0 · tarjetas: 0`.
3. `node scripts/desplegar.cjs backend` — commit `37605259`.
4. `node scripts/desplegar.cjs frontend`.

### Cómo se verificó que subió de verdad

Un 404 NO sirve de prueba: lo dan igual una ruta viva sin resultados y una que
no existe. Lo que distingue es el **cuerpo**:

| Ruta | Respuesta | Qué demuestra |
|---|---|---|
| `/api/public/alianzas/x/y` | «Este enlace no está disponible.» | el handler está vivo |
| `/api/public/aliado/tokenfalso` | «Enlace no válido.» | el portal arreglado está arriba (esa ruta solo existe en el último commit) |
| `/api/public/noexiste/x/y` | `Cannot GET …` | el 404 genérico de Nest — la comparación vale |

Frontend: `/alianza/<negocio>/<empresa>` y `/aliado/<token>` responden 200; una
ruta inventada, 404.

### QUÉ FALTA PARA USARLO

**Nada está encendido todavía.** `conveniosEnabled` está en `false` para todos
los negocios, que es lo correcto: nadie ve el módulo hasta que se le active.

Para la primera prueba real: panel de admin del negocio → **Alianzas con
empresas** → crear desde `Tarjetas → Nueva tarjeta → Alianza con una empresa`.
Usar verificación **por código** (LISTA es el modo más frágil) y vigencia
ilimitada.

### Dos defectos conocidos que NO se arreglaron

- **El filtro por sede no se aplica nunca.** `AuthUser` no lleva `locationId` y
  en `scanner.service.ts` va con un `as any`, que es lo que impide que
  TypeScript avise. Una alianza limitada a una sede vale en todas, y
  `ConvenioCanje.locationId` se guarda siempre null: el informe por sede sale
  vacío. **No vender alianzas por sede.**
- **Un empleado puede quedar bloqueado por otro.** Si alguien activa con el
  teléfono de un compañero antes que él (en modo CÓDIGO el código lo sabe toda
  la empresa), al compañero le sale el mensaje de datos que no coinciden. Lo
  desatasca el negocio desde el panel. De raíz pide verificar el teléfono, y no
  hay transporte de SMS por marca.

### Nota de entorno

`npm run arranca` **no funciona en Windows**: el script de build usa `rm -rf`,
que no existe en cmd. Para comprobar el arranque en esta máquina hay que borrar
`dist` a mano y correr `npx nest build --tsc`.

## 2026-09-02 15:00 — ⚠️ Un despliegue borró el módulo de club de producción

**Pasó lo que avisa `CLAUDE.md`, y así se ve.** A las 14:21 desplegué el backend
con el club. A las 14:48 entró otro despliegue **que no es mío** y producción se
quedó sin `/api/club/*`:

```
/api/club/planes  404   ← desaparecido
/api/cards        401   ← sigue ahí
/api/health       uptimeSec: 229
```

`railway up` sube **la carpeta local**, no lo que hay en git. Si OneDrive
todavía no ha sincronizado los ficheros del otro, desplegar desde ahí **borra de
producción lo que el otro subió**. Los commits estaban intactos en git; lo que
faltaba era en el servidor.

Restaurado desplegando desde el clon limpio de `HEAD` —que lleva el club Y las
alianzas—, con `node scripts/desplegar.cjs backend`. **Usad el script**: clona el
commit a una carpeta aparte y sube eso, así no puede pasar.

### Dos cosas para que no vuelva a colarse

1. **`desplegar.cjs backend` ahora espera y comprueba** que el contenedor se
   reinicia de verdad (`uptimeSec` pequeño), y si en 12 minutos no pasa, avisa
   de que el build falló y deja los comandos para mirarlo. Antes volvía en
   cuanto subía el paquete.
2. **Comprueba siempre una ruta que solo exista en tu commit.** Si da 404
   mientras otra da 401, tu código no está arriba — pase lo que pase con
   `/api/health`.

### Y un bug mío que salió de esto

El panel del club decía **«La Tarjeta de Club todavía no está activa en tu
cuenta»** cuando el módulo SÍ estaba encendido: el `catch` de `/club/estado`
caía a `false`, así que un fallo del servidor se le presentaba al negocio como
una decisión comercial y se le mandaba a escribirnos. Ahora se distingue «dijo
que no» de «no pudimos preguntar», y lo segundo ofrece reintentar.

---

## 2026-09-02 (tarde) — Tarjeta de Club: repaso de lógica, rendimiento y recorrido

Tres revisiones sobre el módulo ya desplegado. Lo que salió, corregido.

### Caminos por los que se escapaba dinero

1. **Cancelar y readmitir era una recarga.** Gastar los 10 cafés, cancelar,
   volver a dar de alta → otros 10. Repetible dentro del mismo mes con una sola
   cuota pagada. Y al revés: al cancelado por error el día 20 se le aplicaba el
   tramo de alta y perdía lo que ya había pagado. Era además el único camino que
   escribía un saldo **sin dejar `ClubConsumo`**, así que en el histórico no se
   veía. Ahora volver dentro del mismo mes conserva el saldo; en un mes
   posterior entra como nuevo.
2. **El día 1, la caja rechazaba al socio que había llegado a cero.**
   `resolverParaCaja` no miraba el período, así que entre las 00:00 y la primera
   pasada del cron —hasta una hora— el botón de consumir ni se pintaba, aunque
   `consumir` habría funcionado. El sesgo era feo: al que le SOBRABA cupo del
   mes viejo sí le dejaba pasar. Ahora la pantalla anticipa el reinicio sin
   escribir nada; quien escribe sigue siendo el consumo.
3. **Una automatización con `cardId` explícito le sumaba cupo a un socio.** El
   filtro `clubPlanId: null` estaba solo en el fallback, y esa rama ni miraba el
   tenant.
4. **Fusionar dos fichas del mismo socio** sumaba los dos contadores: 20 de un
   cupo de 10. Ahora se acota al cupo en las tarjetas de club.
5. **`anularConsumo` marcaba el consumo aunque no devolviera nada.** La
   comprobación de período iba DESPUÉS de marcar, así que un consumo de un mes
   anterior quedaba «anulado» sin devolverle un beneficio al cliente: contaba
   como anulado en los informes, no se podía reintentar nunca y al cajero se le
   decía después que no se podía deshacer. Y se cerró la carrera residual con
   una segunda comprobación **después** de tomar el candado del pase.
6. **El cron comiteaba a medias.** Si el pase de una membresía había
   desaparecido, `return false` dejaba el período avanzado con el pase sin
   tocar, y ni el cron ni el reinicio perezoso volvían a mirarla jamás. Ahora
   lanza, la transacción se deshace y el `catch` nuevo la salta de verdad.

### Lo que se cambió y luego se revirtió

Cambié `reiniciarCupos` para que un plan apagado dejara de repartir cupo. **Lo
revertí**, y el test que lo impedía tenía razón: si el negocio solo quería
cerrar las altas, cortarle el reparto a quien sigue pagando le quita en silencio
lo que compró — y eso es peor que seguir repartiendo, porque lo segundo tiene un
cajero delante que lo ve. Lo que faltaba de verdad era **la salida**.

### Lo nuevo

- **«Dar de baja a todos los socios»** en la pantalla del plan. Es la forma de
  cerrar un club. No borra nada: quedan en CANCELADA con su histórico.
- **Pantalla de Consumos.** `ClubConsumo` se escribía desde el primer día y no
  lo leía nadie: qué se llevó cada socio, cuántas unidades entregaste este mes,
  el promedio por persona, lo que cobras — y el botón de deshacer, que hasta
  ahora solo existía mientras la tarjeta seguía en pantalla del escáner.
- **Columna «Aún no la ha instalado»**. `walletInstalledAt` se guardaba en cada
  descarga del pase y no lo leía nadie: el negocio veía a todos sus socios
  iguales sin saber quién cobró y nunca instaló.
- **`?welcome=1`** en el enlace que se le manda al socio. Un parámetro decidía
  si la página empuja a instalar o si se comporta como «ya la tienes».
- En la billetera: un socio **de baja** ya no ve «EN PAUSA» sino «FINALIZADA»,
  el aviso ya no dice «Te quedan: EN PAUSA», y en Android el club **siempre**
  notifica (el corte genérico de «solo si hay saldo» ocultaba justo el momento
  de quedarse sin cupo).

### Rendimiento

- **El buscador de socios escaneaba la tabla `Customer` entera**, la de los 168
  negocios, con tres `ILIKE` por fila y dos veces por tecla. Faltaba el
  `tenantId` en el subselect.
- **El cron leía todas las membresías activas de la plataforma** 23 de las 24
  pasadas diarias para devolver cero filas: `periodo: { not }` no es un rango.
  Ahora `lt` + índice `[periodo, status]`.
- **Editar el plan reenviaba el pase a todos los socios** aunque solo cambiaras
  la descripción. Ahora solo si cambió algo que se ve en el pase.
- Índices nuevos: `[planId, status, createdAt desc]` para el listado, y
  **`@@unique([tenantId, clubPlanId])` en `Card`** — dos primeros socios a la
  vez creaban DOS tarjetas-plantilla y una dejaba huérfano el pase instalado.
- Menores: `select` acotado al buscar la tarjeta del plan, y el slug libre en
  una consulta en vez de hasta cincuenta.

**Correr la migración otra vez** (`apply-club-migration.cjs`): trae los tres
índices nuevos y es idempotente.

### Pendiente que NO toqué

`reiniciarCupos` abre **una transacción por fila** con tope de 5000. Con
volumen real son ~20.000 viajes a la base en serie y 5.000 pushes de golpe. Hoy
no duele —hay 0 socios— pero con miles hay que pasarlo a lotes con una sola
sentencia (CTE modificante) y repartir los pushes en el tiempo. No lo hice
ahora porque reescribirlo en SQL crudo se lleva por delante los 19 tests del
reinicio, y prefiero no tocarlo el mismo día que sale.

---

## 2026-09-02 — El backend lleva desde ayer sin desplegarse y nadie se enteró

**Los 3 últimos despliegues del backend FALLARON.** Lo que corre en producción
es de `2026-09-01 22:05`. Los tres fallos, por orden:

| Despliegue | Hora | Por qué |
|---|---|---|
| `6526154d` | 01-sep 23:34 | **52 errores de TypeScript** — el club a medias (`ClubMembresia.saldo`) |
| `d0998242` | 02-sep 02:18 | **La app no arranca**: `ClubModule` no importaba `WalletModule` |
| `e17dcbe3` | 02-sep 07:49 | Mío, subiendo desde `backend/` — ver abajo |

### Lo que lo hace peligroso

Un despliegue fallido **no se nota**. `/api/health` sigue en 200 y las rutas
viejas en 401, porque producción se queda tan tranquila con la imagen anterior.
Lo único que lo delata es que **una ruta NUEVA da 404**. Si no la pruebas,
das por desplegado algo que no lo está.

**Después de desplegar, comprueba siempre una ruta que solo exista en tu
commit.** Y si no la hay, mira `uptimeSec` en `/api/health`: si son horas, tu
despliegue no entró.

```bash
railway logs --build <deployment-id>       # por qué falló el build
railway logs --deployment <deployment-id>  # por qué no arrancó el contenedor
```

### RESUELTO — y ahora hay una comprobación para esto

```bash
cd backend && npm run arranca
```

Compila y levanta la app contra una base de datos **que no existe**. Suena raro
y es a propósito: Nest resuelve TODO el grafo de módulos antes de que Prisma
intente conectarse, así que un error de inyección sale primero y el fallo de
base de datos es la señal de que se llegó hasta el final. Tarda lo que tarde el
build; con `-- --sin-compilar` son segundos.

Hazlo **antes de desplegar el backend**. Es lo único que coge esta clase de
fallo: los tests unitarios construyen los servicios a mano.

### El fallo de arranque, que los tests no ven

```
Nest can't resolve dependencies of the ClubService (PrismaService, ?, QueueService).
```

`ClubService` inyecta `WalletService` para empujar el pase, y `ClubModule` no
importaba `WalletModule`. **Los tests unitarios no lo cogen**: construyen el
servicio a mano con sus tres dependencias. El grafo de módulos solo se arma al
arrancar, así que esto solo lo ve un arranque real. (`QueueService` sí resolvía:
`JobsModule` es `@Global()`.)

### Y NO: el `Root Directory` está bien

Me equivoqué al leer el primer fallo y escribí aquí que el servicio había
perdido `Root Directory = backend`. **Es falso.** El log de `d0998242` carga
`backend/Dockerfile` sin problema: subir desde la raíz del repo, como hace
`desplegar.cjs`, es lo correcto.

Lo que sí es verdad es lo contrario: **subir desde `backend/` NO funciona**,
porque entonces Railway busca `backend/backend`:

```
lstat .../snapshot-target-unpack/backend: no such file or directory
```

## 2026-09-02 (madrugada, 4ª vuelta) — Tarjeta de Club: panel, billetera y 9 defectos

El motor del club ya estaba hecho pero **solo respondía por API**: no había
dónde crear un plan. Ahora tiene panel, y una auditoría de paso encontró nueve
agujeros que se cierran en el mismo bloque.

### Lo nuevo

- **`/app/club`** — planes: crear, editar, precio, unidad, cupo del mes y los
  **tramos de alta** (cuántos recibe quien entra a mitad de mes; es solo para su
  primer mes y la pantalla lo dice, porque el negocio lo lee como el cupo
  permanente).
- **`/app/club/[id]`** — socios: alta buscando entre los clientes, pausar,
  reactivar, dar de baja y readmitir. Con buscador, filtro y paginación.
- **Entrada en el asistente de tarjetas**, como Alianzas: no es un `CardType`,
  lleva a `/app/club?nuevo=1`.
- **`Tenant.clubEnabled`**, apagado por defecto. Se enciende desde Módulos del
  tenant. Sin él no hay ítem de menú y crear plan o dar de alta da 403 — pero
  **consumir sigue funcionando**: apagar un módulo no puede quedarse con lo que
  un cliente ya pagó.
- **Endpoint nuevo** `GET /club/planes/:id/miembros` y `GET /club/estado`.
- **Deshacer en la caja**: el escáner tiraba el `consumoId`, así que la
  anulación —que estaba escrita, con su idempotencia y su push— no se podía
  llamar. Un doble toque del cajero se comía un café sin vuelta atrás.

### Los defectos que había (todos míos, del bloque anterior)

1. **En la billetera, una tarjeta de club se veía como sellos — e invertida.**
   Header `SELLOS 7 / 10` y aviso `Sellos: 7`: el cliente leía «llevo 7», y
   significa «me quedan 7». Ahora el header es la unidad del negocio en plural
   (`CAFÉS 7 / 10`) con «Te quedan: %@», en Apple y en Google, en los 4 idiomas.
2. **`/stamps` sellaba y canjeaba pases de club sin barrera.** Sellar le
   REGALABA cupo; canjear se lo vaciaba entero de un clic. Sin `ClubConsumo`, o
   sea sin rastro y sin poder anularlo. *(Las tarjetas de convenio tienen el
   mismo agujero abierto — no lo toqué porque ese módulo lo lleva la otra
   ventana. **Jhon: mirar `stamps.service.record()`.**)*
3. **Borrar la tarjeta del plan desde `/app/cards` mataba el club sin retorno**:
   cascada sobre TODOS los pases, socios con `passId` null y cada escaneo
   respondiendo «esta membresía todavía no tiene tarjeta», para siempre.
   Bloqueado en el backend, y en el listado ya ni se ofrece el botón.
4. **La tarjeta del plan nacía con el verde de Clubify.** La fuga de marca de
   siempre: se crea una sola vez y el primer socio la fija para todos.
5. **El enrolamiento público emitía pases de club.** `/c/{cardId}` daba un pase
   sin membresía; al escanearlo el cajero leía «esta tarjeta no es de un club» y
   entendía que el escáner estaba roto.
6. **Editar el plan no repintaba nada.** Subir el cupo de 10 a 15 dejaba la
   billetera diciendo `15 / 10`.
7. **Pausar no repintaba el pase.** El socio pausado llegaba al mostrador con su
   saldo intacto en el móvil. La caja lo frena bien, así que no era dinero: era
   la discusión en el mostrador.
8. **`funnelLoyalty` contaba a los socios del club** como cartones completos que
   nunca se canjean. Era el único resolutor sin el filtro `clubPlanId: null`.
9. **La ficha del cliente pintaba la tarjeta de club con botones de sellar y
   canjear** — las dos acciones del punto 2.

Y dos menores: el reinicio mensual se cortaba en 5000 en silencio (ahora avisa),
y `/api/club` faltaba en el bloqueo de los negocios «solo InfoLink».

### Dos cosas para la ventana de Alianzas

1. **`stamps.service.record()` no filtra las tarjetas de convenio.** Es el mismo
   agujero que se acaba de cerrar para el club: sellar o canjear un pase de
   convenio desde la ficha del cliente entra sin ninguna barrera. Solo cerré la
   rama del club para no tocar ese módulo.
2. **`scanner.service.ts:110` lee `(user as any).locationId`, y `AuthUser` no
   tiene ese campo** — verificado: no aparece en el decorador y nada en
   `src/auth` lo pone. Siempre llega `null`, y en `convenios-canje.service.ts`
   la comprobación de sede está guardada tras `locationId &&`. Resultado: **un
   convenio limitado a la sede A se canjea igual en la sede B.**

### ⚠️ `frontend/src/app/scan/page.tsx` queda SIN COMMITEAR — hay que decidir

El botón «Deshacer el último» del club está **en disco pero no en ningún
commit**, porque ese fichero tiene también un cambio de la otra ventana (el
`montoTiquete` pasa a ser uno por beneficio, para que con dos beneficios que
piden monto lo tecleado en uno no viaje con el canje del otro). Los dos cambios
comparten el primer hunk y no se separan limpio.

No lo commiteo yo para no meter trabajo ajeno a medias bajo mi mensaje — es lo
que pasó el 2026-08-26 con el editor de correos. **Pero ojo: `desplegar.cjs` se
niega a desplegar con cambios sin commitear**, así que alguien tiene que
commitearlo antes del próximo despliegue del frontend. Lo mío ahí son cinco
hunks aditivos (`ultimoConsumo`, `deshacerConsumoClub` y su botón); no chocan
con lo del monto.

### Pendiente

- **Correr la migración**: `railway run node scripts/apply-club-migration.cjs`.
  Aditiva e idempotente. Ahora incluye `Tenant.clubEnabled` y ya no crea la
  columna `saldo`, que era un residuo del diseño viejo.
- Encender `clubEnabled` al negocio que lo estrene.
- Probar en móvil de verdad: el pase en iPhone y en Android.

### De paso, dos cosas que NO son del club

- **`brand-message-templates.spec.ts` está en rojo desde `ebf6551c`** (el ciclo
  de prueba de 7 días de Sellea): `trial_started` no tiene gemelo por correo. O
  sea, ese aviso le llega al negocio por SMS pero no por correo.
- **El backend ya no compila con el heap por defecto de Node en esta máquina.**
  `npx tsc --noEmit` muere con `heap out of memory` si hay otro proceso pesado a
  la vez. Con `NODE_OPTIONS="--max-old-space-size=4096"` pasa sin problema.

## 2026-09-02 — Alianzas: probado de punta a punta en local (y el portal no cargaba)

Antes de tocar producción monté el recorrido entero en local —Docker, Postgres,
la API con SWC— y lo pasé como lo hará un empleado real. **44 comprobaciones,
todas en verde**, pero el camino hasta ahí destapó un fallo que ningún test de
servicio podía ver.

### El portal del aliado respondía 404 SIEMPRE

`GET /public/alianzas/portal/:token` lo capturaba
`@Get(':tenantSlug/:convenioSlug')`, que se declara antes en el mismo
controlador y también son dos segmentos: Nest resolvía `portal` como el slug del
negocio y el token como el del convenio. El PATCH y el POST del portal sí
funcionaban —no compiten con nada—, así que el fallo era justo el de entrar.

Reordenar los métodos lo arreglaba, pero dejaba la trampa puesta: un negocio
llamado «Portal» volvería a romperlo. Ahora el portal tiene **prefijo propio**
(`public/aliado/:token`), que además casa con la ruta del frontend.

Es exactamente el mismo error que ya había evitado en el frontend y que se me
coló en la API.

### Las migraciones, probadas de verdad

Contra una base local a la que le borré las 6 tablas, los 5 enums y las 3
columnas —el peor caso: una producción que nunca corrió convenios—:

- Las dos, en orden, levantan todo desde cero. ✅
- Correrlas **dos veces** no hace nada la segunda. ✅
- La segunda **sola** falla en seco (`relation "ConvenioTarjeta" does not
  exist`, exit 1) sin aplicar nada a medias. ✅
- `apply-convenios-migration.cjs` **sí crea `Tenant.conveniosEnabled`** con
  `IF NOT EXISTS`. Era lo que más me preocupaba: sin esa columna, el backend
  nuevo rompería `/tenants/me`, que es de donde cuelga el panel de TODOS los
  negocios.

### El script queda en el repo

`backend/scripts/probar-alianzas-e2e.cjs`. Los 164 tests unitarios corren contra
un doble de Prisma: prueban la lógica, no el cableado. Este prueba el cableado.

## 2026-09-02 (madrugada, 4ª vuelta) — Alianzas: la lista blanca era adivinable

Otra ronda de agentes. **Nada de esto toca `backend/src/club/**`,
`stamps.service.ts` ni `frontend/src/app/app/club/**`** — Javier trabaja ahí en
paralelo.

### El grave: pegar la cabecera del Excel abría el convenio

`cargarLista` no validaba la FORMA de cada entrada, solo normalizaba. Quien
pegaba el rango de Excel con su cabecera («Documento», «Correo», «Nombre»)
metía esas palabras como documentos válidos de la lista blanca. A partir de
ahí, cualquiera escribía `documento` en el formulario público y se llevaba el
beneficio del aliado sin trabajar allí. **Una lista blanca cuya credencial se
adivina no es una lista blanca.**

Del mismo sitio: el TABULADOR no era separador, así que pegar dos columnas de
Excel («Ana Pérez⇥1020304050») producía una sola fila `ANAPÉREZ1020304050` que
no casaría jamás — el panel decía «120 en la lista» y a las 120 personas les
salía «no encontramos tu documento».

### El oráculo que decía estar cerrado y no lo estaba

Los dos choques de identidad respondían distinto: 403 «los datos no coinciden»
para un teléfono con tarjeta, 400 «ese documento ya existe» para lo otro.
Probar teléfonos ajenos contra el enlace público decía cuáles tienen tarjeta —
o sea, la plantilla de la empresa aliada. Ahora es **la misma excepción y el
mismo texto**, y hay un test que compara mensaje y código de estado en vez de
comprobar una cadena.

### La vigencia moría cinco horas antes

`parsearVigencia` estiraba la fecha al final del día con `setHours`, que usa la
hora **del proceso** — UTC en Railway. «Hasta el 31 de diciembre» se apagaba a
las 18:59 de Bogotá, en plena noche de servicio. Ahora se calcula en la zona
del negocio (`finDelDia` en `periodos.ts`).

### Y una tanda de arreglos menores

Dar de baja a alguien no le quitaba su fila de la lista cargada **por correo**,
así que volvía a entrar dando ese correo · dos filas de la misma persona
contaban como dos cupos · con una fila gastada y otra libre se rechazaba a
quien sí tenía cupo · `verLista` no comprobaba el módulo y ordenaba los ya
activados primero · el total del tiquete escrito «12.500» llegaba como 12,5 y
el cajero veía un error de validación **en inglés** · el monto era un solo
estado compartido por todos los beneficios · el error del canje se pintaba
cientos de líneas más arriba, fuera de la pantalla del móvil · el empleado y el
aliado leían los textos escritos para el cajero («Entregar gratis: Bebida»).

### Estado

164 tests en verde, `tsc` en 0 en backend y frontend, lint limpio.

### Lo que sigue mal y no bloquea (no prometérselo a un cliente)

**El filtro por sede no se aplica nunca.** `AuthUser` no lleva `locationId` y en
`scanner.service.ts` va con un `as any`, que es lo que impide que TypeScript
avise. Una alianza limitada a una sede vale en todas, y `ConvenioCanje.locationId`
se guarda siempre null, así que el informe por sede sale vacío.

**Un empleado puede quedar bloqueado por otro.** Si alguien activa con el
teléfono de un compañero antes que él (en modo CÓDIGO el código lo sabe toda la
empresa), al compañero le sale el mensaje de datos que no coinciden y no puede
activar por autoservicio. El negocio lo resuelve desde el panel. Arreglarlo de
raíz pide verificar el teléfono, y no hay transporte de SMS por marca.

## 2026-09-02 (madrugada, 3ª vuelta) — Alianzas: lo que encontró la auditoría

Tres agentes revisaron el módulo. Lo que salió, y ya está corregido:

### El grave: se podía robar la tarjeta de un compañero

`alianzas-publico.service.ts` resolvía la identidad **solo por teléfono**, y el
atajo de idempotencia devolvía el `passId` **antes** de llamar a `verificar()`.
Con el teléfono de un compañero y sin saber el código, cualquiera recibía su
`passId` — y `GET /passes/:id/apple.pkpass` es `@Public()`, así que ese id es la
credencial completa. Se instalaba el pase ajeno y se canjeaba con su código de
barras.

Ahora la tarjeta previa solo se devuelve si el **documento coincide**, y el
mensaje de fallo es el mismo que el de «documento ya usado» para no convertir el
endpoint en un oráculo de qué teléfonos tienen tarjeta.

De paso: el `Customer` se creaba ANTES de verificar, así que un código
equivocado ya dejaba datos personales escritos en el CRM de un negocio ajeno
desde un endpoint sin sesión. Ahora se verifica primero y se escribe después.

### Dos huecos que hacían el módulo decorativo

1. **No había botón de canje en el escáner.** El cajero veía qué aplicar y no
   podía registrarlo: `canjesCount` no subía nunca, los topes («1 al día») no
   mordían jamás, el informe del aliado decía 0 usos para siempre y el candado
   `pg_advisory_xact_lock` era código muerto. Ya está, con su anulación.
2. **El modo LISTA era un callejón sin salida.** No existía ninguna ruta que
   escribiera en `ConvenioListaBlanca`, así que elegir «solo quien esté en la
   lista» hacía que a TODOS los empleados les saliera «no encontramos tu
   documento en la lista de tu empresa» — un fallo del producto redactado como
   culpa del usuario. Ahora se pega la lista desde el panel.

### Y dos más

- **«Añadir a Google Wallet» enseñaba JSON crudo**: el enlace apuntaba directo a
  `/passes/:id/google`, que devuelve `{saveUrl}`, no un redirect.
- **La vigencia no se podía tocar desde el panel.** El backend le dedicaba tres
  comentarios largos y no había ni un campo: un convenio vencido solo se podía
  finalizar (irreversible) y crear otro.

### Sigue pendiente (no bloquea instalar la tarjeta)

`AuthUser` no lleva `locationId`, así que el filtro por sede del convenio **nunca
se aplica**: una alianza limitada a una sede vale en todas. No prometérselo a un
negocio con varias sedes hasta arreglarlo. Y `canjear` toma la sede del body, no
de la sesión.

## 2026-09-02 (madrugada) — Alianzas: entrada por el asistente y vigencia ilimitada

Segunda vuelta sobre lo de abajo. **Nada de esto toca `backend/src/club/**` ni
`customers.service.ts`** — Javier está trabajando en la Tarjeta de Club en
paralelo.

- **Se entra por Tarjetas → Nueva tarjeta → «Alianza con una empresa»**, que es
  como lo pidió Javier. La tarjeta del paso 2 **no es un `CardType`**: es un
  enlace que lleva a `/app/alianzas?nueva=1`. Así se respeta el aviso de la
  línea 23 del asistente (meter tipos ahí ya generó inconsistencias) y no se
  duplica el alta, que ya existía y funcionaba.
- **Vigencia ILIMITADA**, que era la petición concreta. No hace falta columna:
  `endsAt = null` ya significaba eso en los siete lectores. Lo que faltaba era
  *decirlo* — hasta ahora la opción existía y nadie sabía que estaba ahí, así
  que el dueño se inventaba una fecha lejana. Es el valor por defecto.
- La fecha se guarda al **final** del día elegido. Guardarla a las 00:00 apaga
  el convenio un día antes de lo que el dueño cree, y eso se descubre con un
  cliente delante.
- **Interruptor de `conveniosEnabled` en el panel de admin.** Era el bloqueante
  nº1 para probar: la columna solo se LEÍA, no había ni un panel que la
  escribiera, así que el módulo únicamente se podía encender por SQL directo
  contra producción.
- El alta crea la alianza **y su primer beneficio en una sola transacción**: una
  alianza sin beneficios está viva pero es inerte (su enlace responde «aún no
  está disponible»). En la lista, esas salen marcadas «Sin beneficios aún».
- Cambiar `endsAt` ahora **empuja el pase** si cambia lo que el empleado ve.
  Antes solo se empujaba al pausar o finalizar: revivir un convenio vencido
  dejaba las tarjetas diciendo «finalizado» hasta que otro cambio cualquiera
  empujara.

### Un fallo mío que encontró la revisión

`plantilla()` en `alianzas-publico.service.ts` consultaba `tenant.primaryColor`
y **nunca lo escribía**: la `Card` nacía con el default del esquema —el verde de
Clubify— así que la tarjeta de una marca blanca se habría pintado con el color
de la plataforma. Y esa `Card` se crea **una sola vez y se queda**: el primer
empleado que activara la habría fijado así para siempre.

### Estado

98 tests en verde (38 nuevos que ejercitan los servicios REALES contra un doble
de Prisma en memoria). `tsc` en 0 tanto en backend como en frontend. Sigue sin
desplegar y sigue faltando correr `scripts/apply-alianzas-migration.cjs`.

## 2026-09-02 — Alianzas: la tarjeta de convenio, de punta a punta (SIN DESPLEGAR)

Un negocio pacta con una **empresa** y los empleados de esa empresa reciben un
beneficio permanente en el local (10%, bebida gratis con el almuerzo, 2x1).
**Es un estilo de tarjeta propio**, como el club o los sellos — no un tipo más
dentro del asistente de tarjetas, y nada que ver con la cuponera.

### Lo que había: una casa sin puerta

El módulo de convenios estaba construido desde hace tiempo y **no se podía usar
en absoluto**. `ConvenioTarjeta` no se creaba en ningún sitio del repo,
`Card.convenioId` no se escribía nunca, `Convenio.codigo` se guardaba y se
editaba pero **no se leía jamás**, y `ConvenioListaBlanca` tenía cero
referencias. El enlace único que el negocio le iba a dar a la empresa no
llevaba a ninguna parte.

### El doble interruptor — dos banderas, no una

Javier quería que **las dos partes** pudieran encender y apagar. Está resuelto
con dos columnas independientes: `ConvenioCupon.isActive` es del negocio y
`activoAliado` de la empresa aliada; el canje exige las dos. Así **ninguno
puede encender lo que apagó el otro por construcción**, sin reglas que validar
y sin carreras — cada bandera tiene un único escritor. La lista blanca de
campos de `actualizarCupon` no incluye `activoAliado`, y esa omisión es la que
lo sostiene: no la quites.

### Lo nuevo

- `alianzas-estado.ts` — motor de reglas **puro**, con 29 tests que importan el
  módulo REAL. (Los 31 tests viejos de convenios reimplementaban la lógica
  dentro del propio fichero de test: verdes sin proteger nada.)
- `alianzas-publico.service.ts` — el enlace del empleado. Verifica de verdad
  los tres modos (ABIERTO / CODIGO / LISTA), crea `Customer` + `Card` +
  `Pass` + `ConvenioTarjeta`, y es idempotente.
- `alianzas-portal.service.ts` — portal del aliado por token: su interruptor,
  informe **solo agregado** (ni un nombre ni un teléfono de sus empleados) y
  **baja a ciegas por documento** para quien deja la empresa.
- Frontend: `/app/alianzas` (+ detalle), `/alianza/<negocio>/<empresa>` para el
  empleado y `/aliado/<token>` para la empresa.
- El pase ya no dice «SELLOS 0 / 1»: dice BENEFICIO · ACTIVO / EN PAUSA, en
  Apple y en Google, y los cuatro idiomas.

### Seis defectos corregidos de paso

| Qué | Por qué importaba |
|---|---|
| Anular era leer-decidir-escribir | Doble clic del cajero **descontaba dos veces** del tope global |
| `TENANT_STAFF` podía todo | Un cajero podía **subirse el descuento del 10% al 90%** o borrar el convenio |
| `assertHabilitado` solo al crear | Apagar el módulo desde admin **no impedía editar ni canjear** |
| Auto-apagado al llegar a `maxTotal` | El cajero leía «apagado por el negocio» (falso) y **subir el tope no lo reabría**. Ahora «Agotado» se calcula |
| Código vacío en modo CODIGO | Dejaba la puerta abierta de par en par sin que nadie lo notara |
| FINISHED se podía deshacer | Mezclaba dos épocas del convenio en el mismo historial y rompía el informe del aliado |

Además, los resolutores de «primera tarjeta de sellos» filtraban `clubPlanId:
null` pero **no** `convenioId`: una tarjeta de alianza se colaba como la
tarjeta de fidelización del negocio. Añadido `convenioId: null` en los 8 sitios
(+ el blindaje de `cleanupOrphanStampsPass`), y `merge` de clientes ya mueve
las `ConvenioTarjeta` — antes fusionar dos clientes **borraba la tarjeta del
empleado y todo su historial**.

### Pendiente antes de desplegar

1. **Correr la migración**: `railway run node scripts/apply-alianzas-migration.cjs`
   (2 columnas + el índice único **parcial** `(convenioId, documento)`, que
   Prisma no sabe expresar). Es aditiva e idempotente, y aborta avisando si
   encuentra documentos repetidos.
2. Encender `conveniosEnabled` al negocio que lo vaya a usar.
3. **No lo he desplegado**: el árbol no compila por el club a medias (ver la
   entrada de abajo, `ClubMembresia.saldo`). Nada de alianzas está en rojo —
   los 52 errores son de `src/club/*.spec.ts` y del bloque de club en
   `customers.service.ts` —, pero prefiero no desplegar encima de eso.

## 2026-09-02 — Tarjeta de Club sobre `Pass.stampsCount` (DESPLEGADO, con tests en rojo)

**El cliente le paga una suscripción AL NEGOCIO** y recibe N beneficios al mes
que va gastando. Al revés que los sellos: arranca lleno y baja. El cupo se
**reinicia** cada mes — consumir 3 de 10 deja 10, no 17.

### El error que costó una reescritura

Javier lo dijo en su primer mensaje: «la tiene el cliente con **10 sellos** y
cada vez que va se le **resta el sello**». Monté el saldo en una tabla aparte
(`ClubMembresia.saldo`) y de ahí salieron todos los problemas: sin push, sin
pintado en el pase, sin geolocalización. **La infraestructura ya funcionaba
para cualquier pase; yo escondí el saldo donde el pase no mira.**

Ahora vive en `Pass.stampsCount`, el mismo contador de siempre, y hereda todo
gratis. Lo que sigue separado es el SIGNIFICADO: `ClubConsumo` es su propia
tabla, así que consumir nunca se confunde con `STAMP_REMOVE` (deshacer un error
del cajero). Se comparte el número, no el significado.

### Cinco defectos que encontró el agente de pruebas

| Qué | Por qué importaba |
|---|---|
| El candado del estado se perdió | Una membresía pausada a medio escaneo se llevaba igual el beneficio |
| Ventana de 1 h en el cambio de mes | A las 00:30 del día 1 el cliente gastaba el sobrante: **17 cafés con plan de 10** |
| `consumo.periodo` salía de la membresía | Un café del 1 de octubre quedaba contado en septiembre |
| La anulación leía una foto vieja | Si el cron reiniciaba en medio, devolvía cupo del mes nuevo |
| Un CANCELADO no podía volver nunca | El índice único se lo impedía para siempre |

El cron horario pasa a ser red de seguridad: el reinicio ocurre **en el momento
del consumo** si el mes cambió.

### Proteger la tarjeta — 15 filtros `clubPlanId: null`

Al usar `type: STAMPS`, **siete** resolutores de «la primera tarjeta de sellos
del negocio» se la llevarían por delante. El peor: `cleanupOrphanStampsPass`
podía **BORRAR el pase del socio** (se dispara con 0 sellos y 0 devices, justo
el estado de un pase recién instalado). El séptimo (`onboarding-sync`) lo
encontró el agente, no estaba en mi lista.

**Fusionar clientes** ya no borra la membresía ni su historial.

### El escáner ahora dice qué encontró

Las cuatro ramas devuelven `kind`: `sellos | cupon | club | convenio |
cuponera`. Antes solo la cuponera se identificaba y el frontend hacía
`data.pass.customer.fullName` a ciegas. **Esto ya estaba roto para convenios**
sin que nadie lo notara, porque nadie los usa todavía.

### ⚠️ 26 TESTS EN ROJO

`tsc` 0 errores en ambos lados. Tests: **105 pasan, 26 fallan**. Los rojos son
specs que un agente dejó a medio migrar —comprueban `saldo` en la fila de la
membresía, campo que ya no existe—. **No indican código roto: indican una
migración de tests sin terminar.** Hay que acabarla.

Los tres agentes murieron por límite de sesión a mitad del trabajo.

### Sigue faltando

**Todo el frontend del club.** No se puede crear un plan desde el panel; el
módulo solo responde por API. Y falta decidir con Javier **dónde vive** en el
panel: sección propia (mi apuesta) o una tercera opción en el asistente de
tarjetas.

## 2026-08-31 — Las 6 mejoras pedidas por clientes (DESPLEGADAS)

Un commit por tarea, en el orden del documento. **Ninguna necesitó migración**:
`InfoLink.theme` y `InfoLink.buttons` ya son columnas JSON.

**T3 · Tipografías** (`bb1d1ae6`) — El reporte decía «la mayoría de fuentes del
generador de QR no funcionan». Era peor: **no cargaba ninguna, y no solo en el
QR**. Había un único `<link>` con las 129 familias y **el CDN de Google corta
en 120 por petición** → 403. Medido contra el CDN y contra producción: 120 da
200, 121 da 403. Es el número de familias, no el largo de la URL (121 mide
3.196 car. y falla; otra de 3.781 con 120 funciona). Cada familia por separado
responde 200 — no hay ningún nombre inválido.

Como el `<link>` es global, también estaban rotas las tipografías del
**infolink**, la **vista previa del wallet** y las cotizaciones. Ahora van de
60 en 60 (3 peticiones, las 3 verificadas en 200 en el sitio vivo). Además el
editor espera a `document.fonts.ready` antes de exportar y redibuja el canvas
al cargar las fuentes — Konva pinta con la fuente que haya en ese instante.

**T6 · Post-registro** (`5ae3201f`) — La ruta recibía `?welcome=1` desde el
registro pero **nunca lo leía**. Ahora, recién registrado: aviso «AÚN NO HA
TERMINADO TU REGISTRO» con el color del negocio, flecha, botones de Wallet, y
la tarjeta en pequeño debajo. Quien vuelve a abrir su tarjeta ve la pantalla de
siempre. Badges oficiales en español; en en/pt/it, botón traducido.

**T4 · Fondo del Shop** (`37eb5a7b`) — `bg-white` fijo en el `<article>` tapaba
el fondo elegido. **Stories tenía el mismo defecto**. Sin fondo configurado
siguen blancos: los publicados no cambian.

**T1+T2 · Redes sociales** (`caca44ba`) — Los «iconos genéricos» eran **emojis**
(📷 💬 📍) y **solo existían en Minimal**, alimentados por los campos del
NEGOCIO, no del infolink. Por eso `iconosSociales()` cae a esos campos cuando
el infolink no configuró ninguna red: si no, todos esos infolinks se quedaban
sin iconos. Ahora logos de marca reales (una ruta, `currentColor`), color
editable con vista previa sobre fondo claro y oscuro, en los 5 estilos.

**T5 · Botón de llamada** (`2cf720e9`) — Tipo `PHONE` → `tel:+<dígitos>`. Se
exige indicativo de país: el infolink lo abre gente de otra ciudad. No abre en
pestaña nueva (dejaría una en blanco tras el marcador).

⚠️ **Nada de esto se probó en navegador** — tsc y eslint limpios, y la T3
verificada contra el CDN real. Falta comprobar en móvil la T6 (iPhone SE) y la
T5 (iOS/Android).

## 2026-08-31 — Historial de pagos por negocio + menú libro multi-imagen (DESPLEGADO)

**Historial de pagos** (`70da1bf8`). En la ficha del negocio se veía el estado
(«Pagada, próximo cobro el 24/08») pero no cómo se llegó ahí. Ahora la tarjeta
de Facturación lleva debajo el historial unificado de las cuatro vías de pago:
Hotmart, Stripe, cobro por fuera y crédito.

No hizo falta tabla nueva: los webhooks ya se guardaban enteros
(`HotmartWebhookEvent`, `StripeWebhookEvent`) junto a `ManualPayment` y
`CreditTransaction`. Faltaba leerlos. `backend/src/tenants/payment-history.util.ts`.

Lo que **no es obvio** y está cubierto con 18 tests:

- Hotmart manda **varios eventos por el mismo cobro** (`PURCHASE_APPROVED` y,
  ~8 días después al vencer la garantía, `PURCHASE_COMPLETE`). Sin agrupar por
  `purchase.transaction` se duplicarían los ingresos de todos los negocios.
- Gana el estado **más definitivo**, no el más reciente: rechazado→aprobado
  está pagado; pagado→contracargo, no.
- El importe es `full_price` (lo que se cobró), no `price` (ya lleva
  descontada la comisión de Hotmart). Moneda en `currency_value`.
- El aviso rojo solo cuenta rechazos **posteriores al último pago bueno**:
  varios negocios reintentan 2-3 veces cada mes antes de que entre, y contarlos
  haría sonar la alarma en negocios al día.

Los eventos de Stripe no traen `tenantId` (el webhook resuelve la marca, no el
negocio): se enlazan por `stripeCustomerId`.

**Hallazgo que sale solo del historial:** Wok Explosivo tiene el cobro #4
rechazado desde el 26-08 por «Saldo insuficiente.» — es por lo que no puede
entrar al panel, que llevaba días sin explicación. Konys igual desde el 30-08.

**Menú libro: subir varias imágenes** (`d2bee275`). Antes una a una. Ahora el
lote entero, con concurrencia 3. Las páginas se **confirman en serie y en
orden**: `createPage` (`catalog/menu-book.service.ts:335`) calcula `sortOrder`
leyendo la última y sumando 1, así que dos altas en paralelo se llevan el mismo
número y la carta sale barajada.

⚠️ **Sigue abierto:** esa carrera de `sortOrder` está en el backend. El cliente
la evita serializando, pero dos personas añadiendo páginas a la vez la
disparan. Arreglo real: `sortOrder` atómico en SQL.

⚠️ El menú libro **no se probó en navegador** (tsc y eslint limpios, nada más).

## 2026-08-31 — El corte del 15 ya cuadra con la transferencia (DESPLEGADO)

Javier transfirió **$303.85 por 21 comisiones** el 24 de agosto. El corte del
15-08 mostraba **17 por $205.40** primero y **$343.15** después. Eran tres
fallos distintos, todos por lo mismo: **una comisión se engancha a su corte una
sola vez y nadie vuelve a mirar si sigue perteneciendo ahí.**

| # | Fallo | Plata |
|---|---|---|
| 1 | El pago INDIVIDUAL no escribía `payoutBatchId` (`payAllForPerson` sí) | $137.75 sueltas |
| 2 | Rama sin tope para lo «habilitado a mano» → caía en el corte abierto MÁS VIEJO, no en el vigente | $25.00 de más |
| 3 | Anular una comisión no la sacaba del corte | $14.30 de más |

**Estado final en producción, verificado:**

```
CORTE-2026-08-15   21 comisiones · total $303.85 · pagado $303.85
CORTE-2026-08-31   14 comisiones · total $289.30 · pagado $0.00
```

Las 21 son exactamente las de la hoja de Javier. Barrido completo del histórico:
solo había 3 anuladas pegadas y 3 mal fechadas, todas en los dos cortes
abiertos. **Los cortes ya cerrados estaban limpios y no se tocaron.**

**Regla que quedó fijada** (`corte-pertenencia.spec.ts`, 41 tests):
el corte refleja **la transferencia**. Lo que se paga junto pertenece al corte
que se está liquidando, aunque se haya adelantado. Un corte cuya fecha ya pasó
**no acumula** — está esperando que lo cierren. Un corte **cerrado nunca se
reescribe**, ni por una anulada dentro.

Commits: `066f0e04`, `658bdc97`. Dato corregido con
`backend/scripts/corregir-pertenencia-cortes.cjs` (idempotente, aborta si algún
corte dejó de estar ABIERTO).

**Ojo Jhon:** el arreglo toca `cutoff.service.ts` y `referrals.service.ts`
(`dayWindowWhere`, `setCommissionStatus`, `payCommission`). Si tenías algo a
medias ahí, revisá antes de mergear.

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

## 2026-09-02 — ⚠️ Deploys de Javi revirtieron mi trabajo + InfoLink PRO fuera del selector Sellea

**Máquina/quién:** máquina de Jhon (Claude) · Rama `feat/commissions-auto-cutoffs` · commits `18cf6d89`, `1db6f8bb`

### ⚠️ COORDINACIÓN (importante para Javi)
El dueño no veía sus cambios de Sellea porque **Javi desplegó frontend ~9 veces y backend en
3h**, y algunos deploys salieron de un HEAD (OneDrive) SIN mis commits → **revirtieron en prod**
mis 6 fixes de Sellea (frontend) Y el income capture / productKey / SMS-sin-monto / teléfono
(backend). Prueba: el API dejó de devolver `productKey`. **Redeployé backend (2439f7dd) y
frontend desde HEAD** y quedó restaurado. **Regla: desplegar SIEMPRE con `desplegar.cjs` (se
niega si estás por detrás de origin); `railway up`/`vercel --prod` directos tumban lo del otro.**

### InfoLink PRO seguía en el selector "Elige tu plan" de Sellea
- `sellea/page.tsx` (y fideliso) arman los planes con su PROPIO fetch de payment-links (duplicado
  de `fetchBrandPlansByHost`), sin el filtro de productKey → InfoLink PRO colaba. Filtro agregado
  en sellea/fideliso/landing-plans + en `/activar` (que no tome el precio del PRO para MENSUAL).
- Aun así seguía por **caché de datos de Vercel** con la respuesta vieja SIN productKey. Fix
  robusto: **dedup por id de plan** (InfoLink PRO es MENSUAL, colisiona con "Mensual" → se quita
  sin depender de productKey). Verificado: selleala.com muestra solo Mensual+Anual, consistente.

## 2026-09-02 — Reconciliación CSV Hotmart (71 subs) → Quipao fantasma corregido + SMS sin monto

**Máquina/quién:** máquina de Jhon (Claude) · datos (no código nuevo salvo el SMS sin monto, ya en `0513c740`)

### Reconciliación (CSV autoritativo de Hotmart vs Clubify)
71 suscriptores. **66 consistentes** (4 de los 5 en Retraso correctamente en gracia/susp:
Delizzibo, VIIDA, &N Coffee, AutoTech). Hallazgos:
- **🔴 Quipao (BCSSGMIK) fantasma → CORREGIDO** (con OK del dueño): Hotmart Retraso pero
  Clubify al día (ciclo 09-sep, fallos 0) porque el cargo del 01-sep falló y la limpieza
  anti-mora-fantasma lo destrabó (ciclo en el futuro). Devuelto: lastChargeAt=01-ago,
  ciclo=01-sep, firstFailedAt=01-sep, fallos=1 → EN GRACIA día 2, suspende ~06-sep. Dispara SMS al cliente.
- **⚪ 3 clientes que PAGAN pero nunca activaron** (PendingHotmartPayment sin consumir):
  TPJNY5FO (David Moreno, dmoreno758, Trim $150, desde 17-jul), VX2HL0IX (Kimberlyn,
  kimmyramirezsh, desde 08-jul), SHX60ZIC (Joel olivares, gastrolivaresccp — tiene cuenta
  "Dinorolls" con código placeholder wl-, sin ligar). Acción del dueño: contactarlos para activar.
- YKUPT9FQ = add-on "Automatización de WhatsApp" de Humberto (SUPER_ADMIN) → normal.

### SMS interno "pago procesado" (LIVE, deployment 35236072)
Quitado el monto por pedido del dueño → `✅ Pago procesado (renovación): <marca>. (Clubify)`.
Enviado manualmente el de Hydor (HP4204708280) a los 3 números (no había salido).

### PENDIENTE (decisión del dueño)
Backfill de los 70 ingresos Hotmart faltantes en Contabilidad (~$8.772). El CSV da plan/monto
autoritativo. Opciones A (70) / B (13 con tenant) / C (ninguno). Sin correr.

## 2026-09-02 — CONTABILIDAD: pagos Hotmart en moneda local no se capturaban (fix LIVE)

**Máquina/quién:** máquina de Jhon (Claude) · Rama `feat/commissions-auto-cutoffs` · commit `9f6bbc7f`

### Bug (sistémico, pre-existente)
`resolvePaidUsd` (hotmart.service) devuelve `null` cuando el comprador paga en moneda
LOCAL (PAB/COP/MXN/PEN/CLP/GTQ) — correcto para la comisión (usa el canónico). Pero ese
null hacía que el income capture recibiera `grossUsd=null` y **saltara el IncomeRecord**.
⇒ **70 pagos Hotmart reales (jun→sep) nunca entraron a Contabilidad** (~$8.772 USD). El
monto USD sí venía en `original_offer_price`. Caso reportado: Hydor Coffee House (HP4204708280,
$53.48 PAB). El webhook procesó bien (billing avanzó, comisión generada) — solo faltó el ingreso.

### Fix (DESPLEGADO — deployment 11db979b, Online 200)
Para Contabilidad y el SMS interno `pago_procesado` se resuelve el USD con fallback:
`realPriceUsd ?? original_offer_price(USD) ?? canónico`. Comisión y `lastPaymentAmountUsd`
(auditoría) sin cambios. Pagos futuros en moneda local ya se capturan.

### PENDIENTE (decisión del dueño)
Backfill de los 70 pagos perdidos (dedup por txId, seguro — los 23 del backfill del 31-ago
usan txId real). Opciones: (A) los 70 (~$8.772, 57 sin tenant=primer pago), (B) solo los 13
con negocio resuelto (~$850), (C) ninguno. Sin correr aún.

### Nota
Test pre-existente en rojo (NO de este cambio): `integrations/brand-message-templates.spec`
"automatizaciones sin correo gemelo" (trial_started…). Área de plantillas/automatizaciones.

## 2026-09-02 — Revisión de bugs (ayer+hoy) → 1 arreglo (billing colgado)

**Máquina/quién:** máquina de Jhon (Claude) · Rama `feat/commissions-auto-cutoffs` · commit `f612d1d2`

Revisión adversarial (manual + subagente) de todo lo mío de 2026-09-01/02. Resultado:
un único bug de corrección → arreglado y desplegado (frontend READY):
- **`app/billing`**: el guard `if (!tenant) return loading` (que agregué en la tanda de
  los 6 arreglos) colgaba la página para SIEMPRE si `/tenants/me` fallaba (el `.catch`
  deja `tenant` null). Fix: flag `tenantLoaded` que se marca aunque falle → si falla,
  cae al panel full (null-safe) en vez de quedarse en "Cargando…".
- El resto (correo bienvenida, teléfono al User, filtro InfoLink PRO, logo tarjeta,
  sidebar Sellea, ranking pases/pedidos, FOUC, form) quedó verificado sin bugs.
- Heads-up (no bug): el filtro de visibilidad oculta TRIAL/SUSPENDIDOS también en el
  Ranking de PEDIDOS. Si se quiere ver ahí a un negocio de domicilios en TRIAL, avisar.

## 2026-09-02 — Sellea InfoLinks: 6 arreglos del freemium (registro, panel, precios, logo, sidebar)

**Máquina/quién:** máquina de Jhon (Claude) · Rama `feat/commissions-auto-cutoffs` · commit `37bdb9f9`

### Qué cambié (DESPLEGADO backend + frontend)
1. **signup InfoLink**: el teléfono se guardaba solo en el tenant → ahora TAMBIÉN en
   `User.phone` (la pantalla "Datos personales" lee user.phone; salía vacío).
2. **signup InfoLink**: envía **correo de bienvenida con branding de la marca**
   (`welcomeOwnerTemplate` + `brandEmail.sendRaw`, subcuenta Grow Business). Antes no mandaba ninguno.
3. **pricing landing**: el link `INFOLINK_PRO` ya NO aparece en el selector de planes
   (filtro por `productKey` en `fetchBrandPlansByHost`; el endpoint ahora expone productKey).
4. **panel suscripción** (`app/billing`): para negocios INFOLINK muestra un panel propio
   (Gratis · sin vencimiento / PRO $14.99), no la suscripción completa de $80.
5. **tarjeta de captación** pública (`/i/<slug>/<link>`): usa el logo REAL de la marca, no el monograma "S".
6. **sidebar admin**: sección **"InfoLink" exclusiva de Sellea** (flag `selleaOnly` en AppShell)
   bajo "Negocios" → `/admin/infolinks` (ya listaba Gratis/PRO por plan, sin vencimiento).

### Qué toqué de PRODUCCIÓN
- **Railway backend**: deployment `38938880` swapped (Online, 200).
- **Vercel frontend**: READY (selleala.com + /infolink 200).

### Aviso a Javi
- Mi deploy salió del HEAD que incluía tu **`761efdc9` (ocultar compras en iOS, guideline 3.1.1)**.
  Si no estaba desplegado, quedó vivo con esta tanda. Web sin cambios (solo afecta la app nativa).

## 2026-09-01 — Ranking de pedidos (menús de domicilios) + deploy que subió el /hub de Javi

**Máquina/quién:** máquina de Jhon (Claude) · Rama `feat/commissions-auto-cutoffs` · commit `ad220937`

### Qué cambié (DESPLEGADO backend + frontend)
- **Ranking de pedidos**: el modal de ranking (`/admin/tenants`) ahora tiene toggle superior
  **"Ranking de pases | Ranking de pedidos"**. Pedidos = `Order` de los menús de domicilios,
  misma lógica de período/antigüedad/visibilidad (oculta TRIAL/SUSPENDIDOS salvo Nudo Cowork).
- `/tenants/ranking` acepta `metric=pases|pedidos`; en `pedidos` cuenta `Order` (createdAt)
  en vez de `Pass` (issuedAt). Backend compatible (default `pases`).

### Qué toqué de PRODUCCIÓN
- **Railway backend**: `desplegar.cjs backend`, deployment `e2c9ff13` swapped (Online, 200).
- **Vercel frontend**: `desplegar.cjs frontend`, READY.

### ⚠️ Aviso a Javi (IMPORTANTE)
- Con OneDrive, mi HEAD incluía tu **`7f0e7a41` (launcher `/hub` + Capacitor)**, que estaba
  committeado pero **NO desplegado** (prod daba 404). Con OK explícito del dueño, mi deploy de
  frontend lo **subió a producción**: `/hub` ahora responde **200**. Si esa fase 1 no estaba
  lista para estar viva, avísame — quedó live junto con mi ranking, tu cuponera y el botón PRO.

## 2026-09-03 (noche) — La causa de días de bugs fantasma: caché + detección tardía

**Máquina/quién:** la de Jhon (sesión Claude)

### ⚠️ DOS TRAMPAS QUE COSTARON DÍAS

**1. El service worker servía código de agosto.**
`VERSION` llevaba congelada en `v55-2026-08-14` mientras hacíamos más de
quince despliegues. Cada uno llegaba a producción (verificado con `curl`) pero
**no llegaba al teléfono**. Estuvimos persiguiendo bugs de layout y de push
que ya estaban corregidos.

Arreglado de raíz: **dentro de la app NO se registra service worker**, y el
que hubiera se desregistra y purga sus caches (`PWARegister`). El SW sigue
para la PWA del navegador, donde sí sirve (escáner sin señal en el mostrador).

Para limpiar un teléfono que ya tenía el SW viejo hay que **desinstalar la
app**, no basta reinstalarla encima: los datos sobreviven.
`xcrun devicectl device uninstall app --device <id> com.soyclubify.app`

**2. `data-native` se resolvía en el cliente y llegaba tarde.**
La detección corría en un `useEffect`, así que el primer render ya pintaba lo
que debía estar oculto. Síntomas que parecían no tener relación y eran esto:
- El botón de Google seguía visible pese a estar quitado, y arrancaba su
  script, que quedaba en «Cargando Google…» (Google bloquea webviews).
- Las márgenes seguras se aplicaban **unas veces sí y otras no con el mismo
  build** — lo interpretamos como carrera del puente de Capacitor.

Arreglado: Capacitor marca el User-Agent con `ClubifyApp`, y eso viaja en la
PETICIÓN. `data-native` se resuelve ahora en el **layout del servidor** y
llega en el primer HTML. Lo que se oculta en la app se oculta por **CSS**
(`.solo-web`), no por JavaScript: lo que no depende de que se ejecute nada, no
puede llegar tarde.

Verificado desde fuera:
`curl /login -H "User-Agent: … ClubifyApp/1.0.0 (ios)"` → `data-native="ios"`;
con UA de Safari normal, no aparece.

### Qué toqué de PRODUCCIÓN
- Frontend desplegado varias veces (SW, detección en servidor, quitar Google).
- Backend desplegado: acepta dos audiencias de Google (`GOOGLE_CLIENT_ID_IOS`).
- **Contraseña fijada** a `clubifydemo@gmail.com` (cuenta para el revisor de
  Apple) y **clientes de DEMO CLUBIFY anonimizados** — eran una mezcla de
  datos de prueba y personas reales con sus teléfonos y correos.

### Decisiones de producto
- **Fuera el login con Google DENTRO de la app.** Google bloquea su OAuth en
  webviews, así que la única vía era saltar al navegador del sistema y volver.
  Jhon decidió que ese salto no compensa. En el navegador se queda.
  La implementación nativa (PKCE, sin SDK) funcionaba y está en el historial:
  se descartaron los dos plugins de Capacitor porque uno choca con MLKit
  (GTMSessionFetcher) y el otro arrastra el SDK de Facebook.

### Qué falta
- [ ] Capturas para la ficha, **con la cuenta demo** (las de Jhon mostraban
      datos reales de Nudo Cowork).
- [ ] Textos de la ficha y envío a TestFlight.
- [ ] Más disparadores de push (reserva, sello, corte). Patrón en
      `orders.service.ts`.
- [ ] Android: falta Android Studio + JDK y Firebase.

## 2026-09-03 (tarde) — PUSH FUNCIONANDO de punta a punta + trampa del AppDelegate

**Máquina/quién:** la de Jhon (sesión Claude)

### ⚠️ La trampa que costó medio día — LEER SI SE REGENERA EL PROYECTO iOS

`register()` se llamaba, iOS obtenía el token del aparato… y se perdía. Sin
error, sin callback, sin nada en los logs (los de `apsd` vienen redactados por
Apple como `<private>`).

**Faltaban los dos reenvíos de APNs en `AppDelegate.swift`**, que la plantilla
de Capacitor NO trae:

```swift
func application(_:didRegisterForRemoteNotificationsWithDeviceToken:)
func application(_:didFailToRegisterForRemoteNotificationsWithError:)
```

El plugin escucha por `NotificationCenter` y nadie publicaba ahí. Todo lo
demás —permiso, entitlement, clave APNs, endpoint, tabla— estaba bien desde el
principio. **Si alguien borra y regenera `mobile/ios`, esto se pierde y las
push vuelven a fallar en silencio.**

### Qué toqué de PRODUCCIÓN
- **Migración aplicada**: tabla `DeviceToken` (aditiva, idempotente).
- **Backend desplegado** dos veces: endpoints `/devices` y disparador de
  pedido nuevo. Verificado el swap las dos veces (404 → 401).
- **Frontend desplegado** varias veces. El último quita el diagnóstico.
- **Variables nuevas en Railway**: `APP_PUSH_KEY_ID`, `APP_PUSH_TEAM_ID`,
  `APP_PUSH_BUNDLE_ID`, `APP_PUSH_KEY_BASE64`.
  **NO se tocaron las `APNS_*`**, que son las del pase de Apple Wallet: reusar
  esos nombres habría dejado sin actualizar los pases de todos los negocios.

### Verificado de punta a punta
Token guardado en producción (`jhon@clubify.com · ios`) y notificación
entregada al iPhone. El envío intenta **production y luego sandbox**: un build
instalado por cable lleva entitlement de desarrollo y production lo rechaza
con `BadDeviceToken`. Sin ese reintento parecería roto.

### Otras dos causas reales encontradas
- **El service worker seguía en `v55` de agosto** tras una decena de
  despliegues: la app podía correr código viejo. Explica que las márgenes
  seguras se aplicaran unas veces sí y otras no **con el mismo build**. Bump a
  `v56`. **Si un cambio de front no aparece en la app, mirar esto primero.**
- **El movimiento lateral NO era desbordamiento**: seis pantallas medidas dan
  `doc == viewport`. Era el rebote elástico del WebView. Cortado con
  `overscroll-behavior-x: none`, solo en la app.

### Qué falta
- [ ] Más disparadores de push: reserva, sello, corte de comisiones. El patrón
      queda en `orders.service.ts` (`appPush.enviarATenant`, dispara y olvida).
- [ ] **Clave APNs de producción ya creada** (`T57Z72TY6V`). Al subir a
      TestFlight, Xcode cambia el entitlement a `production` solo.
- [ ] Google Sign-In nativo: no funciona dentro del WebView (Google bloquea
      OAuth en webviews embebidos). Hace falta el SDK nativo + client ID iOS.
- [ ] Android: falta Android Studio + JDK en esta máquina, y Firebase para FCM.
- [ ] Fichas de tienda: capturas, textos y **cuenta demo para el revisor**.
- [ ] Revisión responsive a fondo de `/app`: bloqueada por no tener una cuenta
      de negocio propia (impersonar vive en sessionStorage y se pierde al
      navegar).

### Riesgos y avisos
- La app instalada en el iPhone de Jhon quedó **sin** `?dbg=1` y sin
  diagnóstico: es la build limpia.
- Se respetó el commit `f8793e29` de la otra máquina (diagnóstico apagado en
  nativo). Para depurar se compiló una build aparte apuntada a `?dbg=1` en vez
  de revertirlo.

## 2026-09-03 — App en el iPhone REAL + push (registro) + hallazgos de medición

**Máquina/quién:** la de Jhon (sesión Claude) · commit `6c2cb505`

### Qué cambié
- **La app corre en un iPhone de verdad** (16 Pro Max), firmada con el Team ID
  `Z4R33X92SH`, con firma automática ya configurada en Debug y Release.
- **Escáner con mira PROPIA.** `scan()` abre la pantalla del sistema, con un
  recuadro cuadrado que no se puede cambiar; los pases llevan un PDF417 ANCHO
  y la gente intentaba encajar la tarjeta entera. Se pasó a `startScan()`: la
  cámara va detrás del WebView y la mira la dibujamos nosotros a 2.3:1.
- **Icono y splash** = la flecha verde de la marca (sale del branding del
  backend, no del repo: el repo solo tenía la 'C' vieja). El lanzador `/hub`
  mostraba también la 'C'; ahora lee la misma fuente que el panel.
- **Push, primera mitad:** tabla `DeviceToken` + endpoints `/devices` +
  registro del token desde la app + entitlement `aps-environment`.

### Qué toqué de PRODUCCIÓN
- **Vercel frontend**: varios despliegues (mira del escáner, logo del hub,
  márgenes seguras, buscador de negocios, diagnóstico).
- **Backend NO desplegado**: los endpoints `/devices` están en la rama, no en
  producción. **Falta correr la migración** (ver abajo).
- Sin migraciones aplicadas todavía.

### Qué falta / qué hay que validar del otro lado
- [ ] **Correr la migración de push en producción**:
      `railway run node scripts/apply-device-tokens-migration.cjs`
      y después desplegar backend. Es aditiva e idempotente.
- [ ] **Clave APNs** (App Store Connect → Keys, con APNs activado: da un .p8 +
      Key ID) y **proyecto Firebase** para Android. Sin eso el token se guarda
      pero no se envía nada.
- [ ] **QUITAR `OverflowDebug`** del frontend antes de publicar. Hoy se
      enciende al impersonar — ningún cliente lo ve, pero es código de
      diagnóstico en producción.
- [ ] Google Sign-In nativo (no funciona dentro del WebView).
- [ ] Android: falta Android Studio + JDK en esta máquina.

### Lo que aprendimos midiendo (importante)
- **El "no es responsive" no era desbordamiento.** Medido con el diagnóstico:
  `/app`, `/admin`, `/admin/tenants`, `/admin/commissions`, `/admin/creditos` y
  `/admin/contabilidad` dan `doc == viewport == 402px`. Lo que se veía cortado
  era la vista **ampliada y desplazada** por un pellizco: una página que
  desborda se corta por la derecha, y las capturas mostraban el ☰ cortado por
  la IZQUIERDA. Queda `zoomEnabled:false` explícito en el WebView.
- **Pero la primera medición era mala**: medía UNA vez a 1.8s y el panel carga
  por fetch. Ahora vigila 20s y se queda con el peor caso. Con la versión
  buena solo se alcanzó a medir `/admin`. **El panel del negocio sigue sin
  medir de verdad** — Jhon reportó un deslizamiento lateral pequeño que no se
  ha podido reproducir bajo medición.
- **Impersonar no sirve para automatizar**: vive en `sessionStorage`, así que
  se pierde en cada recarga o navegación. Para revisar `/app` a fondo hace
  falta **una cuenta de negocio propia** (sesión en `localStorage`).

### Riesgos y avisos
- El escáner nativo deja la página TRANSPARENTE mientras escanea
  (`body.escaner-nativo-activo`). La limpieza está en tres sitios: lectura,
  cancelar y desmontaje. Si se toca `/scan`, no romper eso o el usuario queda
  con el panel invisible y la cámara encendida.
- En un Mac Apple Silicon la app NO compila para simulador con el escáner:
  GoogleMLKit 5.0.0 excluye arm64 de simulador. Se prueba en teléfono.

## 2026-09-02 — La app iOS ya CORRE. Hallazgos de la primera ejecución

**Máquina/quién:** la de Jhon (sesión Claude) · commit `54b1ce55`

Primera vez que la app arranca en el simulador y carga el panel de producción.
Lo que salió al probarla:

### 1. Login con Google NO funciona dentro de la app (pendiente real)
Se queda en «Cargando Google…» para siempre. Google bloquea su OAuth en
webviews embebidos, así que el botón GSI de la web no sirve dentro de
Capacitor. **El login por correo y contraseña sí funciona**, así que la app es
usable, pero para arreglarlo hay que meter el SDK nativo de Google
(plugin de Capacitor + client ID de iOS) y cablearlo al mismo
`/auth/google` del backend. No lo toqué todavía.

### 2. El splash se quedaba pegado (arreglado)
`launchAutoHide:false` y nadie llamando a `hide()`. Ahora lo oculta la web
cuando termina de pintar (`NativeSplashGate`), con tope de 3s.

### 3. iOS 26 no instalaba la app (arreglado)
Deployment target 13.0 → 15.5.

### 4. El escáner no se puede probar en simulador (no es un bug)
`@capacitor-mlkit/barcode-scanning` 6.2 fija GoogleMLKit 5.0.0, que declara
`EXCLUDED_ARCHS[sdk=iphonesimulator*] = arm64`: en un Mac Apple Silicon solo
compila x86_64 para simulador y iOS 26 lo rechaza. **No afecta a iPhones
reales ni a la App Store.** Y de todos modos un simulador no tiene cámara: el
escáner se prueba en un teléfono.

### 5. Los gates de compra funcionan
En la app ya NO aparece «¿No tienes cuenta? Adquiérelo aquí» del login.
Verificado en pantalla.

### Qué falta
- [ ] Probar en un iPhone real (hace falta el Team ID de Apple para firmar).
- [ ] Google Sign-In nativo.
- [ ] Push APNs/FCM, biometría, enlaces universales.
- [ ] Icono y splash de Clubify (hoy sale el de Capacitor).

## 2026-09-02 — ⚠️ JAVI: tus deploys están BORRANDO `/hub` de producción (van 3)

**Máquina/quién:** la de Jhon (sesión Claude) · Rama `feat/commissions-auto-cutoffs`

### El problema, con los tiempos

```
09-01 21:51  commit 7f0e7a41 — se crea /hub
09-01 ~22:00  deploy tuyo    → /hub queda en 200  ✅
09-01 ~23:14  deploy tuyo
09-02 ~02:14  deploy tuyo    → /hub en 404  ❌
09-02  hoy    deploy mío     → /hub en 200  ✅  (verificado)
09-02  +15m   deploy tuyo    → /hub en 404  ❌  otra vez
```

Cada despliegue tuyo deja la ruta en 404. Eso significa que **el commit que
estás desplegando no tiene `/hub`**: o la copia va por detrás de origin, o
sale de otra rama.

`desplegar.cjs` bloquea si estás por detrás **de tu propia rama**. Si
despliegas desde otra rama que nunca recibió estos commits, el script pasa
tranquilo y aun así borra las rutas que no existen ahí.

### Qué necesito de ti

Antes de cada `desplegar.cjs frontend`:

```bash
git fetch origin && git log --oneline -1 origin/feat/commissions-auto-cutoffs
git status -sb          # que no diga "behind"
```

Y confirmar que despliegas **desde `feat/commissions-auto-cutoffs`**, que es
la rama que corre en producción.

### Por qué importa más que antes

`/hub` dejó de ser una ruta suelta: **es donde arranca la app de iOS**
(`server.url` en `mobile/capacitor.config.ts`). Lo comprobé hoy en el
simulador — con `/hub` caído, la app abre en la página de 404 de Clubify en
vez del panel. Cuando esté publicada en la App Store, un deploy tuyo sin estos
commits deja la app inservible para todos los que la tengan instalada, y no se
arregla hasta el siguiente deploy correcto.

## 2026-09-02 — DESPLEGADO: `/hub` + gates de iOS. Toolchain de Xcode lista
**Máquina/quién:** la de Jhon (sesión Claude)
**Rama / PR:** feat/commissions-auto-cutoffs — commit `a3f15d74`

### Qué toqué de PRODUCCIÓN
- **Vercel frontend desplegado** con `node scripts/desplegar.cjs frontend`
  (deployment `dpl_6i4jyJ2KKSnTm5jxA9tcmZ5cMarw`, READY). Sube el lanzador
  `/hub` y los gates de compra de iOS.
- Verificado después del deploy: `/hub` **200** en los dos dominios; `/login`,
  `/scan`, `/app` y la landing siguen en 200.
- Backend sin tocar. Sin migraciones, sin variables.

### ⚠️ Aviso: `/hub` se había BORRADO de producción
La entrada del 09-01 decía que el deploy de las 22:00 dejó `/hub` en 200.
Hoy amaneció en **404**. Entre medias hubo dos deploys más de frontend (23:14 y
02:14): uno salió de una copia sin el commit `7f0e7a41` y **borró la ruta**.

Es el patrón que avisa el CLAUDE.md: el deploy sube el directorio, no git. El
`desplegar.cjs` lo evita (clona el commit), así que **usarlo siempre** — el
riesgo no es teórico, ya pasó dos veces con esto.

### Qué cambié (local, no producción)
- **Toolchain iOS lista**: Xcode 26.6, CocoaPods 1.17 vía **Homebrew**. El Ruby
  2.6 del sistema quedó descartado: las gemas actuales piden Ruby ≥ 3.1
  (`ffi` → `securerandom`), no hay combinación que funcione. Si la otra máquina
  monta iOS, que vaya directo por Homebrew y no pierda la hora que perdí yo.
- `npx cap sync` completo: los 8 plugins enlazados en iOS y Android.
  `Podfile.lock` y el workspace quedaron commiteados.

### Qué falta / qué hay que validar del otro lado
- [ ] Xcode 26 **no trae la plataforma iOS**: `xcodebuild` daba "no
      destinations" aunque `-showsdks` listara el SDK. Se arregla con
      `xcodebuild -downloadPlatform iOS` (8,52 GB) — descargando ahora.
- [ ] Compilar y correr en el simulador.
- [ ] Fase 3 nativa: escáner MLKit, push APNs/FCM, biometría, enlaces
      universales. Sin eso Apple rechaza por 4.2.

### Riesgos y avisos
- `/hub` ya es una ruta viva de producción. Si un deploy futuro vuelve a
  dejarla en 404, la app de iOS abre en la pantalla de error: su `server.url`
  apunta ahí (`mobile/capacitor.config.ts`).

## 2026-09-01 — iOS: compras ocultas (guideline 3.1.1) + la app entra por /hub
**Máquina/quién:** la de Jhon (sesión Claude)
**Rama / PR:** feat/commissions-auto-cutoffs

### Qué cambié
Cierra el pendiente de la entrada anterior. `useHidesPurchases()` ya está
aplicado: **dentro de la app de iOS no queda ningún punto de compra**. Apple
exige su compra in-app (30%) para cualquier suscripción que se venda dentro de
la app, o rechaza por 3.1.1. Eran cinco:

- **`TrialExpiredLockscreen`** — el CTA "💳 Activar ahora" al checkout de la
  pasarela. Se queda «Ya pagué — verificar acceso», que no es una compra.
- **`CardVerificationLockscreen`** — "Ir al pago seguro en {pasarela}".
- **`app/billing`** — el botón "Activar suscripción". Cancelar y ver el estado
  del plan **siguen**: no son compras.
- **`app/info-links/[id]`** — el banner "Mejora tu InfoLink a PRO · $14.99/mes"
  (Stripe), el cross-sell a "Sellea Completo" y el candado PRO. Un solo corte:
  `proUrl`/`completoUrl` en null apaga los tres, porque el candado recibe
  `upgradeUrl={proUrl}` y cae solo al aviso sin enlace.
- **`LandingPricingCheckout`** — los 4 planes con checkout. Este era el
  peligroso: se alcanza desde el login por "¿No tienes cuenta? Adquiérelo
  aquí" → `/signup`. **A dos toques.** Ese enlace también se oculta en iOS.

**La app entra por `/hub`, no por la raíz** (`mobile/capacitor.config.ts`): la
raíz es la landing de marketing con planes y precios.

### Qué toqué de PRODUCCIÓN
- **Nada.** Sin migraciones, sin variables, sin despliegue.
- **En el navegador no cambia absolutamente nada**: `useHidesPurchases()`
  devuelve `false` fuera de la app de iOS, así que todos los flujos de compra
  siguen exactamente igual para los clientes de hoy.

### Qué falta / qué hay que validar del otro lado
- [ ] Desplegar frontend (`/hub` + estos gates).
- [ ] Fase 3 nativa: escáner MLKit, push APNs/FCM, biometría, enlaces
      universales. Sin eso Apple rechaza por 4.2 ("es solo un sitio web").
- [ ] Xcode: se liberó disco (8 GB → 44 GB libres) y quedó descargando. Falta
      `sudo xcode-select --switch`, Homebrew + CocoaPods y `npx cap sync`.

### Riesgos y avisos
- **No tocar los pagos de PEDIDOS del cliente final.** Apple solo exige su
  cobro para bienes digitales; comida, reservas y servicios reales van por
  fuera sin problema. Los gates solo cubren la venta del PLAN.
- Android no lleva ninguna de estas restricciones — Google sí permite pago
  externo para herramientas de negocio. El gate es `nativePlatform() === 'ios'`
  a propósito, no `isNativeApp()`.

## 2026-09-01 — Apps iOS/Android (fase 1): lanzador por rol `/hub` + shell Capacitor
**Máquina/quién:** la de Jhon (sesión Claude)
**Rama / PR:** feat/commissions-auto-cutoffs

### Qué cambié
- **`/hub` — lanzador por rol.** Según el correo con el que se inicia sesión,
  muestra los módulos a los que esa cuenta entra de verdad: Master Admin,
  Administración, Mi negocio, Pedidos, Escáner, Cuponera, Domicilios,
  Afiliados. Con **un solo módulo entra directo**, sin clic de más.
- **`frontend/src/lib/modules.ts` — fuente única de "qué ve cada rol".** El
  mapa estaba duplicado dos veces dentro de `login/page.tsx` (contraseña y
  Google). Ahora las dos llaman `primaryHrefForUser()`. Los destinos están
  verificados contra los guards reales (`AppShell`, `superadmin/layout.tsx`,
  `domicilios/layout.tsx` y los `@Roles` de `scanner.controller.ts`): ofrecer
  una tarjeta que el guard rebota no da 403, da un **ping-pong** entre /app y
  /admin.
- **`frontend/src/lib/native.ts` — detección del contenedor nativo** (bridge de
  Capacitor + marcador `ClubifyApp` en el User-Agent). Trae
  `useHidesPurchases()` para la guideline 3.1.1 de Apple. **El helper existe
  pero todavía no está aplicado en ningún sitio** (ver "qué falta").
- **`middleware.ts`:** `/hub` agregado a la lista de rutas que NO se reescriben
  por dominio. Sin eso, en el dominio de una marca blanca `/hub` caía al sitio
  del tenant.
- **`mobile/` — proyecto Capacitor nuevo**, fuera de `frontend/` a propósito
  (sus dependencias no entran al build de Vercel). Carga
  `https://app.soyclubify.com` en un WebView; el panel es Next.js con SSR y
  middleware, así que empaquetarlo estático no es opción. Efecto útil: **un
  deploy del frontend actualiza las dos apps** sin pasar por revisión.

### Qué toqué de PRODUCCIÓN
- **Nada.** Sin migraciones, sin variables, sin despliegue. Todo lo de este
  bloque está solo en la rama.
- El comportamiento del login en el navegador **es el mismo de siempre**
  (destino directo por rol). `/hub` solo se vuelve la entrada dentro de la app
  instalada, que todavía no existe.

### Qué falta / qué hay que validar del otro lado
- [ ] Desplegar frontend para que `/hub` exista en producción.
- [ ] **Ocultar compras en iOS** con `useHidesPurchases()`: `/pagar`, checkout
      Hotmart, "Mejorar plan", "Comprar créditos" y el Stripe de Sellea
      Infolinks. Sin esto, Apple rechaza por 3.1.1 (o exige su 30%).
- [ ] **Fase 3 (nativo real):** escáner MLKit, push APNs/FCM (falta tabla de
      tokens de dispositivo + endpoints), biometría, enlaces universales. Sin
      eso no conviene enviar a Apple: rechazan por 4.2 lo que es "solo un sitio".
- [ ] Completar el proyecto iOS: se generó pero **quedó sin `pod install`**
      porque en esta máquina no hay Xcode ni CocoaPods. Con Xcode instalado se
      arregla con `cd mobile && npx cap sync`.
- [ ] Icono 1024×1024 y splash 2732×2732 en `mobile/resources/`.

### Riesgos y avisos
- **Bundle id `com.soyclubify.app` es permanente** una vez publicado. Si se
  quiere otro, cambiarlo AHORA en `mobile/capacitor.config.ts`.
- **Las marcas blancas NO van a las tiendas en esta fase.** Publicarlas como
  apps separadas desde la cuenta de Clubify las hace clones (Apple 4.3) y
  meterlas en la app "Clubify" delataría la plataforma. Siguen con la PWA, que
  ya sirve manifest e iconos por marca.
- `mobile/android` y `mobile/ios` se versionan (llevan permisos y firma); lo
  que regenera cada build está en `mobile/.gitignore`.
- Detalle operativo completo en [`mobile/README.md`](../mobile/README.md).

## 2026-09-01 — Cuponera: renombre a "Cuponera Card" + unificación del Master Admin
**Máquina/quién:** la de Jhon (sesión Claude)
**Rama / PR:** feat/commissions-auto-cutoffs — commit `342dec08`

### Qué cambié
- **Renombre del producto a "Cuponera Card"** (antes Living Card). Solo el texto
  que ve la gente: 26 lugares entre portada, unirse, negocios, beneficios, mi
  tarjeta, panel del aliado y Master Admin.
- **NO se tocaron las llaves internas**: el slug `living-card`, el
  `sys-living-card` del tenant, el modelo `LivingMembership` ni los
  `ensureLiving*`. Cambiar el slug NO renombra la campaña: hace que
  `ensureLivingCampaign()` no la encuentre y **cree una segunda vacía**, dejando
  huérfanos aliados, miembros y canjes. No sale en ninguna URL pública. Queda
  explicado en el propio `LIVING_CAMPAIGN_SLUG` para que nadie lo "arregle".
- **Rutas**: `/livingcard` y `/livingcard/cartelera` **siguen vivas** (están en
  material impreso desde agosto). Se agregó `/cuponeracard/*` al lado.
- **Menú del Master Admin: de dos entradas a una.** Había 'Cuponeras' (el
  índice) y 'Living Card' (el editor). El editor NO era un duplicado: era el
  editor de UNA cuponera —la primera— porque sus endpoints `/cuponera/admin/*`
  llaman `ensureLivingCampaign()` por dentro. Quedó solo **Cuponeras**, que ya
  tenía «Entrar al panel» → `/cuponera/admin?campaignId=<id>`, scopeado de
  verdad. `/superadmin/living-card` **redirige** ahí (no da 404).
- **Tres cosas que vivían SOLO en la pantalla vieja se portaron al panel**, para
  no perder capacidad al quitarla: diseño de la tarjeta Wallet (pestaña nueva
  *Tarjeta*), credenciales de MercadoPago y mapeo a Hotmart/Stripe
  (*Configuración › Cobro*). Las tres pasan por `resolveAdminCampaign`, así que
  ahora **cada cuponera** diseña su tarjeta y conecta su cobro — antes solo la
  primera podía.
- 5 endpoints nuevos en `cuponera/panel`: `GET/PUT card`, `GET gateways`,
  `GET/PATCH mercadopago`. `MercadoPagoService.status/setConfig` aceptan una
  campaña opcional (sin ella siguen cayendo en la primera, como siempre).
- **Bug atrapado antes de salir:** `PanelPlanPatchBody` no declaraba los campos
  de pasarela, así que el whitelist del ValidationPipe los descartaba antes del
  servicio: el mapeo se habría "guardado" sin error y sin guardar nada.
- Test nuevo: `test/cuponera-panel-tarjeta-cobro.test.ts` (5 casos).
  Suite completa de cuponera: 123 en verde.

### Qué toqué de PRODUCCIÓN
- **Backend desplegado** con `node scripts/desplegar.cjs backend`. Swap
  verificado por reseteo de uptime (835s → 11s). Endpoints nuevos comprobados:
  `card`, `gateways`, `mercadopago` dan 401; una ruta inventada da 404 (control).
  Lo público sigue en 200.
- **Frontend desplegado** con `node scripts/desplegar.cjs frontend`.
- El deploy arrastró `a19639b5` de la otra máquina (botón de upgrade a PRO en el
  editor de InfoLinks). Solo toca un archivo de frontend; verificado que compila.
- **Renombre en la base**: `backend/scripts/apply-rename-cuponera-card.cjs`
  (simulacro por defecto, `APPLY=1` para escribir). Renombra 9 campos: nombre y
  texto de bienvenida de la campaña, nombre y brandName del tenant de sistema,
  los 3 planes y el nombre + walletBrandName de la tarjeta Wallet.
  Hacía falta un script aparte porque `ensureLivingCampaign()` es idempotente y
  **no pisa** los campos de una campaña que ya existe: cambiar el literal en el
  código no renombra nada de lo que ya está.

### Qué falta / qué hay que validar del otro lado
- [ ] La cuponera sigue con **0 aliados y 0 beneficios**. Es el bloqueo real:
      sin un negocio cargado no hay nada que ofrecer ni forma de probar el ciclo.
- [ ] **Nadie tiene rol `CUPONERA_ADMIN`.** Se entra por el Master Admin.
- [ ] **Sin pasarela conectada** → los planes Mensual y Anual siguen inactivos;
      público solo se ve el Gratis.
- [ ] La pestaña *Tarjeta* y el bloque *Cobro* del panel nunca se ejercitaron
      con datos reales (no hay miembros).

### Riesgos y avisos
- **No renombrar el slug `living-card`.** Es la llave, no el nombre. Ver arriba.
- El editor viejo quedó como redirección; su contenido está en git en
  `3701e712` si hiciera falta mirarlo.
- `/livingcard/*` no se puede borrar: está impreso en material repartido.

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

## 2026-09-01 — Botón upgrade a PRO en editor InfoLinks (+ coordinación deploy con cuponera de Javi)

**Máquina/quién:** máquina de Jhon (Claude) · Rama `feat/commissions-auto-cutoffs` · commit `a19639b5`

### Qué cambié (frontend, DESPLEGADO)
- Editor `info-links/[id]`: cableado el upgrade FREE→PRO al Payment Link `INFOLINK_PRO`
  (el que registré ayer). Banner "Mejora tu InfoLink a PRO · $14.99/mes" (solo INFOLINK+FREE)
  → abre el checkout; enlace "Mejorar →" junto a `N/5 · plan Gratis`; los candados
  `ProLock` (fondo/colores) ahora abren el checkout en vez de solo alertar. Sin cambios de
  backend (los datos salen de `getMine` → `/tenants/me`, que ya trae `paymentLinks.productKey/url/amountUsd`).

### Coordinación (IMPORTANTE)
- Al pushear, mi commit quedó **encima de `342dec08` de Javi** (*"Cuponera Card"*, front+back),
  que llegó por OneDrive. El backend vivo era el mío (`21027f3d`) SIN su backend de cuponera.
- **Javi desplegó su backend en paralelo** (build/deploy detectado; swap a deployment
  `9c431124`, Online 200). Esperé a que su backend quedara vivo ANTES de soltar el frontend,
  para no dejar su frontend de cuponera adelantado a su backend.
- Mi deploy de frontend (`a19639b5`) subió **su frontend de cuponera + mi botón PRO**, ya
  consistente con su backend. Vercel READY.

### Riesgos y avisos
- La rama sigue con commits de Javi y míos apilados por OneDrive; seguir verificando sync
  (`git rev-list --left-right`) antes de cada deploy. En este no me quedé por detrás (0/0).

## 2026-09-01 — Ranking pases (oculta TRIAL/SUSPENDIDOS) + total a cobrar en Próximos cobros

**Máquina/quién:** máquina de Jhon (Claude) · Rama `feat/commissions-auto-cutoffs` · commit `21027f3d`

### Qué cambié (DESPLEGADO backend + frontend)
- **Ranking por pases emitidos** (`tenants.service.rankingByPasses`): oculta SUSPENDIDOS
  y TRIAL, con **excepción "Nudo Cowork"** (TRIAL visible). Filtro antes de contar pases
  → el total del ranking también queda acotado a lo visible.
- **Próximos cobros** (drilldown, `PremiumDashboard.CobrosDrilldown`): barra arriba
  **"Total a cobrar · <rango>"** = suma de USD de las filas del rango seleccionado (chips
  Hoy/7d/15d/30d).

### Qué toqué de PRODUCCIÓN
- **Railway backend**: `desplegar.cjs backend`, deployment `24a7ce3e` swapped (Online, API 200).
- **Vercel frontend**: `desplegar.cjs frontend`, READY.

### Riesgos y avisos
- La excepción del ranking matchea por `brandName.toLowerCase().includes('nudo cowork')`.
  Si algún día el negocio se renombra, deja de exceptuarse (habría que ajustar el string).

## 2026-09-01 — Sellea InfoLinks (precio PRO, nav, form, fix FOUC) + VIIDA renovación fantasma

**Máquina/quién:** máquina de Jhon (Claude) · Rama `feat/commissions-auto-cutoffs` · commit `94a32396`

### Qué cambié (frontend, DESPLEGADO a Vercel)
- **Fix FOUC en `/i-registro/[brand]`**: el `fetch` del server component pegaba a
  `${API}/auth/infolink-brand/…` **sin el prefijo `/api`** (el backend usa
  `setGlobalPrefix('api')`) → 404 → `initialBrand` null → el form caía SIEMPRE al
  fetch cliente = flash de marca eterno. Ahora `/api` + `revalidate:300` +
  `AbortSignal.timeout(2000)`. Se quitó el emoji 🔗 y el "Cargando…" (eran parte
  del flash) → skeleton neutro. Verificado por curl: el HTML crudo de prod ya trae
  logo+tagline+colores de Sellea en el primer frame.
- **Form de registro** (`i-registro/[brand]/SignupForm.tsx`): todos los campos
  **obligatorios** (incluido WhatsApp); WhatsApp usa `PhoneInput` con bandera +
  selector de país (se fue el "+57" hardcodeado).
- **`/infolink`**: precio PRO "Por definir" → **$14.99 USD/mes**.
- **Landing Sellea** (`app/sellea/page.tsx`): enlace **"Infolinks"** en el nav → `/infolink`.

### Qué toqué de PRODUCCIÓN
- **Vercel**: desplegado frontend (`node scripts/desplegar.cjs frontend`), deploy
  `dpl_4ueRcphC2yDyixoun25zKVgHdtGA` READY, aliased fideliso.com/selleala.com.
- **BD (prod)**: creado `WhiteLabelPaymentLink` **InfoLink PRO** para la marca
  Sellea (`stripePriceId=price_1U7zPTKAK6ubdwt6YGNM8WOT`, `productKey=INFOLINK_PRO`,
  $14.99, url `https://buy.stripe.com/14AfZib574HE3Qj43n9R604`). Era la pieza que
  faltaba del freemium: ahora el webhook de Stripe sube el negocio a tier PRO al
  pagar ese price. Fila `363420f0-e4f0-49cd-8737-4dba8bd72212`.
- **VIIDA Cocina Caribe (RLSCWWX6)**: diagnóstico — NO se corrigió aún (falta OK).

### VIIDA — renovación fantasma (causa raíz encontrada)
- El 29-ago falló el cobro real de Hotmart (Retraso), pero el **cron de créditos
  `RenewalsService` (2 AM)** la renovó igual el 30-ago 02:00: como su marca es la
  propia **Clubify (`creditsUnlimited`)**, cayó en la rama "marca ilimitada →
  siempre renueva" → avanzó `currentPeriodEnd`→29-sep + `lastChargeAt`=30-ago **sin
  dinero real**; el cron de billing (3 AM) limpió el contador de fallos. Quedó "al día".
- **El bug sistémico YA está corregido y vivo**: el guard `if (wl.slug==='clubify')
  skip` entró en `dc56ebcd` (31-ago) — VIIDA fue víctima del run ANTERIOR al fix.
  Verificado: 0 tenants Hotmart bajo marca ilimitada ≠ clubify → VIIDA es el único caso.
- **Corrección puntual pendiente** (script listo en scratchpad, idempotente): devolver
  VIIDA a la realidad (lastChargeAt=29-jul, currentPeriodEnd=29-ago, firstFailedAt=29-ago,
  failedPaymentCount=1) para que entre a gracia/suspensión normal. NO aplicado: dispara
  SMS de mora a la clienta → esperando OK del dueño.

### Qué falta / qué hay que validar del otro lado
- [x] VIIDA corregida (2026-09-01, con OK del dueño): lastChargeAt=29-jul, ciclo=29-ago,
      firstFailedAt=29-ago, fallos=1 → 🟡 EN GRACIA día 4, suspende ~03-sep si no paga.
      Dispara SMS de mora a la clienta. Si Hotmart recupera el cargo, activatePurchase la reactiva.
- [ ] El CTA "Empieza gratis y mejora" de `/infolink` va a `/i-registro/sellea` (signup),
      no al link de Stripe. El upgrade a PRO desde el panel del negocio queda por cablear.

### Riesgos y avisos
- El SMS `pago_procesado` (entrada de abajo) sigue disparando para **todas** las marcas,
  no solo Clubify. Revisar si hace ruido.

## 2026-09-01 — SMS al equipo también cuando un cobro Hotmart SÍ se procesa

**Máquina/quién:** máquina de Jhon (Claude) · Rama `feat/commissions-auto-cutoffs`

### Qué cambié
- Pedido del dueño: además del SMS de cobro FALLIDO, avisar a los **mismos 3
  números** cuando un cobro Hotmart **SÍ se procesa**.
- `billing.service.notifyBillingTeam` ahora acepta `kind='pago_procesado'` (+ opts
  amountUsd/renewal): `✅ Pago procesado (renovación): <marca> · $<monto>`.
- `hotmart.service.activatePurchase`: al confirmar un cobro real llama
  `notifyBillingTeam('pago_procesado', ...)` **gated en `!alreadyConfirmedTx`** →
  una vez por cobro (no en el re-webhook PURCHASE_COMPLETE del mismo pago); cubre
  1er pago, renovación y reactivación. Solo Hotmart (Stripe no lo pidió).

### Qué toqué de PRODUCCIÓN
- Deploy backend.
- **Cross-check** (solo lectura) del CSV de fallidos de Hotmart vs sistema: todos
  bien tomados; Konys y Wok ya habían pagado (1-sep) y quedaron activos; VIIDA
  Cocina Caribe (RLSCWWX6) el sistema lo ve pagado (29-ago) pero Hotmart en Retraso
  → a verificar en Hotmart. Wok/Mauricio: activó solo al recibir el pago ✓.

### Qué falta / qué hay que validar del otro lado
- [ ] Verificar VIIDA Cocina Caribe en Hotmart (¿impago real o flag viejo?).
- [ ] El SMS de pago procesado sale para TODAS las marcas (no scopeado). Si es
      mucho volumen, scopear o filtrar.

## 2026-08-26 — Convenios, aislamiento de comisiones y el webhook de Stripe de Sellea
**Máquina/quién:** Javier (montiieljaviier) con Claude
**Rama / PR:** `chore/merge-emails-sobre-314` (todo empujado)

### Qué cambié

- **Convenios** (beneficios para empleados de una empresa aliada). Backend
  completo en `backend/src/convenios/`: esquema, servicio de administración,
  servicio de canje con candado, controlador y rama nueva en el escáner. 31
  tests. **Falta todo el frontend** — hay un traspaso detallado con la API y las
  seis piezas que faltan; Javier tiene el enlace.
- **Aislamiento por marca en comisiones.** `listAdminCommissions` solo miraba el
  rol, y `SUPER_ADMIN` lo tienen también los admins de marca blanca: el admin de
  Sellea veía las comisiones de TODA la plataforma. Acotado por la marca del
  código destinatario. También `listCommissionBusinesses` y
  `listUnattributedBusinesses`. Los endpoints `integration/*` de TeamClubify
  piden `todasLasMarcas: true` explícito — si tocas eso, no se los comas.
- **Stripe: firma inválida devuelve 400, no 200.** Contestábamos 200 a todo,
  así que Stripe mostraba «0 % de error» mientras tirábamos cada evento.
- **Avisos duplicados, dos caminos.** Una compra dispara TRES eventos en el
  mismo segundo (`checkout.session.completed`, `invoice.paid`,
  `invoice.payment_succeeded`). Las dos guardas leían-y-luego-escribían y las
  tres pasaban. Ahora se reclama con UPDATE condicional.
- **Ranking de negocios**: filtro por período, orden por antigüedad, total de
  pases emitidos.
- **Cupones**: opción «no convertir a ninguna tarjeta» (`Card.transformOnRedeem`).
- **Mapa revertido a Google Maps** y pines individuales, por decisión de Javier.
- **`scripts/desplegar.cjs`**: despliega una COPIA LIMPIA del commit, no la
  carpeta. Úsalo en vez de `railway up` / `vercel deploy` a pelo.

### Qué toqué de PRODUCCIÓN

- **Migración de Convenios aplicada** (`scripts/apply-convenios-migration.cjs`),
  aditiva e idempotente. 6 tablas, 5 enums, 3 columnas. Nadie lo tiene
  habilitado (`conveniosEnabled` arranca en false).
- **Migración `Card.transformOnRedeem`** aplicada. Los 68 cupones existentes
  quedan en `true` = comportamiento de siempre.
- **Backend desplegado varias veces**; frontend también.
- **NO toqué** las credenciales de Stripe de Sellea salvo reescribir el
  `webhookSecret` con el mismo valor que ya tenía (fue un no-op).

### Qué falta / qué hay que validar del otro lado

- [ ] **Frontend de Convenios** — es el grueso. Ver el traspaso.
- [ ] **Stripe de Sellea: la clave secreta sigue mal.** Lo guardado es
      `ed_61V1…GMVM`, que no es una clave de Stripe; Stripe la rechaza con
      «Invalid API Key provided». Hay que crear una nueva (`sk_live_`) porque la
      vieja ya no se puede revelar. Los avisos salen igual sin ella, pero lo que
      consulta a Stripe no.
- [ ] **Hay DOS endpoints de webhook** apuntando a la misma URL
      (`inspiring-bliss-thin` y `webhookSELLEA`). Sobra el primero, que además
      usa formato *Thin* que nuestro código no entiende.
- [ ] **Rotar el `whsec_` de Sellea**: pasó por un chat.
- [ ] **Recordatorio a las 2 h** al comprador que no activó — no existe.
- [ ] **Separar el aviso al negocio del aviso a Sellea** con los datos del
      cliente — hoy sale uno solo.
- [ ] **Fugas de marca en el panel del afiliado**: `Logo` es el de Clubify a
      fuego, y hay un `|| !me.brand` que pinta Clubify cuando la marca no
      resuelve. Está en el documento que Javier le pasó a Jhon.

### Riesgos y avisos

- **El repo está dentro de OneDrive** y se sincroniza entre las dos máquinas: el
  trabajo SIN COMMITEAR de una aparece en la copia de la otra. **Nunca
  `git add -A`.** Hoy se coló trabajo ajeno a medias dentro de un commit.
- **Si te encuentras cambios que no son tuyos, NO los reviertas.** Devolverlos
  en git los cambia en disco, OneDrive sincroniza, y le borras a la otra persona
  lo que tiene abierto.
- **Nunca `prisma migrate diff` contra producción.** Genera 423 líneas que
  además BORRAN índices que no se pueden expresar en el schema, entre ellos
  `Pass_legacyQrTokens_idx` — el que hace que un QR ya instalado nunca deje de
  escanear.
- **Dos sesiones de Vercel** conviven en esta máquina y el CLI guarda el token
  en un solo sitio. La de Clubify vive aislada en `~/.vercel-clubify`; el script
  de despliegue la usa sola.
- **El patrón de fallo del día**: leer-decidir-escribir sin atomicidad. Salió
  tres veces (avisos al negocio, avisos al comprador, y casi en el filtro de
  marca). Si algo puede llegar dos veces en el mismo segundo, recláma­lo con un
  UPDATE condicional y mira el `count`.

---

## 2026-09-01 — Fix: /admin/contabilidad (y 4 rutas más) se veían como marca blanca

**Máquina/quién:** máquina de Jhon (Claude) · Rama `feat/commissions-auto-cutoffs`

### Qué cambié
- **Bug:** en `/admin/contabilidad` desaparecía la sección del panel y "no
  ingresaba". Causa: `AppShell.tsx` decide si `/admin/<seg>` es una ruta admin o
  un SLUG DE MARCA BLANCA usando el set `ADMIN_ROUTE_SEGMENTS`. `contabilidad` NO
  estaba en el set (había `accounting` en inglés, ruta que no existe) → se leía
  como marca → `isOtherBrand=true` → escondía todos los items `clubifyOnly`
  (incluido Contabilidad) y trataba el panel como de otra marca. Roto desde que se
  creó la página; recién ahora se usó.
- **Fix:** agregué `contabilidad` al set. Y de paso barrí TODAS las rutas reales
  de `src/app/admin/*` contra el set: faltaban 4 más con el mismo bug latente
  (`academia`, `automatizaciones`, `infolinks`, `pending-payments`) — agregadas.
- **⚠️ HAY DOS LISTAS (segundo commit):** además de `ADMIN_ROUTE_SEGMENTS` en
  AppShell (nav), el **`middleware.ts`** tiene su propia `RESERVED_ADMIN_ROUTES`.
  El middleware es server-side y **REESCRIBE `/admin/<slug-no-listado>` → `/admin`**
  (el dashboard) tratándolo como marca. Por eso, con solo el fix del AppShell, la
  sección aparecía pero al entrar **cargaba el Dashboard**, no Contabilidad. Al
  middleware le faltaban `contabilidad` e `infolinks` → agregadas. Verificado: las
  32 rutas admin están en AMBAS listas. **Al crear una ruta /admin/<seg> nueva, hay
  que agregarla a las DOS listas.**

### Qué toqué de PRODUCCIÓN
- **Deploy frontend.** Backend: nada.

### Qué falta / qué hay que validar del otro lado
- [ ] Al agregar una ruta nueva en `src/app/admin/<seg>`, agregar `<seg>` a
      `ADMIN_ROUTE_SEGMENTS` en AppShell (si no, la página se ve rota en marca).

## 2026-09-01 — Gracia/suspensión en DÍAS DE BOGOTÁ, 1-indexado (no hay Día 0)

**Máquina/quién:** máquina de Jhon (Claude) · Rama `feat/commissions-auto-cutoffs`

### Qué cambié (decisión del dueño)
- **Problema:** el contador de gracia se calculaba en periodos de 24h **UTC**,
  pero las fechas se muestran en **Bogotá**. Cerca de la medianoche no cuadraban
  (Konys: VENCE "31 ago" pero "Día 0 de 5" — porque en UTC solo habían pasado 17h).
- **Fix en `decideDunning` (`billing/dunning.ts`):** `daysOverdue` ahora cuenta
  **días de calendario de Bogotá** y es **1-indexado** (el primer día vencido ya
  es **Día 1**, no hay Día 0). Asimetría correcta: **fallo del cobro** → el día del
  fallo es Día 1; **fin de ciclo** → vence el día SIGUIENTE al fin del período
  (tuvo hasta el final de ese día). Suspende al **Día 6** (5 días de gracia).
  Ejemplos: Konys (venció 31-ago Bogotá) → hoy "Día 1"; un fallo de hoy → "Día 1".
- **Frontend:** el formateador de fechas del drill-down de cobros
  (`PremiumDashboard.tsx`) ahora renderiza en `timeZone: 'America/Bogota'` (antes
  usaba la hora del navegador → se corría un día).
- Tests `dunning.test.ts` reescritos (DAY0 a medianoche de Bogotá, 25 verdes).

### Qué toqué de PRODUCCIÓN
- **Deploy backend + frontend.**
- DB: nada.

### Qué falta / qué hay que validar del otro lado
- [ ] Nada crítico. Verificado que ningún negocio en gracia salta a Día 6 con el
      cambio (los que había estaban en Día 0 → pasan a Día 1).

### Riesgos y avisos
- El MISMO contador decide la SUSPENSIÓN. Ahora suspende al Día 6 **en días de
  Bogotá** (borde a medianoche), no a 6×24h UTC → puede correr la suspensión hasta
  ~1 día vs antes. Es el comportamiento pedido. `pauseDate` (fecha mostrada de
  "se pausa el X") sigue siendo aproximada (±1 día).

## 2026-09-01 — FIX RAÍZ: cron de suspendidos anulaba comisiones REALES de cobros previos

**Máquina/quién:** máquina de Jhon (Claude) · Rama `feat/commissions-auto-cutoffs`

### Qué cambié
- **Causa raíz del caso Wok Explosivo (y clase entera):** el cron horario
  `reconcileSuspendedTenantsCommissions` (`payouts.service.ts:806`) rechazaba
  **TODAS** las comisiones PENDING/APPROVED de **cualquier** negocio SUSPENDED,
  sin mirar la fecha del cobro. → anulaba también las de **cobros REALES
  anteriores** a la suspensión (dinero que el cliente sí pagó, sin reembolso),
  robándole al afiliado una comisión ganada. Sin audit ni notas (difícil de
  rastrear). Un negocio que paga meses reales y luego se suspende perdía TODAS sus
  comisiones pendientes.
- **Fix:** ahora solo rechaza comisiones cuyo **`businessDate > suspendedAt`**
  (cobros POSTERIORES a la suspensión = fantasmas/race, que es lo que el cron debe
  cazar); legacy sin businessDate cae a `createdAt`. Los reembolsos/contracargos de
  cobros viejos los maneja `churnReferral` (webhook), no este cron. Además ahora
  deja `notes` en las que rechaza (trazabilidad).

### Qué toqué de PRODUCCIÓN
- **Deploy backend** con el fix (URGENTE: el cron iba a re-anular la comisión de
  Wok Explosivo que se restauró hace un rato).

### Qué falta / qué hay que validar del otro lado
- [ ] **Auditoría histórica pendiente:** este cron pudo haber anulado
      indebidamente comisiones de OTROS afiliados (negocios que pagaron real y
      luego se suspendieron). Vale la pena un script que liste REJECTED con
      `businessDate < suspendedAt` y sin reembolso → candidatas a restaurar.

### Riesgos y avisos
- El fix es más conservador (sesga a NO rechazar). Puede dejar pasar algún
  fantasma con businessDate viejo, pero eso es preferible a robarle plata a un
  afiliado. Ver [[feedback_cutoff_total_recalc_excludes_rejected_2026_08_31]].

## 2026-09-01 — Wok Explosivo: comisión de agosto REAL anulada por evento duplicado de Hotmart

**Máquina/quién:** máquina de Jhon (Claude) · Rama `feat/commissions-auto-cutoffs`

### Qué pasó / qué cambié
- Wok Explosivo (afiliado Nicolás Quintero, TAFMPWK5, subscriber G12D7TCG) mostraba
  solo 2 comisiones (may, jul). La de **agosto ($5) existía pero estaba REJECTED**.
- **AuditLog** de agosto: 03-ago `payment_succeeded` (renovación REAL, ciclo→07-sep,
  creó la comisión) · 11-ago `payment_succeeded` (2º evento a los 8 días que NO
  extendió el ciclo → **duplicado/fantasma** de Hotmart) · 26-ago `payment_failed`
  (PURCHASE_DELAYED) · 31-ago SUSPENDIDO. **Sin reembolso ni contracargo** en el
  registro → el dinero de agosto es real.
- La comisión se anuló como efecto colateral del duplicado / suspensión (anulación
  indebida). Restaurada a **APPROVED** con
  `scripts/restore-wok-explosivo-august-commission.cjs` (idempotente; el dueño lo
  corrió).

### Qué toqué de PRODUCCIÓN
- **DB:** restaurada 1 comisión (REJECTED→APPROVED, $5) vía el script. Nada más.

### Qué falta / qué hay que validar del otro lado
- [ ] Nicolás cobra ese $5 en el próximo corte (verificar que entre).

### Riesgos y avisos
- **Causa de fondo SIN arreglar (delicada):** cuando Hotmart dispara un 2º evento
  de renovación en el mismo ciclo (duplicado/fantasma), la lógica anti-fantasma /
  suspensión puede **anular la comisión REAL**. Antes de restaurar una REJECTED,
  mirar SIEMPRE el AuditLog: si hay `PURCHASE_REFUNDED`/`CHARGEBACK`, el rechazo es
  correcto; si no, es anulación indebida. Distinto del bug de Motilart (ahí faltaba
  CREARLA; aquí se creó y se anuló).

## 2026-09-01 — Sellea: fugas de marca en links de afiliado + comisión fija + botón sin feedback (LIVE, commit e00c2ea9)

**Máquina/quién:** máquina de Jhon (Claude) · Rama `feat/commissions-auto-cutoffs`

### Qué cambié (4 bugs de Sellea reportados con capturas)
- **Fuga link para compartir** (`soyclubify.com/ref/...` en vez de Sellea): en
  `referrals.service.ts` había `appUrl = process.env.APP_URL ?? 'soyclubify.com'`
  hardcodeado en 4 sitios (createCode, listMine, createEmbajadorDirect,
  createInfluencer). Ahora nuevo helper `brandShareBaseUrl(whiteLabelId)` que usa
  `brandBaseUrl` (dominio de la marca dueña del código → `www.selleala.com`).
- **Fuga link de login en credenciales** (`soyclubify.com/login`): reset de
  contraseña en `auth.service.ts` `setAffiliatePasswordByCode` armaba
  `${APP_URL}/login`. Ahora lee `whiteLabelId` del código y usa `brandBaseUrl`.
- **Comisión fija en auto-registro de afiliado** (bug encontrado de paso):
  `selfRegisterAffiliate` guardaba solo `commissionPercent` → un afiliado de
  Sellea (modo FIXED_ONCE) nacía en % en vez de $80/$40 pago único. Ahora setea
  `fixedCommissionUsd` igual que el admin y `/refer`.
- **Botón "Registrarme" "no hace nada"**: en `registro-afiliado/page.tsx` el
  botón se deshabilita si el formulario está incompleto (típico: contraseña < 8
  caracteres) SIN ningún aviso. Agregado texto que explica qué falta.

### Qué toqué de PRODUCCIÓN
- Nada aún — SIN DESPLEGAR. Pendiente deploy backend + frontend.
- DB: solo lectura (verifiqué dominios de Sellea: domain=www.selleala.com,
  appDomain=app.selleala.com).

### Qué falta / qué hay que validar del otro lado
- [ ] Desplegar backend + frontend.
- [ ] Verificar en Sellea que los links ya no dicen soyclubify.

### Riesgos y avisos
- El helper prefiere `WhiteLabel.domain` (marketing). Clubify queda igual
  (domain=soyclubify.com). Solo cambia para marcas con dominio propio.

## 2026-09-01 — Dashboard de cobros: colores intuitivos + rango "Todos" en No procesados

**Máquina/quién:** máquina de Jhon (Claude) · Rama `feat/commissions-auto-cutoffs`

### Qué cambié
- **Colores de las 3 tarjetas** (confusión reportada por el dueño: abría la roja
  buscando los fallos y ahí estaban los "próximos"). Ahora:
  - 🔵 **Próximos cobros** (neutro, era 🔴)
  - 🟢 Pagos procesados (igual)
  - 🔴 **Pagos no procesados** (el fallo, era 🟡)
  Solo frontend: `PremiumDashboard.tsx` (CobroCard color `blue`, iconos, títulos
  del drill-down).
- **Rango "Todos"** en la lista de 🔴 No procesados. Antes la lista recortaba a
  30 días y las **suspensiones viejas** (ej. AutoTech Services, suspendido desde
  5-jul) sumaban en el CONTEO pero **no aparecían en la LISTA**. Ahora "Todos" es
  el rango por defecto de esa tarjeta → lista cuadra con el conteo. Backend:
  `rangeToDays` acepta `todos`/`all` (36500 días = sin recorte). Verificado:
  conteo=6, lista 30d=5, lista Todos=6 (AutoTech reaparece).

### Qué toqué de PRODUCCIÓN
- **Deploy backend + frontend** (rama `feat/commissions-auto-cutoffs`).
- DB: nada (solo lectura para verificar).

### Qué falta / qué hay que validar del otro lado
- [ ] Nada crítico. Es UX del dashboard de cobros.

### Riesgos y avisos
- **Recordatorio de diseño (no es bug):** el SMS de "cobro fallido" al equipo
  dispara SOLO en el PRIMER fallo (`wasFirstFailure`, hotmart.service). Un negocio
  ya suspendido que Hotmart sigue reintentando (ej. AutoTech, 6º intento) NO
  re-alerta. Es a propósito, para no spamear en cada reintento.

## 2026-09-01 — Fix comisión faltante del 3er cobro (Motilart) + arreglo sistémico de dedup por ciclo

**Máquina/quién:** máquina de Jhon (Claude) · Rama `feat/commissions-auto-cutoffs`

### Qué cambié
- **Diagnóstico (Motilart):** paga mensual; cobros reales jun/jul/ago (tx
  `HP0274589164`, $49.52, `lastChargeAt=2026-08-22`, ciclo→22-sep). El 3er cobro
  SÍ estaba registrado pero **no generó comisión**. Causa raíz doble, mismo
  origen (deducir el ciclo por `createdAt`/`new Date()` en vez de `businessDate`):
  1. `periodKey = monthKey()` = mes en que corre el código. Las comisiones de
     **julio** se insertaron tarde (30-ago) → quedaron con período `2026-08` →
     chocaban en la UNIQUE con el cobro de agosto.
  2. `reconcileRecurringCommissions` deduplicaba por `createdAt ≥ inicioCiclo`;
     esas filas (creadas 30-ago) caían en la ventana del ciclo de agosto → el
     cron creía agosto cubierto y lo saltaba.
- **Arreglo sistémico** (`backend/src/referrals/referrals.service.ts`):
  - `reconcileRecurringCommissions`: dedup por **`businessDate`** (con fallback a
    `createdAt` solo para filas legacy sin businessDate), `periodKey` derivado del
    cobro (`monthKey(lastChargeAt)`), y ahora **escribe `businessDate`** al crear.
  - `generateCommissionsForPayment` (webhook): `periodKey = monthKey(businessDate)`
    + dedup por ciclo (mes de businessDate) — cubre filas de reconcile con `tx=null`.
  - Test `backend/test/commission-cycle-dedup.test.ts` (5, verdes). Suite
    comisiones/cortes/dunning: 69/69. `tsc` limpio.
- **Arreglo puntual (dato):** `backend/scripts/fix-motilart-august-commission.cjs`
  (idempotente): re-estampó julio a `2026-07` y creó las 2 de agosto ($12.50
  Santiago + $2.50 Juan), PENDING, disponibles 06-sep.

### Qué toqué de PRODUCCIÓN
- **DB:** corrí el script puntual de Motilart (re-estampa 2 filas de julio +
  crea 2 de agosto). Verificado: 6 comisiones, 3 meses completos.
- **Deploy backend:** rama `feat/commissions-auto-cutoffs` con el arreglo
  sistémico (ver commit de esta entrada).

### Qué falta / qué hay que validar del otro lado
- [ ] Las 2 comisiones de agosto de Motilart pasan a APPROVED solas el **06-sep**
      (cron promotePendingToApproved). Verificar que entren al corte correcto.
- [ ] El arreglo sistémico beneficia a TODOS los negocios con cobros cuya
      comisión se insertó tarde: vigilar que no reaparezca "renovación sin
      comisión" en próximos cortes.

### Riesgos y avisos
- El cambio de `periodKey` (de mes-de-ejecución a mes-de-cobro) es hacia
  adelante; las filas legacy conservan su período viejo. El dedup por
  `businessDate` las respeta (fallback a `createdAt` si no tienen businessDate),
  así que no duplica.

## 2026-08-31 — Contabilidad F5 (Cierres) + F6 (Reportes) (SIN DESPLEGAR)

**Máquina/quién:** máquina de Jhon (Claude) · Rama `feat/commissions-auto-cutoffs`

### Qué cambié
**F6 Reportes/Dashboard:** `FinanceReportService` — cascada de utilidad DERIVADA
(Bruto − Fee/IVA = Neto; Neto − Egresos − Nómina − Comisiones = Utilidad) +
serie mensual (6 meses). Endpoint `GET /admin/contabilidad/reporte?scope=&period=`.
Frontend: pestaña **Reportes** (cascada + serie). Nómina se toma por `periodEnd`
del PayrollRun; comisiones por `businessDate` (status≠REJECTED, sin acotar por
marca en v1).

**F5 Cierres:** modelo nuevo `FinancialClose` (snapshot mensual congelado de la
cascada, único por period+scope). Migración
`apply-financial-close-migration.cjs`. Endpoints `GET/POST/DELETE
/admin/contabilidad/cierres`. Frontend: pestaña **Cierres** (cerrar mes con
snapshot + tabla de meses cerrados + reabrir). TSC + ESLint limpios.

Con esto el módulo Contabilidad queda con TODAS las pestañas (Ingresos,
Conciliación, Egresos, Gastos, Nómina, Movimientos, Reportes, Cierres).

### Qué toqué de PRODUCCIÓN
- Nada. Falta: correr `apply-financial-close-migration.cjs` ANTES del deploy (el
  código consulta la tabla nueva) + desplegar backend + frontend.

## 2026-08-31 — Contabilidad F4 Movimientos: terminado (SIN DESPLEGAR)

**Máquina/quién:** máquina de Jhon (Claude) · Rama `feat/commissions-auto-cutoffs`

### Qué cambié
Cerré el **F4 Movimientos** de Contabilidad que estaba aparcado sin commitear.
Backend ya estaba (MovementsService/Controller: libro de caja DERIVADO de
IncomeRecord + Expense + PayrollRun con saldo corrido, `GET
/admin/contabilidad/movimientos?scope=&kind=`). Faltaba el frontend, que además
estaba ROTO (el `mv` del `Promise.all` no estaba en el destructuring →
`contabilidad/page.tsx` no compilaba). Corregido: agregado `mv` al destructuring,
la pestaña **Movimientos** en la barra de tabs, y el render (resumen
ingresos/egresos/saldo + filtro Todos/Ingresos/Egresos + tabla débito/crédito/
saldo). TSC backend + frontend limpios (el error viejo de contabilidad ya no está).

### Qué toqué de PRODUCCIÓN
- Nada. Aditivo, sin migración (Movimientos es derivado en lectura). Falta desplegar.

### Qué falta
- [ ] Desplegar backend + frontend.

## 2026-08-31 — Renovaciones Fases 3 (SMS alertas) + 4 (comisiones en Pagos por fuera) (SIN DESPLEGAR)

**Máquina/quién:** máquina de Jhon (Claude) · Rama `feat/commissions-auto-cutoffs`

### Qué cambié
**Fase 3 — SMS de alerta de cobro** a los 3 números (+573135618300 /
+573181666999 / +573248088401) por la **subcuenta del equipo**
(`prereg.sendInternalAlert`, la misma probada con el SMS de pagos — NO desde
+573167689240 porque ese número no está en el sistema; cambiar el remitente ahí
cuando exista). `BillingService.notifyBillingTeam('renovacion_fallida'|
'suspendido', brandName)`. Disparadores: 1er cobro fallido (hotmart DELAYED/
PROTEST + stripe onPaymentFailed, SOLO cuando firstFailedAt era null → no spamea
reintentos) y auto-suspensión (processOverdueAccounts). Test: `POST
/billing/billing-alerts/test`.

**Fase 4 — columna de comisiones** en Pagos por fuera (`listManualPaymentReview`
+ `pagos-manuales/page.tsx`): 🟢 asignadas (afiliado + comisión generada) /
🟡 parcial (afiliado SIN comisión → revisar, caso CHANFLE) / 🔴 sin asignación.
Usa `referrals.getAttributionChain` (ya inyectado en TenantsService).

### Qué toqué de PRODUCCIÓN
- Nada. Falta desplegar backend + frontend.

### Qué falta / validar
- [ ] Desplegar. Probar el SMS con `POST /billing/billing-alerts/test`.
- [ ] Con esto el proyecto de renovaciones/cobros queda COMPLETO (Fases 1-5).

## 2026-08-31 — Dashboard de cobros (Fase 5) instalado: 3 tarjetas 🔴🟢🟡 (SIN DESPLEGAR)

**Máquina/quién:** máquina de Jhon (Claude) · Rama `feat/commissions-auto-cutoffs`

### Qué cambié
- Backend (commit aparte 47955ae3): `CobrosService` (summary + detail por bucket)
  inyectado en `GET /admin/dashboard/metrics-v2` (campo `cobros`) + endpoints
  `GET /admin/dashboard/cobros/:bucket?range=`. Reusa `deriveRenewalState`.
- Frontend `PremiumDashboard.tsx`: reemplazadas las 3 tarjetas (MRR / Tasa
  cancelación / Comisiones pendientes) por **🔴 Próximos cobros / 🟢 Procesados /
  🟡 No procesados**, clickeables → modal drill-down con filtros de rango
  (hoy/7/15/30d) y tabla por bucket. Se quitó el componente `Kpi` (sin uso).

### Qué toqué de PRODUCCIÓN
- Nada. Falta desplegar backend + frontend.

### Qué falta
- [ ] Desplegar (backend ya tiene el feed; frontend muestra las tarjetas).
- [ ] Fase 3 (SMS alertas de cobro a los 3 números) + Fase 4 (columna comisiones
      en Pagos por fuera) del proyecto de renovaciones — aún pendientes.

## 2026-08-31 — Fix sistémico "atribución tardía → sin comisión" (SIN DESPLEGAR)

**Máquina/quién:** máquina de Jhon (Claude) · Rama `feat/commissions-auto-cutoffs`

### Qué cambié
`assignAffiliate` (`referrals.service.ts`): al asignar un afiliado a un negocio
que YA pagó (ACTIVE + lastChargeAt + ciclo vigente), ahora **genera la comisión
del periodo** vía `generateCommissionsForPayment` (idempotente por la
UNIQUE(referralUseId,recipientCodeId,periodKey)). Antes, si el pago Hotmart
entraba ANTES de asignar el afiliado (caso CHANFLE, 15h de diferencia), la
comisión nunca se creaba y asignarlo a mano no la generaba retroactivamente.
Gate: solo ACTIVE con pago real y ciclo vigente (nunca trials ni suspendidos).
TSC + ESLint + 35 tests OK.

### Qué toqué de PRODUCCIÓN
- Nada. Falta desplegar backend para que aplique.

### Qué falta
- [ ] Desplegar backend.
- [ ] Fases 3-5 del dashboard de cobros (SMS alertas, columna comisiones,
      instalar dashboard) — Fase 5 backend (CobrosService) quedó a medias sin
      commitear en `admin-reports/`. F4 Movimientos (Contabilidad) también.

## 2026-08-31 — Cortes: flujo de pago POR PERSONA + comprobantes + SMS · CHANFLE (SIN DESPLEGAR)

**Máquina/quién:** máquina de Jhon (Claude)
**Rama:** `feat/commissions-auto-cutoffs`

### Qué cambié
**Flujo de pago por persona en el cierre de corte** (los giros no son
instantáneos): recibir el dinero → pagar a cada persona con su comprobante →
recién ahí se habilita cerrar. Cada evento manda SMS interno a **+12125550752**.
- Esquema: `PayoutBatch.receivedAt/receivedProofUrl/…` + tabla nueva
  `BatchPersonPayment` (pago por persona con comprobante). Migración
  `apply-batch-person-payment-migration.cjs` (aditiva, idempotente).
- Backend `cutoff.service`: `markBatchReceived`, `markPersonPaid` (pone sus
  comisiones PAID + registra el pago), `batchPayoutStatus` (checklist), SMS al
  cerrar, `testPayoutSms`. Endpoints en `referrals.controller`
  (mark-received, pay-person, payout-status, payout-alerts/test).
- SMS interno: `PreregAlertsService.sendInternalAlert(phone, body)` (reusa la
  subcuenta GB del equipo, sin anti-dup). **Botón "🧪 Probar SMS"** en el modal.
- Comprobantes: reusa `<FileUploader>` → `/media/upload` → proofUrl.
- Frontend: `CloseBatchModal` rehecho (recibido + checklist por persona con
  subida de comprobante + cierre bloqueado hasta pagar a todas). 40 tests cortes OK.

**CHANFLE** (comisión no generada por atribución tardía): script
`fix-chanfle-missing-commission.cjs` — genera $6.80 (base canónica $68×10%,
subPrice null), businessDate=fecha del pago, hold hasta 2026-09-09, PENDING.

### Qué toqué de PRODUCCIÓN
- **Nada aún.** No corrí la migración ni los scripts, no desplegué.

### Qué falta / qué hay que validar del otro lado
- [ ] Correr `apply-batch-person-payment-migration.cjs` ANTES del deploy (el
      código consulta las columnas/tabla nuevas).
- [ ] Correr `fix-chanfle-missing-commission.cjs`.
- [ ] Desplegar backend + frontend (todo lo del día: Fase 2, fix availableAt, UI
      de cortes, flujo de pagos).
- [ ] Probar el SMS con el botón "🧪 Probar SMS" del modal (a +12125550752).
- [ ] PENDIENTE: fix sistémico "atribución tardía → sin comisión" (generar la
      comisión al asignar un afiliado a un negocio ya pagado).

### Riesgos y avisos
- `closeBatch` sigue siendo compatible (paga lo que reste + cierra); el bloqueo
  hasta pagar a todos lo hace el frontend. El SMS al cerrar es best-effort.

## 2026-08-31 — Comisiones UI: columnas, orden, filtro por desbloqueo, "Corte N" (SIN DESPLEGAR)

**Máquina/quién:** máquina de Jhon (Claude)
**Rama:** `feat/commissions-auto-cutoffs`

### Qué cambié (frontend + backend, aditivo)
- **Tabla avanzada** (`commissions/page.tsx`): ocultadas 3 columnas (DÍAS REST.,
  FECHA DE PAGO, y la de acciones "marcar pagada/habilitar" — ya no se marca a
  mano, se desbloquea solo). La fecha ahora va **bajo el badge de estado**: si
  PAGADA → paidAt; si no → availableAt (desbloqueo). colSpans recalculados 11→8.
- **Filtro por desbloqueo:** nuevo tipo de fecha `available` (availableAt) en el
  filtro avanzado (backend `listAdminCommissions` + frontend selector). Así "del
  15 al 31 de ago" muestra las desbloqueadas en ese rango.
- **Orden por fecha:** el detalle por persona (Corte actual) ahora ordena las
  comisiones por fecha de compra ascendente (venían por createdAt, desordenadas).
- **"Corte N" (1..24/año):** helper `cutoffLabel` en backend `cutoff-calendar.ts`
  y espejo `cutoffLabelFromCode` en frontend. Aplicado al modal de cierre y al
  historial (el `code` interno "CORTE-2026-08-15" NO cambia, solo la etiqueta).

### Qué toqué de PRODUCCIÓN
- **Nada.** Aditivo, sin migración. No desplegado.

### Qué falta / qué hay que validar del otro lado
- [ ] FALTA (grande): flujo de pago POR PERSONA en el cierre de corte — marcar
      recibido/pagado por persona con comprobante (reusar `CommissionPayout` +
      `/media/upload` + `payouts.service.adminMarkPayoutPaid`), cierre bloqueado
      hasta pagar a todos, SMS interno a +12125550752 por evento (reusar
      `prereg-alerts.sendTeamAlert`) + SMS de prueba.
- [ ] BUG detectado (CHANFLE): comisión NO generada porque la atribución al
      afiliado se creó 15h DESPUÉS del pago Hotmart (la generación corre en el
      pago). Patrón "atribución tardía → sin comisión". Falta: (a) generar la de
      CHANFLE, (b) fix sistémico (al asignar afiliado a un negocio ya pagado,
      generar la comisión del periodo).

## 2026-08-31 — Comisiones: fix del desbloqueo (availableAt) mal calculado (SIN DESPLEGAR)

**Máquina/quién:** máquina de Jhon (Claude)
**Rama:** `feat/commissions-auto-cutoffs`

### Qué cambié
Causa raíz de comisiones que se desbloqueaban ~40-50 días tarde y caían en el
corte equivocado (casos Motilart 22-jul→14-sep, Quipao 15-jul→30-ago): el helper
`holdReleaseFrom` (en `referrals.service.ts` y su espejo en `hotmart.service.ts`)
tenía un **clamp** que, si el cobro era >2 días viejo, re-anclaba `availableAt` a
HOY. Pero `businessDate` se guarda con la fecha CRUDA del cobro → cuando una
renovación se creaba tarde (webhook demorado / cron de reintentos), los dos
DIVERGÍAN. **Quité el clamp**: el desbloqueo se ancla SIEMPRE a la fecha real del
cobro (`availableAt = businessDate + 15d`). El clamp protegía una heurística de
FECHA hoy obsoleta (businessDate ya es la fecha durable). 64 tests verdes.

El sistema de cortes YA es el modelo del dueño (quincenal, 24/año, auto-desbloqueo
por availableAt, historial al cerrar) — el bug solo empujaba al corte equivocado.

### Qué toqué de PRODUCCIÓN
- **Nada aún** (solo diagnósticos de lectura). El fix de código NO está desplegado.

### Qué falta / qué hay que validar del otro lado
- [ ] Desplegar backend (fix de `holdReleaseFrom`) para que no se repita.
- [ ] Correr el backfill de datos existentes:
      `railway run node scripts/backfill-availableat-from-businessdate.cjs`
      (recalcula availableAt=businessDate+15 en comisiones NO pagadas; arregla
      Motilart y otras). Es DISTINTO del `fix-commission-availableat.cjs` viejo
      (ese usa createdAt+15, que era parte del problema — NO usarlo).
- [ ] Correr `scripts/fix-quipao-commission-order.cjs` (intercambio Quipao 15-jul
      Pagada $5.00 / 1-ago Disponible $5.00).
- [ ] PENDIENTE de diseño con el dueño: renombrar cortes a "Corte 1..24" y que el
      filtro avanzado use availableAt (desbloqueo) en vez de businessDate.
- [ ] Investigar por qué Quipao calcula $4.95 en vez de $5.00 (base de comisión).

### Riesgos y avisos
- Quitar el clamp hace que availableAt de renovaciones viejas nazca en el pasado
  (correcto: su hold ya venció). Las filas fantasma que el clamp "tapaba" las
  maneja la anulación de renovación fantasma, no este helper.

## 2026-08-31 — Renovaciones Fase 2: estados de renovación (SIN DESPLEGAR)

**Máquina/quién:** máquina de Jhon (Claude)
**Rama:** `feat/commissions-auto-cutoffs`

### Qué cambié
Derivación PURA del estado del ciclo de cobro (`deriveRenewalState` en
`src/billing/dunning.ts`), que **reusa `decideDunning`** para que el estado
MOSTRADO y la decisión de SUSPENDER salgan de la misma regla. Estados:
`TRIAL | AL_DIA | COBRO_PROXIMO (≤7d) | EN_GRACIA (Día X de 5) | SUSPENDIDO |
CANCELADO`. Devuelve `graceDaysLeft`, `graceLabel` ("Día 4 de 5"), `pauseDate`,
`nextChargeAt`. Cableado en `billing.getStatus()` → nuevo campo `renewal` que
sale por `GET /billing/status` (lo que consume el panel del negocio). +12 tests
nuevos (24 en total en `test/dunning.test.ts`, verdes).

Detalle fino que costó un test: la mora se detecta por `dueSince`, NO por la
`action` de dunning — en los días intermedios de gracia (3,4,5) no toca mandar
SMS (action='none') pero el negocio SÍ está en gracia.

### Qué toqué de PRODUCCIÓN
- **Nada.** Aditivo, sin migración (usa los campos de la Fase 1 ya migrados).
  No desplegado: nada lo consume aún hasta el dashboard (Fase 5).

### Qué falta / qué hay que validar del otro lado
- [ ] Desplegar junto con Fase 5 (dashboard) — o solo, es inocuo.
- [ ] Fases 3 (SMS), 4 (comisiones pago por fuera), 5 (dashboard) pendientes.

### Riesgos y avisos
- `getStatus` ahora hace un `getGraceDays()` extra (lee Setting `billing.graceDays`)
  — query barata, y no está en un guard por-request (solo en `GET /billing/status`).

## 2026-08-31 — Renovaciones/suspensión Fase 1: fix "no suspende al día 6" (DESPLEGADO)

**Máquina/quién:** máquina de Jhon (Claude)
**Rama / commit:** `feat/commissions-auto-cutoffs` · `dc56ebcd`

### Qué cambié
Arreglo de raíz del bug "un negocio con cobro fallido nunca se suspende".
Auditado con datos de prod (solo lectura). Eran **dos** causas encadenadas:

1. **El reloj de gracia se anclaba en `lastPaymentAttemptAt`**, que Hotmart pisa
   a `now` en CADA reintento (`PURCHASE_DELAYED`) → la mora volvía a 0 días y
   nunca llegaba al umbral. **Fix:** nuevo campo INMUTABLE `Tenant.firstFailedAt`
   (se fija solo en el 1er fallo, se limpia al confirmarse pago). El dunning
   cuenta desde ahí.
2. **El cron de créditos (2 AM) tapaba la falla.** Los **77 negocios de Clubify**
   cuelgan de la marca `clubify` con `creditsUnlimited` → ese cron los renovaba
   GRATIS cada ciclo, empujaba `currentPeriodEnd` al futuro, y el pre-check del
   dunning ("falla + ciclo vigente = stale") borraba el fallo antes del día 6.
   **Fix:** el cron de créditos ahora **omite la marca `clubify`** (pagan real
   por Hotmart → los gobierna el motor de dinero, fuente única).

Además, por decisión del dueño (2026-08-31):
- **Gracia unificada a 5 días**; se suspende al **día 6** (antes `>=graceDays`,
  ahora `>graceDays`; default 3→5).
- **El pago por fuera (manualPayment) YA NO se exime**: mismos 5 días de gracia y
  auto-suspensión al día 6 (ancla = fecha de vencimiento). Sigue en la lista de
  revisión manual.

Regla de mora extraída a función **pura y testeable** `src/billing/dunning.ts`
(`decideDunning`) con 12 tests de reloj congelado que fijan el día-5-gracia /
día-6-suspende y la inmutabilidad del ancla ante reintentos.

Archivos: `prisma/schema.prisma` (+`firstFailedAt`), `src/billing/dunning.ts`
(nuevo), `src/billing/billing.service.ts` (motor de mora), `hotmart.service.ts`,
`stripe.service.ts` (setear/limpiar ancla), `src/superadmin/renewals.service.ts`
(guard `clubify`), `test/dunning.test.ts` (nuevo),
`scripts/apply-first-failed-at-migration.cjs` (nuevo).

### Qué toqué de PRODUCCIÓN
- **Migración aplicada** (`railway run node scripts/apply-first-failed-at-migration.cjs`):
  columna `Tenant.firstFailedAt` creada, **4** morosos en vuelo con ancla
  backfilleada, Setting `billing.graceDays` fijado en **5** (no existía).
- **Backend desplegado** (`node scripts/desplegar.cjs backend`, commit `dc56ebcd`).
  Swap verificado: deployment ID `87eac06d` (coincide con el build), Online.
- Al desplegar había **0** negocios de Clubify vencidos/con fallos → no se
  suspendió a nadie de golpe.

### Qué falta / qué hay que validar del otro lado
- [ ] **Primera prueba real:** cuando un cobro de Hotmart falle de verdad, el
      cron de mora (3 AM) debe suspender al día 6. Vigilar el primer caso.
- [ ] Fases 2-5 pendientes: estados de renovación, **SMS de alerta** a los 3
      números desde +573167689240 (falta saber qué subcuenta GrowBusiness tiene
      ese número), columna de comisiones en Pagos por fuera, y el nuevo dashboard
      de cobros (preview ya aprobado).

### Riesgos y avisos
- Hoy en prod hay **0 negocios de Clubify vencidos y 0 con fallos**, así que el
  guard del cron de créditos **no suspende a nadie de golpe**: de aquí en
  adelante, cuando un Hotmart falle de verdad, el dunning suspenderá al día 6.
- **STRIPE/Sellea** tiene el mismo patrón de "créditos que tapan", pero su marca
  SÍ tiene créditos reales — **no lo toqué**; hay que entender el cobro
  Clubify←marca antes. Queda señalado.
- Cuentas internas/comp de Clubify sin Hotmart activo podrían quedar expuestas a
  la suspensión por fecha cuando venzan (mitiga: `manualPayment` o el tope legacy
  de 60 días). Ninguna está vencida hoy.
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

## 2026-08-30 — CONTABILIDAD Fase 3 (Nómina) (Jhon)
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** feat/commissions-auto-cutoffs

### Qué cambié (aditivo)
- Modelos `PayrollEmployee` + `PayrollRun` + `PayrollItem` + enum `PayrollStatus`.
  Pagar la nómina genera UN corte con su detalle (items), no N egresos.
- `PayrollService`+`PayrollController` (`/admin/contabilidad/nomina/*`):
  colaboradores, generar corte con bonos/deducciones, pagos parciales, resumen.
- Frontend: pestaña **Nómina** en `/admin/contabilidad`.

### 🚨 ANTES de desplegar (esta sesión no escribe a prod DB)
Desde `~/Documents/AGENTES/CLUBIFY/backend` con `DATABASE_PUBLIC_URL` exportada:
- [ ] `node scripts/apply-payroll-migration.cjs`  (crea 3 tablas de nómina)
- [ ] Desplegar backend + frontend con `desplegar.cjs`.

### Estado del módulo
F1 (Ingresos) + F2 (Egresos) YA LIVE. F3 lista para migrar+deploy. Faltan F4
Movimientos, F5 Cierres, F6 Dashboard. Ver
[[project_contabilidad_central_module_2026_08_30]].

---

## 2026-08-30 — CONTABILIDAD Fase 2 (Egresos) + backfill de ingresos (Jhon)
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** feat/commissions-auto-cutoffs

### Qué cambié (aditivo, no toca comisiones)
- **Fase 2 Egresos:** modelos `Expense`+`ExpenseCategory`+`RecurringExpense` +
  enum `ExpenseStatus` (PENDING/REVIEW/PARTIAL/PAID). `ExpenseService`+
  `ExpensesController` (crear egreso fijo O por %, pagos parciales, "por revisar",
  categorías, gastos recurrentes). Endpoints `/admin/contabilidad/egresos`,
  `/categorias`, `/gastos-recurrentes`. Frontend: pestañas **Egresos** y **Gastos
  operativos** en `/admin/contabilidad` (modal fijo/% + registrar pago parcial).
- **Backfill:** `backfill-income-records.cjs` llena IncomeRecord desde el
  histórico ya existente (ManualPayment + CrossTransaction reales + último cobro
  por negocio desde `Tenant.lastPaymentAmountUsd`, marcado "estimado").

### 🚨 ORDEN antes de desplegar (esta sesión no escribe a prod DB)
Correr desde `~/Documents/AGENTES/CLUBIFY/backend` (ya linkeado a Railway), con
`export DATABASE_PUBLIC_URL=...` (ver comando en el header de cada script):
- [ ] 1) `node scripts/apply-expenses-migration.cjs`  (crea tablas de egresos)
- [ ] 2) `node scripts/backfill-income-records.cjs`   (llena ingresos históricos)
- [ ] 3) Desplegar backend + frontend con `desplegar.cjs`.

### Estado Fase 1
Ya LIVE (migración IncomeRecord aplicada + deploy). Los cobros nuevos ya capturan
ingreso real. Ver [[project_contabilidad_central_module_2026_08_30]].

---

## 2026-08-30 — CONTABILIDAD Fase 1: IncomeRecord (ingreso real por transacción) (Jhon)
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** feat/commissions-auto-cutoffs (commit de Fase 1)

### Contexto
Arranca el módulo central Contabilidad (aprobado por el dueño). Fase 1 = el
cimiento: guardar el ingreso REAL por cobro con desglose bruto/fee/impuesto/neto.
Antes solo existía `Tenant.lastPaymentAmountUsd`, que se sobrescribe cada ciclo y
descarta fee/impuesto → sin histórico. El preview navegable está en
`~/Desktop/Contabilidad-Clubify-Preview.html`.

### Qué cambié (todo ADITIVO, no toca comisiones)
- `schema.prisma`: modelo **IncomeRecord** + enum **IncomeReconStatus**. Ids
  planos (sin relación Prisma) → no toca Tenant/WhiteLabel.
- `scripts/apply-income-record-migration.cjs`: crea tabla+enum+índices
  (idempotente, IF NOT EXISTS) y siembra tasas (fee 8.6% Hotmart, 3.5% Stripe,
  5% Cross, 0% Manual, impuesto 19%, taxBase gross).
- `src/finance/`: `IncomeRecordService` (captura best-effort, dedup por
  `(gateway, externalTxId)`, salta $0 de prueba) + `FinanceController`
  (`GET /admin/contabilidad/ingresos`, `/ingresos/resumen`,
  `PATCH /ingresos/:id/conciliar`).
- Wire en los 4 webhooks: Stripe (`activate`), Hotmart (`activatePurchase`),
  Cross (`activate`), Manual (`tenants.service` tras commit, solo USD).
- Frontend: `/admin/contabilidad` (Resumen + Ingresos + Conciliación, datos
  reales) + menú **Finanzas → Contabilidad** (clubifyOnly).

### 🚨 Qué falta ANTES de desplegar (ORDEN OBLIGATORIO)
- [ ] **1) Correr la migración en prod** (crea la tabla; esta sesión no escribe
      a prod DB):
      `cd backend && export DATABASE_PUBLIC_URL="$(railway variables --service Postgres-Nq8w --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["DATABASE_PUBLIC_URL"])')" && node scripts/apply-income-record-migration.cjs`
- [ ] **2) Verificar** que `IncomeRecord` existe (el script lo imprime).
- [ ] **3) Desplegar** backend + frontend con `desplegar.cjs`.
      (Si se despliega ANTES de la migración: los `record()` son best-effort con
      catch → no crashea, pero se pierden ingresos hasta que exista la tabla, y
      `/admin/contabilidad` da 500.)

### Próximas fases (no empezadas)
F2 Egresos/Categorías/Recurrentes · F3 Nómina · F4 Movimientos+Conciliación
avanzada · F5 Cierres inmutables+reporte · F6 Dashboard+cuentas por cobrar/pagar.
Ver [[project_contabilidad_central_module_2026_08_30]].

### Riesgos
- Multi-moneda: pagos manuales en COP se saltan (solo USD por ahora). Stripe/
  Hotmart/Cross ya vienen en USD.
- Hotmart income va como whiteLabelId null (Clubify); Stripe/Cross llevan su
  whiteLabelId. El panel filtra `scope=clubify` (whiteLabelId null) por defecto.

---

## 2026-08-30 — Sellea: ciclo de prueba de 7 días (día 0 demo, día 7 activo+crédito) (Jhon)
**Máquina/quién:** Jhon (máquina de Jhon)
**Rama / PR:** feat/commissions-auto-cutoffs (commit ebf6551c)

### Contexto
El Payment Link de Stripe de Sellea SÍ tiene `trial_period_days=7` (confirmado
por el dueño), pero la activación no lo honraba: marcaba ACTIVE y vencía en 1
MES. El dueño quiere: día 0 = cuenta DEMO/prueba con vencimiento a 7 días (sin
cobrar, sin crédito); día 7 = Stripe cobra → ACTIVE + consume 1 crédito Fidelity.

### Qué cambié (`billing/stripe.service.ts` `activate`)
- `inTrial = ctx.trialEnd > now`. Si está en prueba: `status='TRIAL'`,
  `trialEndsAt = currentPeriodEnd = trial_end` (7 días), NO cobra, NO consume
  crédito, NO genera comisiones, NO emite business.activated. SMS nuevo
  `trial_started` ("en N días (fecha) se hace el primer cobro").
- Día 7 (invoice.paid, monto>0, trial_end pasado): cae a la rama normal →
  ACTIVE + `consumeTrialConversionCredit` (ya existía) + comisiones + vence al
  próximo período real.
- `billing.service.getStatus` expone `paidTrial` (TRIAL + con suscripción Stripe
  = tarjeta anclada). La página de facturación muestra "Prueba activa · primer
  cobro el <fecha>" SIN el CTA de "activar" (ese es para la prueba GRATIS sin
  tarjeta). El panel admin ya muestra TRIAL + fecha (VENCE = currentPeriodEnd).
- `/activar` (front): el precio ahora sale del plan de la MARCA
  (`payment-links-by-host`, USD 80), no del global de Clubify (`landing-plans`,
  USD 68).

### Qué toqué de PRODUCCIÓN
- Deploy backend + frontend. Sin migración, sin DB (usa status TRIAL +
  trialEndsAt que ya existían de la prueba gratis).

### Qué falta / validar del otro lado
- [ ] E2E real: compra con el enlace de prueba → verificar día 0 = TRIAL/vence
      7 días + SMS "en 7 días"; y el cobro del día 7 → ACTIVE + -1 crédito.
- [ ] La detección del trial depende de que `extractCtx` pueda LEER la
      suscripción de Stripe (retrieve). Si el retrieve falla, `trialEnd` queda
      null y caería a ACTIVE+1 mes (como el test viejo). Vigilar el warn
      "retrieve subscription ... falló".

### Riesgos y avisos
- `status=TRIAL` se comparte con la prueba GRATIS (5 días sin tarjeta). El
  discriminador es `stripeSubscriptionId` (→ `paidTrial`). Cualquier pantalla que
  trate TRIAL como "esperando pago" debe chequear `paidTrial` (ya hecho en
  billing). El cron de trials free (recordatorios) NO debe pausar a un paidTrial:
  revisar si algún cron suspende TRIAL vencido sin mirar la suscripción.

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

## 2026-09-01 (tarde) — Team Clubify: color por agenda + las fotos entran en el momento (Jhon)
**Máquina/quién:** Jhon (Mac)
**Rama / PR:** `team_clubify` · `feat/automations-engine-audit` · commits `0de54a0` y `54a7ac6` · desplegado

### Qué cambié
- **Color por agenda.** Con varias agendas por equipo, en el banco y el calendario
  se veían todas iguales. Lo que faltaba de raíz: **una cita no guardaba de qué
  agenda venía** (`CloserMeeting.booking_config_id`, nuevo). El distintivo es una
  **barra de color a la izquierda**, no un punto: el punto ya lo usa el semáforo de
  confirmación (🟢🟡🔴⚪) y dos significados en el mismo símbolo no se leen. El
  nombre de la agenda sale solo cuando hay más de una a la vista.
- Una agenda nueva toma sola un color libre del equipo: si nacieran todas verdes,
  distinguirlas dependería de que alguien se acuerde de cambiarlo.
- **Las fotos entran en el momento.** Quedaba pendiente del arreglo del 27-ago: la
  imagen solo aparecía cuando el barrido volvía a pasar por el chat. Ahora el
  webhook lee los adjuntos en las dos direcciones. Además, un mensaje **sin texto**
  (solo imagen) se descartaba antes de guardarse (`if (!text) return`), y el dedup
  por texto fusionaba dos fotos distintas porque las dos tienen el cuerpo vacío.
- La limpieza del cuerpo (`type message: image`, `#switch_unique`) se movió a
  `lib/server/provider-message.ts` y la usan los DOS caminos: cuando solo la hacía
  el importador, el mismo mensaje se guardaba distinto según por dónde entró.

### Qué toqué de PRODUCCIÓN
- **Base de datos (aditivo):** `BookingConfig.color`, `CloserMeeting.booking_config_id`
  (+ índice) con `scripts/add-agenda-colors.cjs`. El script rellena hacia atrás de
  qué agenda vino cada cita **solo donde la respuesta es cierta**: la segunda
  agenda de un equipo recién es posible desde hoy, así que toda cita anterior vino
  de la primera de su equipo. 7 de 8 quedaron marcadas.
- **Despliegue:** `vercel --prod` desde `team_clubify/`. 200 en team.soyclubify.com.

### Qué falta / qué hay que validar del otro lado
- [ ] La cita que quedó sin agenda de origen es de un equipo con dos agendas: se
      queda sin barra de color hasta que alguien la reasigne a mano. No inventé
      cuál era.
- [ ] Sigue en pie lo de **Nico con rol global `admin`** (ve y administra los
      cuatro equipos) y las **tres variables vacías de Railway**.

### Riesgos y avisos
- Verificaciones repetibles, las dos reversibles y contra la base real:
  `npx tsx scripts/verify-agenda-colors.ts` (dos agendas del mismo equipo tienen
  colores distintos y la cita llega pintada a banco y calendario) y
  `npx tsx scripts/verify-inbound-attachments.ts` (la foto entra con su imagen y
  dos fotos distintas no se fusionan; usa un número inexistente y va por el camino
  saliente, que no dispara flujos).

## 2026-09-04 — Team Clubify: agenda, seguimientos y el flujo de reagendar (Jhon)
**Máquina/quién:** Jhon (Mac)
**Rama / PR:** `team_clubify` · `feat/automations-engine-audit` · desplegado

### Qué cambié
- **Color de la cita = ASISTENCIA**, no resultado. Una reunión `realizada` es
  verde aunque nadie hubiera pulsado «confirmar» antes — eso la dejaba en gris,
  igual que una que ni se sabía si iba a ocurrir. El semáforo dice «Asistió» /
  «No asistió» cuando ya pasó. Y **«Registrar resultado» desaparece** con el
  cierre ya cargado o si la cita se canceló: antes se escribía encima.
- **Fuera Comisiones e IA Comercial** de las pestañas de los 4 equipos (Javier
  hizo lo mismo en paralelo, `c4ae6c9`). Sus rutas redirigen al Resumen en vez de
  borrarse, para que un enlace viejo no dé 404.
- **Seguimientos:** la columna «Responsable» pasa a **«Closer»** y muestra al que
  ATENDIÓ la reunión (la realizada más reciente del contacto), no al responsable
  temporal del paso. **«Abrir chat» abre un popup con forma de teléfono** encima
  de la lista, con «Ver contacto» dentro: se lee, se responde y se sigue sin
  salir de la sección.
- **Ver contacto:** oculto «Transferir a otro equipo»; y «Responsable» de una
  tarea ofrece **solo la gente de ESE equipo** (aparecía Eudes en el de Nico).
  Los nombres de tareas ya asignadas se siguen resolviendo contra todos los
  usuarios: quien salió del equipo tiene que seguir mostrando su nombre.
- **Reagendar desde el reporte de la reunión** (lo grande): botón que abre el día
  completo (6:00–22:30) **sin las reglas del embudo público** —antelación, días
  hábiles, cupo, horario— porque la hora la pacta el closer en la llamada; solo
  se respeta que no haya dos reuniones suyas a la vez. Al reagendar salen tres
  mensajes: aviso del cambio → reconfirmación con los dos botones → **la sala 5
  minutos antes, conteste o no**. Si contesta «Sí» queda `confirmed_at` (lo que
  lee el semáforo); si pide reagendar, aviso a la coordinación.

### Qué toqué de PRODUCCIÓN
- **Base de datos (aditivo, ya aplicado):**
  `node scripts/add-meeting-reconfirm.cjs` → `CloserMeeting.reconfirm_asked_at`,
  `reconfirm_reply`, `meet_link_sent_at` + índice.
- **Cron nuevo:** `/api/cron/meet-link` **cada minuto** (en `vercel.json` y en
  `lib/cron-jobs.ts`). Con uno de 15, «5 minutos antes» sería entre 5 y 20.
- Despliegues con `vercel --prod` desde `team_clubify/`.

### Qué falta / qué hay que validar del otro lado
- [ ] La reconfirmación va **sin firma personal**: el workflow del que salieron
      los textos dice «Nico por acá» y acá corre para los cuatro equipos. Si se
      quiere firmar por equipo, sale del responsable — está sin hacer.
- [ ] Este flujo **solo** alcanza a las citas reagendadas a mano
      (`reconfirm_asked_at`). Las de la agenda pública las sigue atendiendo su
      workflow; si se toca eso, ojo con el doble envío.

### Riesgos y avisos
- **Al probar envíos, el proveedor ACEPTA números inexistentes** y el saliente
  vuelve por webhook: en una corrida apareció el mensaje duplicado en el hilo.
  Las pruebas usan `+5700000001xx` y borran lo que crean, pero conviene saberlo.
- Verificaciones repetibles: `npx tsx scripts/verify-reconfirm-flow.ts` (las dos
  ramas, la sala una sola vez aunque el cron repita, y que un mensaje cualquiera
  no se tome como respuesta).

## 2026-09-03 — Team Clubify: el formulario del lead en la agenda y en todas las reuniones (Jhon)
**Máquina/quién:** Jhon (Mac)
**Rama / PR:** `team_clubify` · `feat/automations-engine-audit` · commits `ecfca7c`…`+2` · desplegado

### Qué cambié
- **Agenda del equipo:** abrir una reunión mostraba fecha, teléfono y poco más.
  Para saber si el lead venía calificado había que salir del calendario, buscar el
  contacto y abrir su ficha — con la decisión de asignar o reagendar esperando.
  Ahora el modal trae las **respuestas del formulario** y los botones de Sala de
  Meet / WhatsApp / Llamar, encima de las acciones de siempre.
- **Vista del closer:** el formulario solo se veía en la reunión destacada; a las
  demás del día se entraba a ciegas. Cada fila tiene ahora su botón, sin quitarle
  a la fila su acción principal (registrar el resultado).
- La tarjeta se extrajo a `LeadFormCard` y la usan las **dos** pantallas. La
  lectura de las respuestas (resolver el código de la opción a su texto y su
  puntaje) vive ahora en `lib/server/form-answers.ts`, en un solo sitio.
- **Rendimiento:** el modal se quedaba en «Cargando…» varios segundos porque pedía
  el historial COMPLETO del lead para mostrar solo el formulario. Ahora se pinta
  lo que ya se tiene (la ficha viene con la cita) y solo viajan las respuestas.
  Medido contra la base remota: cabecera **>4 s → ~85 ms**, respuestas
  **~1,9 s → ~880 ms**. Esqueleto en vez de la palabra «Cargando…».

### Qué toqué de PRODUCCIÓN
- Solo despliegue (`vercel --prod` desde `team_clubify/`). Sin cambios de esquema.
- `MeetingLite` ganó `meet_url` (el campo ya venía de la base; faltaba en el tipo).

### Qué falta / qué hay que validar del otro lado
- [ ] Los ~880 ms se midieron desde la máquina de Jhon contra Railway, con el
      tramo de red más largo que el real. Conviene confirmarlo usándolo.

### Riesgos y avisos
- `getLeadHistory` sigue existiendo para la ficha completa; la que hay que usar
  para mostrar el formulario es `getLeadFormAnswers` (o `getLeadFormCard` si no se
  tiene la ficha). Si se vuelve a la pesada, vuelven los segundos en blanco.

## 2026-09-03 — Team Clubify: instalable como app + revisión de móvil completa (Jhon)
**Máquina/quién:** Jhon (Mac)
**Rama / PR:** `team_clubify` · `feat/automations-engine-audit` · commit `8b6007b` · desplegado

### Qué cambié
Revisión de móvil **medida, no a ojo**: se abre cada pantalla a 390×844 y se
reporta la que se sale. Importa porque la carcasa **recorta** el desbordamiento
(`overflow-x-hidden` en `<main>`): lo que se sale **no se alcanza desplazando**,
es un botón al que no se llega. Eran **6 de 51**; ahora **0 de 63**.

- **Instalable como app** (antes no existía ni `public/`): `manifest.webmanifest`
  con `display: standalone` y atajos, iconos 192/512/maskable/apple-touch,
  `theme-color`, `apple-mobile-web-app-*`, `viewport-fit=cover`. El manifiesto
  tuvo que hacerse **público en el middleware**: protegido devolvía la redirección
  al login y el navegador nunca ofrecía instalar.
- **Carcasa:** `h-screen` → `h-[100dvh]`. En el teléfono `100vh` incluye la barra
  de direcciones que se pliega, así que la carcasa era más alta que lo visible y
  la última fila de CUALQUIER pantalla quedaba cortada. Más zonas seguras del
  iPhone (muesca y barra de gestos).
- **Lo que estaba cortado:** Banco, Workflows y Biblioteca (la fila de botones no
  envolvía); Configuración de la agenda (una celda de rejilla crece hasta su
  contenido más ancho — el desplegable de zona horaria estiraba la tarjeta a
  437 px en 390); constructor de formularios (`min-w-[200px]` dejaba «Guardar»
  fuera); rangos horarios por día; calendario de Contenido (7 columnas = 50 px por
  día → en móvil pasa a **agenda**, la rejilla vuelve en tablet).
- **Uso con el dedo:** «Salir» era el ícono pelado de 20×20 en TODAS las
  pantallas; botón compacto 32→36 px en móvil; casillas 13→18 px solo con puntero
  grueso; campos a 16 px en móvil (por debajo, Safari hace zoom al enfocar y **no
  vuelve**).

### Qué toqué de PRODUCCIÓN
- Solo despliegue: `vercel --prod` desde `team_clubify/`. Sin cambios de esquema.
- Verificado en producción: `/manifest.webmanifest` y los iconos responden 200.

### Qué falta / qué hay que validar del otro lado
- [ ] Quedan ~1.380 controles por debajo de 36 px de alto (papeleras de 27×24,
      «← Volver» de 61×20, enlaces de texto dentro de listas). Los globales ya
      están; el resto es cola larga pantalla por pantalla.
- [ ] Las tarjetas de métricas ocupan mucho alto en el teléfono (en Contenido, las
      cinco llenan la primera pantalla). Es densidad, no rotura: decisión de diseño.
- [ ] Para que se sienta app de verdad falta **service worker** (abrir sin red) y
      **notificaciones push**. No lo hice: cambia el ciclo de despliegue y conviene
      decidirlo aparte.

### Riesgos y avisos
- Los campos a 16 px en móvil **cambian la densidad** de los formularios en
  teléfono. Es a propósito: es la única forma de que Safari no haga zoom.
- Herramienta repetible: `node scripts/auditar-movil.mjs scripts/rutas-movil.json`
  (pide `npm i -D playwright`; entra con una sesión firmada con `AUTH_SECRET` y
  **solo lee**). Correrla antes de dar por buena cualquier pantalla nueva.

## 2026-09-01 — Team Clubify: varias agendas por equipo + el líder administra la suya (Jhon)
**Máquina/quién:** Jhon (Mac)
**Rama / PR:** `team_clubify` · `feat/automations-engine-audit` · commit `ecfca7c` · desplegado

### Qué cambié
- **Un equipo puede tener varias agendas de reserva.** Lo impedía un índice ÚNICO
  sobre `BookingConfig.sales_team_id`: la base rechazaba la segunda. Cada agenda
  tiene su enlace público, su horario y su formulario. Lista en Comercial →
  equipo → Configuración: crear, configurar, abrir y eliminar. Nunca se borra la
  última; para dejar de usarla está «inactiva».
- **El cupo por horario se contaba sobre TODAS las reuniones del sistema**: si el
  equipo de Nico llenaba las 10:00, la agenda de Ecuador mostraba esa hora
  ocupada sin tener a nadie. Ahora se cuenta por equipo.
- **Borrar un formulario solo miraba la agenda `default`** → con varias, dejaba a
  las otras sin campos. Ahora mira todas.
- **Permisos:** configurar agenda, banco y formularios pedía un rol GLOBAL
  (gerente/admin/PM), así que el responsable de un equipo no podía tocar ni su
  propia agenda. Pasa a `canManageTeam` (líder de ESE equipo o administrador), el
  mismo criterio que ya usaban colaboradores y comisiones. Los formularios se
  filtran por equipo y cada acción revalida que el formulario sea de uno suyo —
  antes bastaba pasar el id de otro.

### Qué toqué de PRODUCCIÓN
- **Base de datos (Team Clubify):** `DROP INDEX BookingConfig_sales_team_id_key`
  + índice normal en su lugar, con `scripts/allow-multiple-team-agendas.cjs`
  (idempotente, no toca ninguna fila). Ya aplicado.
- **Datos:** Nico quedó `lider` de Equipo Nico y responsable del equipo
  (`scripts/set-team-lead.cjs "Equipo Nico" <email>`).
- **Despliegue:** `vercel --prod` desde `team_clubify/`. 200 en team.soyclubify.com.

### Qué falta / qué hay que validar del otro lado
- [ ] **Nico tiene rol GLOBAL `admin`** (alguien lo cambió el 1-sep). Con eso ve y
      administra los CUATRO equipos, no solo el suyo. Si la intención era «todo lo
      de su equipo y nada más», hay que bajarlo a `collaborator`: con la membresía
      de líder que ya tiene le alcanza. Decisión de Jhon, no la tomé yo.

### Riesgos y avisos
- Las agendas nuevas toman slug `agenda-v#` correlativo; el enlace es editable
  desde la pantalla, pero **cambiarlo rompe los enlaces ya repartidos**.
- Verificación repetible: `npx tsx scripts/verify-team-agendas.ts [email]` — crea
  una agenda de prueba, comprueba que resuelve su enlace público y que ofrece
  horarios, la borra, y lista qué equipos administra esa persona. Probado con un
  líder sin rol global (Eudes): administra solo el suyo, los otros tres ni los ve.

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
