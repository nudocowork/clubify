# Clubify

> **El sistema operativo del negocio local.**
> Una sola herramienta para vender, fidelizar y automatizar tu negocio.

Plataforma SaaS multi-tenant que integra **menú digital**, **pedidos a WhatsApp**, **tarjetas de fidelización** (Apple/Google Wallet) y **automatizaciones** (tipo GoHighLevel pero enfocado en negocios físicos).

Para restaurantes, cafeterías, bares, tiendas, coworks y similares.

## Visión v2 — los 3 pilares

```
   VENDER             FIDELIZAR          AUTOMATIZAR
   ──────             ─────────          ───────────
   Menú digital       Tarjetas Wallet    Reglas IF→THEN
   Pedidos WhatsApp   Sellos / Puntos    WhatsApp / SMS
   Promos             Geo push           Recordatorios
   QR                                    Triggers
```

Ver detalle en [docs/10-vision-os.md](docs/10-vision-os.md).

## Stack

- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- **Backend:** NestJS 10 + TypeScript + Prisma ORM
- **Base de datos:** PostgreSQL 16
- **Cache / colas:** Redis 7 + BullMQ
- **Storage:** S3 compatible (MinIO en local)
- **Auth:** JWT con refresh tokens + RBAC por rol y tenant
- **Wallet:** Apple PassKit (PKPass firmados) + Google Wallet REST API
- **Push:** Wallet push (APNs para iOS, Google Wallet API para Android) + Web Push opcional
- **Geolocalización:** Beacons NFC/iBeacon ubicados en `locations` + push relevance updates en pases

## Estructura del repositorio

```
clubify/
  backend/           NestJS API
  frontend/          Next.js app (super admin, cliente, wallet público, scanner)
  docker/            docker-compose y Dockerfiles
  docs/              arquitectura, flujos, modelo de datos
```

## Quick start

```bash
# 1. Levantar infraestructura (Postgres + Redis + MinIO)
cd docker && docker compose up -d

# 2. Backend
cd ../backend
cp .env.example .env
npm install
npx prisma migrate dev
npm run seed         # crea super admin demo + tenant demo
npm run start:dev    # http://localhost:3001

# 3. Frontend
cd ../frontend
cp .env.example .env.local
npm install
npm run dev          # http://localhost:3000
```

Credenciales semilla:
- Super Admin: `admin@clubify.local` / `Clubify123!`
- Tenant demo: `demo@clubify.local` / `Demo123!`

## Documentación

### v1 (fidelización pura — base implementada)
- [docs/01-architecture.md](docs/01-architecture.md) — arquitectura técnica
- [docs/02-database-model.md](docs/02-database-model.md) — modelo de datos v1
- [docs/03-user-flows.md](docs/03-user-flows.md) — flujos de usuario v1
- [docs/04-screens.md](docs/04-screens.md) — pantallas v1
- [docs/05-deployment.md](docs/05-deployment.md) — despliegue
- [docs/06-wallet-integration.md](docs/06-wallet-integration.md) — Apple/Google Wallet

### v2 (Clubify OS — visión integrada)
- [docs/10-vision-os.md](docs/10-vision-os.md) — visión, posicionamiento, principios
- [docs/11-architecture-v2.md](docs/11-architecture-v2.md) — arquitectura extendida (10 módulos + event bus)
- [docs/12-database-v2.md](docs/12-database-v2.md) — 14 tablas nuevas (Catalog, Orders, Promos, Automations, Channels, Storefront, Events)
- [docs/13-flows-wireframes.md](docs/13-flows-wireframes.md) — flujos completos + wireframes ASCII
- [docs/14-mvp-roadmap.md](docs/14-mvp-roadmap.md) — alcance MVP v2 (12 sem) + roadmap 24 meses
- [docs/15-info-links-module.md](docs/15-info-links-module.md) — Módulo de Links Informativos (planeado post-MVP)

## MVP incluido

- Login Super Admin + Cliente con JWT
- Gestión multi-tenant (crear/editar/activar negocios, límite de ubicaciones)
- Constructor de tarjetas (sellos como tarjeta principal del MVP, esqueleto para puntos/cupón/regalo/membresía)
- Generación de QR único por usuario final
- Scanner web (PWA) para sumar sellos / redimir
- Generación de pases Apple Wallet (.pkpass) + Google Wallet (JWT save link)
- Notificaciones push manuales por tarjeta
- Geolocalización: hasta 3 ubicaciones por defecto, ampliable por Super Admin
- Sistema de referidos con códigos únicos, links, comisiones
- Dashboards con métricas básicas
