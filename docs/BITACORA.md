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
