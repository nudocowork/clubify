# Estado de producción — leer ANTES de desplegar o migrar

> Este archivo existe porque **hay más de una máquina desplegando al mismo
> producción**. Lo que está en este repo no es necesariamente lo que corre.
> Actualízalo cada vez que descubras una divergencia.

Última revisión: **2026-08-19**

---

## ⛔ Reglas duras

### 1. Nunca `prisma db push` contra producción

Prisma borra lo que no está en el schema. Producción tiene tablas y **índices
únicos parciales** que el schema no puede expresar; un `db push` los elimina en
silencio y con ellos los datos.

Para cambiar el esquema en producción: **script aditivo de SQL crudo**, con
`IF NOT EXISTS`, e idempotente. Ejemplo a copiar:
`backend/scripts/apply-email-config-migration.cjs`.

### 2. Nunca desplegar sin saber qué corre hoy

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

### Motor de Email Marketing — código FUERA de este repo

Producción tiene 5 tablas del módulo de Email Marketing:
`MktContact`, `MktWorkflow`, `MktWorkflowFolder`, `MktEnrollment`, `MktAction`.

- **El código que las usa no está en este repo ni en GitHub.** Se construyó en
  otro proyecto, siguiendo el plano
  `team-clubify @ origin/feat/automations-engine-audit`
  → `docs/19-email-marketing-build-prompt.md`.
- La UI vive en `frontend/src/app/admin/automatizaciones/page.tsx` **de la
  versión desplegada**, con un tab "Email Marketing" que la versión de este
  repo no tiene (acá solo hay `mensajes | workflows | qr`).
- Los modelos **sí** están declarados en `backend/prisma/schema.prisma`
  (traídos con `db pull`, sección "MOTOR DE EMAIL MARKETING") para que un
  `db push` no los borre. Pero ojo: la introspección **no** pudo traer estos
  dos índices, y `db push` los borraría igual:

  ```
  MktContact_wl_email_uq      UNIQUE (whiteLabelId, email)
                              WHERE email IS NOT NULL AND NOT deleted
  MktContact_wl_phoneNorm_uq  UNIQUE (whiteLabelId, phoneNorm)
                              WHERE phoneNorm IS NOT NULL AND NOT deleted
  ```

  Sin ellos el motor empieza a duplicar contactos.

**Pendiente:** que quien construyó el módulo suba ese código a GitHub. Hasta
entonces, **no desplegar frontend ni backend desde esta máquina.**

---

## Cómo envía cada canal

Todo sale por la subcuenta de **Grow Business (GoHighLevel) de cada marca** —
Sellea por la de Sellea, Clubify por la de Clubify. Son subcuentas distintas y
ya vinculadas.

| Canal | Cómo sale |
|---|---|
| SMS | `GrowBusinessService.sendSmsWithCreds` — subcuenta de la marca |
| WhatsApp | `GrowBusinessService.sendWhatsAppWithCreds` — ídem |
| Correo | `GrowBusinessService.sendEmailWithCreds` — ídem, `type: 'Email'` |

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
