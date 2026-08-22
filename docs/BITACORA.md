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
