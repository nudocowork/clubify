# PROMPT: Implementar "Brand Workflows" — automatizaciones por marca que enrolan NEGOCIOS (NestJS + cron)

> Prompt de implementación portable, extraído del sistema real de la app principal Clubify
> (backend NestJS + Prisma + Postgres, frontend Next.js). Es el HERMANO del constructor de workflows
> para contactos: aquí la **audiencia son los NEGOCIOS (Tenant) de una marca blanca**, y el SMS va al
> **dueño del negocio** a través de la **subcuenta de SMS de la marca**. Motor durable por `@Cron`.

Quiero que implementes un módulo de automatizaciones **multi-marca** donde cada marca blanca
(white-label) arma workflows que enrolan a sus **negocios** y les envían SMS al dueño. A diferencia
del sistema de contactos, aquí NO hay respuestas entrantes ni etiquetas: es más simple, orientado a
ciclo de vida del negocio (alta, cobro por vencer, inactividad). Especificación exacta abajo.

## 1. Diferencias clave vs. el workflow de contactos

| | Workflows de contactos | **Brand Workflows** (este) |
|---|---|---|
| Audiencia | Contacto/Lead | **Tenant (negocio)** de una marca |
| Multi-tenant | no | **sí, por `whiteLabelId`** |
| Destinatario SMS | el contacto | el **dueño** (TENANT_OWNER) del negocio |
| Proveedor SMS | uno global | **subcuenta de la marca** (`brandGrowCreds`) |
| Nodos | muchos (reply, tags, appointment…) | `send_sms`, `wait_delay`, `if_else`, `end` |
| Disparadores | eventos de contacto | ciclo de vida del negocio |
| Runtime | Next.js + cron externo | **NestJS `@Cron`** |
| Entrantes / opt-out | sí | no |

## 2. Modelos Prisma

```prisma
model BrandWorkflow {
  id String @id @default(uuid())
  whiteLabelId String                       // dueño del workflow (la marca)
  name String
  folderId String?
  status String @default("draft")           // draft | published
  trigger Json @default("{}")               // { type, filters, daysBefore?, daysInactive? }
  rootId String?
  nodes Json @default("{}")                  // { [id]: WFNode }
  drip Json @default("{}")
  sendWindow Json @default("{}")
  reentry Boolean @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([whiteLabelId, status])
}

model BrandWorkflowFolder { id String @id @default(uuid()) whiteLabelId String name String position Int @default(0) createdAt DateTime @default(now()) @@index([whiteLabelId]) }

model BrandWorkflowEnrollment {
  id String @id @default(uuid())
  workflowId String
  tenantId String                            // negocio inscrito
  status String @default("active")           // active | waiting | completed | removed | error
  currentNodeId String?
  resumeAt DateTime?
  waitKind String?                           // delay | window | drip
  context Json @default("{}")
  enteredAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  completedAt DateTime?
  @@index([status, resumeAt])
  @@index([workflowId, tenantId])
}

model BrandWorkflowLog {
  id String @id @default(uuid())
  workflowId String whiteLabelId String tenantId String? nodeId String?
  nodeType String message String @default("") status String   // sent | skipped | failed | info
  result String? createdAt DateTime @default(now())
  @@index([workflowId, createdAt])
}
```

## 3. Tipos y catálogos (`brand-workflow.util.ts` — helpers puros)

```ts
export type WFCondition = { field: string; op: "eq"|"neq"|"contains"|"filled"; value?: string };
export type WFNode = { id: string; type: string; config: Record<string,unknown>; next?: string|null; yes?: string|null; no?: string|null };
export type WFGraph = Record<string, WFNode>;
export type WFTrigger = { type: string; filters?: WFCondition[]; [k: string]: unknown };
export type WFDrip = { enabled?: boolean; batchSize?: number; intervalMinutes?: number };
export type WFSendWindow = { enabled?: boolean; startHour?: number; endHour?: number; skipWeekends?: boolean; tz?: string };
```

