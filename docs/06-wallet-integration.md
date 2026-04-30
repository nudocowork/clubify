# Integración Apple Wallet y Google Wallet — Clubify

## Apple Wallet (PassKit)

### Estructura de un .pkpass
Un `.pkpass` es un ZIP con:
```
pass.json           manifest del pase (campos, colores, locations)
manifest.json       SHA1 de cada archivo
signature           firma PKCS#7 del manifest.json con el cert del Pass Type ID
icon.png / @2x      icon
logo.png / @2x      logo en cabecera
strip.png / @2x     imagen hero (opcional)
```

### `pass.json` mínimo (storeCard)
```json
{
  "formatVersion": 1,
  "passTypeIdentifier": "pass.com.clubify.loyalty",
  "teamIdentifier": "XXXXXXXXXX",
  "organizationName": "Café del Día",
  "serialNumber": "PASS-abc123",
  "description": "Tarjeta de sellos",
  "logoText": "Café del Día",
  "foregroundColor": "rgb(255,255,255)",
  "backgroundColor": "rgb(15,61,46)",
  "labelColor": "rgb(245,241,232)",
  "webServiceURL": "https://api.clubify.app/wallet/apple",
  "authenticationToken": "TOKEN-PER-PASS",
  "barcodes": [{"format":"PKBarcodeFormatQR","message":"QR_TOKEN","messageEncoding":"iso-8859-1"}],
  "locations": [{"latitude":4.7110,"longitude":-74.0721,"relevantText":"Estás cerca de Café del Día"}],
  "storeCard": {
    "primaryFields": [{"key":"stamps","label":"SELLOS","value":"3 / 10"}],
    "secondaryFields": [{"key":"reward","label":"RECOMPENSA","value":"1 café gratis"}],
    "auxiliaryFields": [{"key":"member","label":"CLIENTE","value":"María Pérez"}],
    "backFields": [
      {"key":"terms","label":"Condiciones","value":"..."},
      {"key":"contact","label":"Contacto","value":"+57 300 000 0000"}
    ]
  }
}
```

### Web service para updates (lo expone Clubify)

```
POST   /wallet/apple/v1/devices/{deviceLibId}/registrations/{passTypeId}/{serialNumber}
DELETE /wallet/apple/v1/devices/{deviceLibId}/registrations/{passTypeId}/{serialNumber}
GET    /wallet/apple/v1/devices/{deviceLibId}/registrations/{passTypeId}?passesUpdatedSince=...
GET    /wallet/apple/v1/passes/{passTypeId}/{serialNumber}
POST   /wallet/apple/v1/log
```

Cuando un pase cambia (sello sumado):
1. `PassUpdaterService` regenera el `.pkpass` y lo sube a S3.
2. Para cada `wallet_devices` (platform=APPLE) del pase, envía push silencioso a APNs con `topic = passTypeIdentifier`.
3. iOS llama `GET .../passes/...` → backend devuelve el pkpass con `If-Modified-Since`.

### Implementación en Node
Usamos `passkit-generator` (o equivalente) para empaquetar y firmar:
```ts
import { PKPass } from 'passkit-generator';
const pass = await PKPass.from({
  model: './templates/stamps.pass',          // carpeta con pass.json + imágenes base
  certificates: { wwdr, signerCert, signerKey, signerKeyPassphrase }
}, {
  serialNumber: pass.serialNumber,
  authenticationToken: pass.authToken,
  webServiceURL: `${API_URL}/wallet/apple`,
});
pass.headerFields.push({ key: 'stamps', label: 'SELLOS', value: `${stamps}/${required}` });
return pass.getAsBuffer();
```

APNs:
```ts
import http2 from 'http2';
// firma JWT con APNS_KEY (.p8)
// POST https://api.push.apple.com/3/device/{pushToken}
//   apns-topic: pass.com.clubify.loyalty
//   payload: {} (silent push)
```

## Google Wallet

### Conceptos
- **LoyaltyClass** = template (uno por `card`).
- **LoyaltyObject** = instancia (uno por `pass`).
- Para añadir al wallet, generamos un **JWT firmado** con la cuenta de servicio que contiene el `LoyaltyObject`. El usuario abre `https://pay.google.com/gp/v/save/{jwt}` y Google lo guarda.

### Crear class al crear `card`
```ts
const cls = {
  id: `${ISSUER_ID}.card_${cardId}`,
  issuerName: tenant.brandName,
  programName: card.name,
  programLogo: { sourceUri: { uri: card.logoUrl }},
  hexBackgroundColor: card.primaryColor,
  rewardsTier: card.rewardText,
  countryCode: 'CO',
  reviewStatus: 'UNDER_REVIEW',
};
await walletClient.loyaltyclass.insert({ requestBody: cls });
```

### Crear object al emitir `pass`
```ts
const obj = {
  id: `${ISSUER_ID}.pass_${passId}`,
  classId: `${ISSUER_ID}.card_${cardId}`,
  state: 'ACTIVE',
  accountName: customer.fullName,
  accountId: customer.id,
  loyaltyPoints: {
    balance: { string: `${stampsCount}/${stampsRequired}` },
    label: 'Sellos',
  },
  barcode: { type: 'QR_CODE', value: pass.qrToken },
  locations: locations.map(l => ({ latitude: l.latitude, longitude: l.longitude })),
};
await walletClient.loyaltyobject.insert({ requestBody: obj });
```

### Save link
```ts
const claims = {
  iss: SA_EMAIL,
  aud: 'google',
  typ: 'savetowallet',
  iat: Math.floor(Date.now()/1000),
  payload: { loyaltyObjects: [{ id: obj.id }] },
};
const jwt = sign(claims, SA_PRIVATE_KEY, { algorithm: 'RS256' });
return `https://pay.google.com/gp/v/save/${jwt}`;
```

### Updates (sumar sello)
```ts
await walletClient.loyaltyobject.patch({
  resourceId: obj.id,
  requestBody: { loyaltyPoints: { balance: { string: `${newStamps}/${required}` }}}
});
// Google Wallet envía push automáticamente al usuario.
```

### Mensajes (push de marketing)
```ts
await walletClient.loyaltyobject.addmessage({
  resourceId: obj.id,
  requestBody: { message: { header: title, body, messageType: 'TEXT' }}
});
```

## QR firmado

Cada `pass.qrToken` es un JWT HMAC corto:
```ts
sign({ pid: pass.id, tid: tenant.id }, QR_HMAC_SECRET, { algorithm: 'HS256' });
```
El scanner lo verifica y solo permite operar dentro del mismo tenant.

## Notas de producción

- Cachear los `.pkpass` generados en S3, regenerar solo al cambiar.
- Throttle de APNs (Apple permite ~9000 req/s por conexión HTTP/2).
- Fallback gracioso si el cert Apple expira (notificar Super Admin con anticipación).
- En desarrollo, los pases pueden firmarse pero no se envían pushes; usar tester web `passkit-webservice-toolkit` o el simulador de Wallet.
