# Modelo de base de datos — Clubify

PostgreSQL 16 + Prisma. Multi-tenant por columna `tenantId`.

## Diagrama lógico

```
plans ──┐
        ▼
     tenants ─┬── users (TENANT_OWNER, STAFF)
              ├── locations (max 3, ampliable)
              ├── cards (templates)
              │     └── passes (instancias por customer)
              │            ├── stamps (transacciones)
              │            └── wallet_devices (registros Apple/Google)
              ├── customers
              ├── notifications
              ├── automations
              └── referral_codes ──── referral_uses ──── commissions
users (SUPER_ADMIN) ─── audit_logs
```

## Entidades

### `plans`
Planes comerciales que el Super Admin asigna a tenants.

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| name | text | "Free", "Pro", "Business" |
| maxLocations | int | default 3 |
| maxCards | int | |
| maxCustomers | int | |
| pushIncluded | int | mensual |
| priceMonthly | decimal | en USD |
| isActive | bool | |

### `tenants`
Cada negocio cliente.

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| name | text | razón social |
| brandName | text | nombre comercial |
| slug | text unique | usado en URLs |
| email | text | contacto |
| phone | text | |
| logoUrl | text | en S3 |
| primaryColor | text | hex |
| secondaryColor | text | hex |
| status | enum(`ACTIVE`,`SUSPENDED`,`TRIAL`) | |
| planId | uuid FK plans | |
| maxLocationsOverride | int? | si Super Admin amplía |
| referredByCode | text? | trazabilidad |
| createdAt | timestamptz | |

### `users`
Usuarios del sistema (Super Admins + dueños/staff de tenants).

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid? FK | null si SUPER_ADMIN |
| email | text unique | |
| passwordHash | text | argon2id |
| fullName | text | |
| phone | text? | |
| role | enum(`SUPER_ADMIN`,`TENANT_OWNER`,`TENANT_STAFF`) | |
| isActive | bool | |
| lastLoginAt | timestamptz? | |
| createdAt | timestamptz | |

### `customers`
Clientes finales que reciben tarjetas. Pertenecen a un tenant.

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK | |
| email | text? | |
| phone | text? | |
| fullName | text | |
| birthday | date? | |
| externalId | text? | id en CRM externo |
| createdAt | timestamptz | |

Único `(tenantId, email)` y `(tenantId, phone)`.

### `cards`
Plantilla de tarjeta diseñada por el tenant.

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK | |
| type | enum(`STAMPS`,`POINTS`,`DISCOUNT`,`MEMBERSHIP`,`COUPON`,`GIFT`,`MULTI`) | |
| name | text | |
| description | text | |
| terms | text | |
| primaryColor | text | hex |
| secondaryColor | text | hex |
| logoUrl | text | |
| heroImageUrl | text? | |
| iconUrl | text? | |
| stampsRequired | int? | sólo STAMPS, ej 10 |
| rewardText | text | "1 café gratis" |
| pointsPerCurrency | decimal? | sólo POINTS |
| discountPercent | int? | DISCOUNT |
| validFrom | date? | |
| validUntil | date? | |
| socialLinks | jsonb | {instagram, facebook,...} |
| isActive | bool | |
| createdAt | timestamptz | |

### `passes`
Instancia: customer × card. Es lo que vive en el Wallet del usuario.

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK | |
| cardId | uuid FK | |
| customerId | uuid FK | |
| serialNumber | text unique | usado por Apple |
| qrToken | text unique | JWT HMAC, lo escanea el negocio |
| stampsCount | int | default 0 |
| pointsBalance | decimal | default 0 |
| status | enum(`ACTIVE`,`COMPLETED`,`REVOKED`) | |
| issuedAt | timestamptz | |
| lastActivityAt | timestamptz? | |
| googleObjectId | text? | id en Google Wallet |
| applePassUrl | text? | URL del pkpass |

Único `(cardId, customerId)`.

### `wallet_devices`
Registros que envía Apple/Google al instalar el pase, para enviar push.

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| passId | uuid FK | |
| platform | enum(`APPLE`,`GOOGLE`) | |
| deviceLibraryId | text | de Apple |
| pushToken | text | |
| createdAt | timestamptz | |

### `stamps`
Transacciones (un sello, sumar puntos, redimir, etc).

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK | |
| passId | uuid FK | |
| customerId | uuid FK | |
| locationId | uuid? FK | |
| operatorId | uuid? FK users | quien escaneó |
| action | enum(`STAMP`,`POINTS_ADD`,`POINTS_DEDUCT`,`REDEEM`,`REFUND`,`VISIT`) | |
| amount | decimal | sellos o puntos |
| note | text? | |
| createdAt | timestamptz | |

### `locations`
Sucursales del negocio. Limit por `plan.maxLocations` o `tenant.maxLocationsOverride`.

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK | |
| name | text | |
| address | text | |
| latitude | decimal(10,7) | |
| longitude | decimal(10,7) | |
| radiusMeters | int | 100/300/500 |
| isActive | bool | |
| createdAt | timestamptz | |

### `notifications`
Push enviados (manuales o por automatización).

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK | |
| cardId | uuid? FK | si va a pases de una tarjeta concreta |
| segment | jsonb? | filtros (lastVisitDays<X, etc) |
| title | text | |
| body | text | |
| triggerType | enum(`MANUAL`,`AUTOMATION`,`GEO`) | |
| sentAt | timestamptz? | |
| stats | jsonb | {targeted, delivered, opened} |
| createdAt | timestamptz | |

### `automations`
Reglas event → acción.

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK | |
| name | text | |
| eventType | enum(`STAMP_ADDED`,`POINTS_REACHED`,`INACTIVITY`,`GEO_ENTER`,`REWARD_REDEEMED`,`PASS_CREATED`) | |
| conditions | jsonb | ej `{daysWithoutVisit: 30}` |
| action | jsonb | ej `{type:'PUSH', title, body}` |
| isActive | bool | |
| createdAt | timestamptz | |

### `referral_codes`
Código generado por una persona (puede ser tenant existente o externo).

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| code | text unique | base32 8 chars |
| ownerName | text | |
| ownerEmail | text | |
| ownerWhatsapp | text | |
| ownerUserId | uuid? FK users | si existe en sistema |
| commissionPercent | decimal | default 20 |
| isActive | bool | |
| createdAt | timestamptz | |

### `referral_uses`
Cada vez que alguien se registra con el código.

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| referralCodeId | uuid FK | |
| tenantId | uuid? FK | tenant creado a partir del referido |
| status | enum(`SIGNED_UP`,`ACTIVE`,`PAYING`,`CHURNED`) | |
| createdAt | timestamptz | |
| convertedAt | timestamptz? | |

### `commissions`
Pagos calculados al referente.

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| referralUseId | uuid FK | |
| amount | decimal | |
| currency | text | "USD" |
| status | enum(`PENDING`,`APPROVED`,`PAID`,`REJECTED`) | |
| paidAt | timestamptz? | |
| createdAt | timestamptz | |

### `audit_logs`
Trazabilidad.

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| actorId | uuid? FK users | |
| tenantId | uuid? FK | |
| action | text | "tenant.created" |
| resource | text | "tenant:abc" |
| metadata | jsonb | |
| ip | inet | |
| createdAt | timestamptz | |

## Índices clave

- `customers (tenantId, email)` único
- `passes (cardId, customerId)` único, `passes (qrToken)` único, `passes (serialNumber)` único
- `stamps (passId, createdAt)` para historial
- `notifications (tenantId, sentAt)`
- `referral_uses (referralCodeId, status)`