**Disparadores (`WF_TRIGGERS`, todos `wired`):**
- `manual` — inscripción manual / lista.
- `business_created` — al registrarse un negocio nuevo en la marca (real-time + escaneo horario con ventana de seguridad de 7 días).
- `subscription_expiring` — faltan N días para el próximo cobro (config `daysBefore`, default 3).
- `business_inactive` — negocio ACTIVE sin pedidos en los últimos N días (config `daysInactive`, default 30).

**Nodos (`WF_NODE_TYPES`):** `send_sms`, `wait_delay`, `if_else` (branch), `end`.

**Campos del negocio (`WF_FIELDS`, para condiciones/merge):** `plan`, `status` (estado de la cuenta), `negocio` (nombre).

**Merge fields (`WF_MERGE_FIELDS`):** `negocio`, `owner` (nombre del dueño), `plan`, `platform` (nombre de la marca).

**Helpers puros:** `resolveMerge(text, ctx)` (regex `{{ [\w.]+ }}`) y `evalWF(conditions, ctx, "all"|"any")` (ops eq/neq/contains/filled).

## 4. Motor durable (`BrandWorkflowEngineService`, NestJS `@Injectable`)

```ts
type NodeResult =
  | { kind:"continue"; next:string|null }
  | { kind:"wait"; resumeAt:Date; waitKind:string; resumeNodeId:string|null }
  | { kind:"complete" } | { kind:"removed" };
```

Métodos privados/públicos:
- `ctxFor(tenantId)` → `{ negocio, owner, platform (whiteLabel.name || "Clubify"), plan, status(ACTIVE→activo/SUSPENDED→suspendido/TRIAL→prueba) }`.
- `ownerPhone(tenantId)` → `owner(TENANT_OWNER).phone → tenant.whatsappPhone → tenant.phone`.
- `runNode(wf, node, enr)`:
  - **send_sms**: resuelve merge; respeta **ventana de envío** (`nextSendTime`, tz de la marca) y **drip** (`dripDefer`) devolviendo `wait`; obtiene la **subcuenta de SMS de la marca** (`brandGrowCreds(tenant.whiteLabel)`) — si no hay, skip; obtiene teléfono del dueño — si no hay, skip; envía con `grow.sendSmsWithCreds(creds, phone, message)`; loguea. **Nunca cae a la cuenta global de Clubify**: si la marca no tiene subcuenta, NO envía.
  - **wait_delay**: espera N minutos/horas/días/semanas.
  - **if_else**: evalúa condiciones → rama `yes`/`no`.
  - **end**: `removed`.
- `advance(enr)`: bucle (guard ~60) hasta wait/complete/removed; persiste el puntero en cada paso; si el workflow no está `published` → saca la inscripción.
- `enroll(workflowId, tenantId)`: crea enrollment y avanza; respeta `reentry` (sin reentry: no reingresa si ya existe; con reentry: no si hay active/waiting). Envuelto en try/catch.
- `nextSendTime(win, from)` / `dripDefer(wf)`: idénticos al sistema de contactos (ventana en pasos de 30 min por tz; drip por conteo de `send_sms` sent en la última ventana).

## 5. Disparo (real-time + escaneo por cron — "Fase 3")

- **Real-time**: `fireTrigger(type, tenantId)` — resuelve la marca del negocio (con Clubify incluyendo los legacy `whiteLabelId=null`), toma los workflows `published` de esa marca con ese `trigger.type`, evalúa `filters` y `enroll`. Llámalo donde ocurra el evento (p. ej. al crear un negocio: `fireTrigger("business_created", tenantId)`).
- **Escaneo `@Cron(EVERY_HOUR) scanTriggers()`**:
  - `scanBusinessCreated`: negocios de la marca creados desde `max(wf.createdAt, now-7d)` (ventana de seguridad) → enroll.
  - `scanSubscriptionExpiring`: `status=ACTIVE` con `currentPeriodEnd ∈ [now, now+daysBefore]`.
  - `scanBusinessInactive`: candidatos `ACTIVE` creados hace ≥ `daysInactive`; se excluyen los que tienen `Order` en la ventana (`prisma.order.groupBy({by:["tenantId"], where:{createdAt:{gte:cutoff}}})`).
  - `fireEnroll(wf, tenantId)`: evalúa `filters` contra el contexto del negocio y, si pasan, `enroll`.
