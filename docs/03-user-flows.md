# Flujos de usuario — Clubify

## 1. Onboarding Super Admin (semilla)

1. Se crea por seed inicial.
2. Login en `/login` → detecta rol `SUPER_ADMIN` → redirige a `/admin`.
3. Crea su primer tenant manualmente o vía link de referido.

## 2. Crear un nuevo tenant (Super Admin)

```
/admin/tenants/new
  ▶ formulario: brandName, email, phone, plan, primaryColor, logoUrl
  ▶ POST /api/tenants
  ▶ backend:
       - crea tenant
       - crea user TENANT_OWNER con password temporal
       - envía email de bienvenida con setup link
       - si hay ?ref=CODE → crea referral_use
  ▶ redirect a /admin/tenants/[id]
```

## 3. Onboarding del tenant

1. Recibe email con link de set-password.
2. Define password.
3. Login → role `TENANT_OWNER` → redirige a `/app`.
4. Wizard de 3 pasos:
   - Subir logo y colores.
   - Crear primera ubicación.
   - Crear su primera tarjeta (template).

## 4. Crear una tarjeta de sellos

```
/app/cards/new
  ▶ selector tipo: STAMPS|POINTS|...|GIFT
  ▶ formulario:
        name "Café del día"
        stampsRequired 10
        rewardText "1 café gratis"
        primary/secondary color
        logo (autofill desde tenant)
        terms
  ▶ POST /api/cards
  ▶ backend crea cards row + Google Wallet LoyaltyClass + plantilla pkpass
  ▶ redirect a /app/cards/[id]
```

## 5. Emitir pase a un cliente final

Dos vías:

### A) Manual (desde el panel)
```
/app/customers/[id]/issue-pass
  ▶ selecciona card
  ▶ POST /api/passes { cardId, customerId }
  ▶ backend crea pass + qrToken + serialNumber
  ▶ devuelve URLs:
        /w/[passId]                  página pública
        applePassUrl                  .pkpass firmado
        googleSaveUrl                 link Google Wallet
  ▶ tenant comparte por WhatsApp/email
```

### B) Self-service (link público del tenant)
```
QR del tenant → /signup/[tenantSlug]?card=[cardId]
  ▶ usuario final ingresa nombre + email/phone
  ▶ POST /api/public/customers + passes
  ▶ muestra pantalla con botones Apple/Google Wallet
```

## 6. Cliente final añade pase al Wallet

```
/w/[passId]
  ▶ detecta dispositivo (UA)
  ▶ iOS → botón "Add to Apple Wallet" (descarga .pkpass)
  ▶ Android → botón "Save to Google Wallet" (link JWT)
  ▶ desktop → muestra ambos + QR para abrir en móvil
```

Apple registra el dispositivo en `/v1/devices/.../registrations/...` → backend guarda `wallet_devices`.

## 7. Negocio escanea cliente

```
/scan (PWA, autenticada como TENANT_STAFF u OWNER)
  ▶ pide acceso a cámara
  ▶ lee QR → token JWT
  ▶ POST /api/scanner/verify { token }
  ▶ backend devuelve: customer, pass, currentStamps, card
  ▶ pantalla con acciones:
        [+1 sello]  [+5 sellos]  [Redimir recompensa]  [Ver historial]
  ▶ POST /api/stamps { passId, action: STAMP, amount: 1 }
  ▶ backend:
        - crea stamp row
        - actualiza pass.stampsCount
        - si stampsCount >= card.stampsRequired → status COMPLETED + dispara evento POINTS_REACHED
        - encola job para actualizar Apple/Google Wallet
        - dispara automatizaciones aplicables
  ▶ UI muestra confirmación + nuevo balance
```

## 8. Actualización de pase en Wallet (asíncrono)

```
worker wallet-sync
  ▶ recibe job { passId }
  ▶ regenera pass.json con stampsCount nuevo
  ▶ Apple:
        - PUT signed pass en CDN
        - APNs push silent a cada wallet_device.pushToken
        - iOS hace GET pass.json
  ▶ Google:
        - PATCH loyaltyObject.loyaltyPoints.balance
        - Google envía push automáticamente
```

## 9. Notificación push manual

```
/app/notifications/new
  ▶ elige tarjeta o segmento
  ▶ título + mensaje
  ▶ preview
  ▶ POST /api/notifications { cardId, title, body }
  ▶ backend encola por cada pass del segmento
        - Apple: push silent + cambio en pass.json (campo "Mensaje")
        - Google: messages.add al loyaltyObject
```

## 10. Geolocalización

```
tenant en /app/locations agrega ubicación con lat/lng/radius
  ▶ backend actualiza pases existentes (regenera pass.json con locations[])
  ▶ usuario al estar dentro del radio → iOS dispara local notification
  ▶ Google: misma idea con LocationsRequest
```

## 11. Automatización

```
/app/automations/new
  ▶ evento: INACTIVITY (30 días)
  ▶ acción: PUSH "Te extrañamos, vuelve y gana 2 sellos"
  ▶ POST /api/automations
  ▶ cron job diario evalúa pases sin actividad y dispara push
```

## 12. Referidos

### Crear código
```
/refer  (público o desde panel)
  ▶ formulario: fullName, whatsapp, email
  ▶ POST /api/referrals/codes
  ▶ devuelve code + link "https://clubify.app/?ref=ABC12345"
```

### Track de uso
```
visitor → / ?ref=ABC12345
  ▶ frontend setea cookie clubify_ref=ABC12345 (90 días)
  ▶ si visitor crea tenant → backend lee cookie → crea referral_uses
  ▶ Super Admin aprueba conversión → genera commission PENDING
  ▶ Super Admin marca commission PAID al hacer payout
```

## 13. Métricas

### Super Admin
- total tenants, activos, en trial
- ingresos por plan
- top tenants por pases emitidos
- comisiones pagadas vs pendientes

### Tenant
- tarjetas creadas
- pases emitidos vs instalados (Wallet)
- visitas / sellos por día
- recompensas redimidas
- usuarios activos (con actividad en últimos 30 días)
- top horarios y locations
