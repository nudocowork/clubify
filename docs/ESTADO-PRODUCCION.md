# Estado de producción — leer ANTES de desplegar o migrar

> Este archivo existe porque **hay más de una máquina desplegando al mismo
> producción**. Lo que está en este repo no es necesariamente lo que corre.
> Actualízalo cada vez que descubras una divergencia.

Última revisión: **2026-09-02**

---

## 🚨 LO PRIMERO: cómo se despliega (o vas a tumbar el trabajo del otro)

**Desplegar SIEMPRE con:**

```bash
node scripts/desplegar.cjs frontend
node scripts/desplegar.cjs backend
```

**NUNCA `vercel --prod` ni `railway up` directos.**

Por qué: esos comandos suben **tu carpeta local**, no lo que está en git. Como el
repo vive en **OneDrive** (sincroniza el directorio entre las dos máquinas), tu
copia puede estar **vieja o con cambios a medias** → desplegar desde ahí
**REVIERTE en producción lo que el otro ya había subido**. `desplegar.cjs` clona
el commit limpio y **se niega a desplegar si estás por detrás de origin o tienes
commits sin empujar** — por eso es el único camino seguro.

**Antes de cualquier deploy:** `git fetch` y estar al día con origin.

> **Pasó el 2026-09-02 (dos veces el mismo día):** deploys directos desde una copia
> vieja **revirtieron** los arreglos de Sellea (frontend) y el *income capture* de
> Contabilidad + `productKey` (backend). Señal típica de que te pasó: un
> campo/ruta que ya existía **deja de existir** (el API dejó de devolver
> `productKey`; una ruta 401 pasa a 404). Cada minuto revertido, los pagos Hotmart
> en moneda local vuelven a NO entrar a Contabilidad.

---

## ⛔ Reglas duras

### 1. Nunca `prisma db push` contra producción

> Esto ya no depende de que alguien se acuerde: `backend/scripts/guard-db-target.cjs`
> aborta cualquier comando de Prisma que mute el esquema si `DATABASE_URL` no
> apunta a una base local. Está enganchado en `npm run prisma:migrate` y
> `npm run db:push`. Comprobar a qué base apuntas: `npm run db:target`.

Prisma borra lo que no está en el schema. Producción tiene tablas y **índices
únicos parciales** que el schema no puede expresar; un `db push` los elimina en
silencio y con ellos los datos.

Para cambiar el esquema en producción: **script aditivo de SQL crudo**, con
`IF NOT EXISTS`, e idempotente. Ejemplo a copiar:
`backend/scripts/apply-email-config-migration.cjs`.

### 2. Nunca desplegar sin saber qué corre hoy

El `startCommand` de Railway es `node dist/main.js` a secas: **el despliegue no
corre migraciones**. Cambiar el esquema es siempre un paso manual y deliberado.

El backend se ha desplegado con `railway up` **desde directorios locales**, no
desde git. Eso significa que producción puede tener código que no está en
ninguna rama. Desplegar desde aquí sin verificar **sobrescribe** ese código.

Antes de desplegar, comprobar quién desplegó por última vez y desde dónde:

```bash
railway status --json | grep -A3 cliCaller
```

### 3. Antes de tocar el esquema, mirar la divergencia real

```bash
# Trae el esquema real de producción a un archivo aparte y compáralo
head -8 backend/prisma/schema.prisma > /tmp/introspect.prisma
railway run npx prisma db pull --schema=/tmp/introspect.prisma
# luego compara los `model X` de ese archivo contra backend/prisma/schema.prisma
```

---

## Divergencias conocidas

### Motor de Email Marketing — SÍ está en el repo (corrección)

> Esta sección decía que el código «no está en ningún repositorio». **Era
> falso**, y sobre esa afirmación se desplegó por encima y se tumbaron tres
> rutas de producción. Se corrige el 2026-08-20.

El módulo está en GitHub desde el 2026-08-18: commit `6409bb6`, en
`feat/commissions-auto-cutoffs`. La rama que tiene **los dos trabajos** unidos y
es la que corre en producción es **`chore/merge-emails-sobre-314`**.