- **`brandTenantWhere(whiteLabelId)`**: para la marca "clubify" devuelve `{ OR:[{whiteLabelId},{whiteLabelId:null}] }` (incluye legacy); para el resto `{ whiteLabelId }`. Cachea el id de la marca clubify (`clubifyWlId()`).

## 6. Motor durable — `@Cron(EVERY_5_MINUTES) tick()`

Toma inscripciones `status in (active,waiting)` con `resumeAt <= now` (take 200). **Claim atómico** para evitar doble proceso entre pods/instancias: `updateMany` que empuja `resumeAt += 5 min` condicionado a que siga vencida; si `count===0`, otro worker ya la tomó → skip. Luego `advance(e)`; si lanza → marca `status:"error"`.

## 7. Frontend — panel por marca (`frontend/src/components/BrandWorkflowsPanel.tsx`)

- **Ubicación**: panel `/admin` de la marca (no en el drawer de Master Admin), gateado por el módulo correspondiente (p. ej. `GROW_BUSINESS_SMS`). El backend resuelve la marca desde el token.
- Constructor visual (lienzo/lista) con: crear workflow, agregar nodos (`WF_NODE_TYPES`), configurar el nodo `send_sms` con merge fields, condiciones `if_else`, esperas.
- Config del **trigger** (+ `daysBefore`/`daysInactive` según el tipo), ventana de envío, drip, reentry, carpetas.
- Publicar/despublicar. Pestaña "Inscribir" (manual) y bitácora (`BrandWorkflowLog`).

## 8. Controller / endpoints (`brand-workflows.controller.ts`)

CRUD de workflows y carpetas resolviendo `whiteLabelId` del token del admin de la marca: `list/get/create/save/delete`, `folders`, `logs`, `enroll(workflowId, tenantIds[])` (manual), toggle `publish`. Aislar SIEMPRE por `whiteLabelId` (una marca nunca ve/toca los workflows de otra).

## 9. Integración de SMS de marca (crítico)

- `brand-sms-creds.util.ts`: `BRAND_GROW_SELECT` (campos de credenciales en `WhiteLabel`) + `brandGrowCreds(whiteLabel)` → devuelve las credenciales de la **subcuenta de Grow Business de la marca** o `null`.
- `GrowBusinessService.sendSmsWithCreds(creds, phone, message)`: envía por esa subcuenta.
- **Regla de marca blanca**: si la marca no tiene subcuenta, el nodo `send_sms` hace **skip** (nunca envía desde la cuenta de Clubify). Nada de "GHL"/proveedor en UI ni código.

## 10. Notas de adaptación

1. Sustituye `Tenant` por tu entidad de "cuenta/negocio" y `TENANT_OWNER` por tu rol de dueño.
2. Implementa el proveedor SMS por-marca (`brandGrowCreds` + `sendSmsWithCreds`) o simplifícalo a un proveedor global si no necesitas multi-marca.
3. `currentPeriodEnd` (suscripción) y `Order` (actividad) → mapea a tus modelos de cobro/actividad.
4. Registra el servicio en el módulo de NestJS para que `@Cron` corra (ScheduleModule). Si no usas NestJS, replica `scanTriggers`/`tick` como cron externo con el mismo claim atómico.
5. Ajusta `ctxFor`/`WF_MERGE_FIELDS`/`WF_FIELDS` a los datos de tu negocio.
6. Define la tz por defecto (`America/Bogota`, UTC-5 sin DST).

**Entrega:** schema Prisma (4 modelos), `brand-workflow.util.ts`, `BrandWorkflowEngineService`, el controller, la integración de SMS por marca, y el panel del frontend; todo compilando y aislado por `whiteLabelId`.

---

**Relación con el otro documento:** este sistema enrola NEGOCIOS de una marca. Para el constructor
de workflows que enrola CONTACTOS/leads (con respuestas entrantes, etiquetas, nodos wait_reply/
appointment, webhook de SMS), ver `docs/workflows-spec.md` (Team Clubify).
