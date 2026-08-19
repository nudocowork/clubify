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

### Qué falta / qué hay que validar del otro lado
- [ ] **Subir a GitHub el código del motor de Email Marketing** (tablas `Mkt*`).
      No está en este repo ni en ningún remoto. Sin eso, desplegar desde esta
      máquina **sobrescribe y rompe** ese módulo en producción.
- [ ] **Confirmar el formato que espera Grow Business para `type: 'Email'`.**
      Se implementó `sendEmailWithCreds` deduciendo `{ type, contactId, subject,
      html }` a partir de cómo mandan SMS y WhatsApp. **No está probado contra
      la API real.** El botón "Probar correo" del panel sirve para validarlo en
      un minuto tras el despliegue.
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