Rutas que aporta, para comprobar de un vistazo que no se perdieron (401 = existe
y está protegida; 404 = se cayó del build):

```
/api/admin/marketing/contacts
/api/admin/pending-payments
/api/webhooks/email-inbound/:slug
```

Tablas: `MktContact`, `MktWorkflow`, `MktWorkflowFolder`, `MktEnrollment`,
`MktAction`. Están declaradas en `backend/prisma/schema.prisma` para que un
`db push` no las borre — pero la introspección **no** pudo traer estos dos
índices, y `db push` los borraría igual:

```
MktContact_wl_email_uq      UNIQUE (whiteLabelId, email)
                            WHERE email IS NOT NULL AND NOT deleted
MktContact_wl_phoneNorm_uq  UNIQUE (whiteLabelId, phoneNorm)
                            WHERE phoneNorm IS NOT NULL AND NOT deleted
```

Sin ellos el motor empieza a duplicar contactos. (De todas formas hay un freno:
`backend/scripts/guard-db-target.cjs` aborta cualquier comando de Prisma que
mute el esquema si `DATABASE_URL` no es local.)

**Aviso de merge:** mezclar `feat/emails-sobre-314` a mano **no funciona**. Git
no marca conflicto porque cada rama agregó los modelos `Mkt*` en un lugar
distinto del schema, así que los apila (quedan 10 en vez de 5) y duplica métodos
en `grow-business.service.ts`. Usar `chore/merge-emails-sobre-314`.

---

## Cómo envía cada canal

Todo sale por la subcuenta de **Grow Business (GoHighLevel) de cada marca** —
Sellea por la de Sellea, Clubify por la de Clubify. Son subcuentas distintas y
ya vinculadas.

| Canal | Cómo sale |
|---|---|
| SMS | `GrowBusinessService.sendSmsWithCreds` — ver cascada abajo |
| WhatsApp | `GrowBusinessService.sendWhatsAppWithCreds` — ídem |
| Correo | `GrowBusinessService.sendEmailWithCreds`, `type: 'Email'` |

### Quién pone qué, en el correo

- La **firma** —logo, color, «Enviado por X», dominio de los links,
  `{supportEmail}`— sale **siempre de la marca del negocio** (`emailShell`). No
  depende del transporte. Sellea firma como Sellea, Clubify como Clubify.
- El **remitente** lo pone la subcuenta de Grow Business que transporta.

Cascada del transporte (`BrandEmailService.resolveBrand`):

1. Subcuenta **propia de la marca** (`WhiteLabel.growBusiness*`). Hoy: solo
   Sellea (`mgAdQO7Rg7KiBRxuSs6M`).
2. Si la marca es la **plataforma** (`clubify`) o el negocio no tiene marca:
   subcuenta de cobros asignada al negocio (`billingAlertsAccountId`) → subcuenta
   marcada `isDefault`. Hoy la predeterminada es la que el panel llama
   **"Reseñas"**, que en GHL es `Clubify Oficial <Contacto@soyclubify.lat>`.
3. Una **marca blanca sin subcuenta propia NO envía** (hoy: Fideliso). Es a
   propósito: un remitente `@soyclubify.com` en un correo firmado por ella
   delataría la plataforma y rompería el DMARC del dominio ajeno.

El SMS usa una cascada parecida pero **no la misma** (`resolveBillingTarget`):
ahí sí entran las credenciales propias del negocio, y la capa de marca exige el
módulo `GROW_BUSINESS_SMS` activo.

**No hay proveedor de correo propio.** En Railway **no existe**
`RESEND_API_KEY` ni ninguna variable SMTP. Cualquier código que intente mandar
por Resend no enviará nada.

Un negocio *legacy* sin marca asignada (`whiteLabelId` nulo) sale por la
subcuenta de **Clubify**.

---

## Notas de datos

- `WhiteLabel.emailConfig` (jsonb) se agregó el 2026-08-19 con un script
  aditivo. Hoy **no se usa** para enviar (el transporte es Grow Business).
- `WhiteLabel.emailFrom` sí tiene valor en Sellea
  (`Sellea <hola@selleala.com>`), pero sin proveedor Resend no envía por sí
  solo.
