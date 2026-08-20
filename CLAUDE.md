# Clubify PRO — instrucciones del proyecto

## ⚠️ Antes de desplegar, migrar o tocar el esquema

**Este producto se trabaja desde más de una máquina y las dos despliegan al
mismo producción. Lo que hay en este repo NO es necesariamente lo que corre.**

Lee primero, siempre:

- **[docs/ESTADO-PRODUCCION.md](docs/ESTADO-PRODUCCION.md)** — qué corre hoy en
  producción, qué hay ahí que no está en el código, y las reglas duras.
- **[docs/BITACORA.md](docs/BITACORA.md)** — qué hizo la otra máquina y qué dejó
  pendiente de validar.

### Reglas que no se rompen

1. **Nunca `prisma db push` contra producción.** Borra lo que no está en el
   schema, y producción tiene índices únicos parciales que Prisma no sabe
   expresar. Para cambios de esquema: script aditivo de SQL crudo con
   `IF NOT EXISTS`, idempotente. Modelo a copiar:
   `backend/scripts/apply-email-config-migration.cjs`.

2. **Nunca desplegar sin comprobar qué corre.** El backend se ha desplegado con
   `railway up` desde directorios locales, no desde git; puede haber código en
   producción que no está en ninguna rama. Comprobar con
   `railway status --json`.

3. **Al terminar un bloque de trabajo, escribir la entrada en
   `docs/BITACORA.md` y hacer push** — aunque quede a medias. Es el único canal
   por el que la otra máquina se entera.

## Cómo salen los mensajes

Todo — SMS, WhatsApp y **correo** — sale por **Grow Business (GoHighLevel)**.
**No hay proveedor de correo propio**: en Railway no existe `RESEND_API_KEY`.
Código que intente enviar por Resend no manda nada.

En el correo hay que separar dos cosas que se confunden todo el tiempo:

- La **firma** —logo, color, «Enviado por X», dominio de los links— sale
  **siempre de la marca del negocio** y no depende del transporte. Sellea firma
  como Sellea, Clubify como Clubify, y cada marca nueva con la suya.
- El **remitente** lo pone la subcuenta que transporta.

Cascada del transporte: subcuenta propia de la marca → (solo si es la
plataforma) subcuenta de cobros del negocio o la predeterminada. Una **marca
blanca sin subcuenta propia no envía**: un remitente `@soyclubify.com` en un
correo firmado por ella delataría la plataforma y rompería el DMARC del dominio
ajeno. Detalle en `docs/ESTADO-PRODUCCION.md`.

## Verificación antes de dar algo por hecho

```bash
cd backend
npx tsc --noEmit -p tsconfig.json     # backend
npx vitest run src/email src/integrations
npx eslint src/<lo que tocaste>
cd ../frontend && npx tsc --noEmit -p tsconfig.json
```

Los tests unitarios no necesitan base de datos. Los e2e de `backend/test/` sí.

## Estilo

- El producto se usa en español: los textos que ve el usuario van en español,
  con tildes y eñes correctas. Son correos y mensajes que leen clientes reales.
- Los comentarios explican **por qué**, no qué. Si un gate existe para evitar un
  bug concreto, decirlo.
