# ─── deps: install incl. native build deps for argon2 ─────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --no-audit --no-fund

# ─── build: compile TS, generate Prisma client ────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ─── runtime: minimal image, only prod deps ───────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# fontconfig + Noto Color Emoji son necesarios para que sharp renderice
# emojis dentro de la strip dinámica del .pkpass (sino sale solo círculo
# blanco sin el icono del sello).
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates fontconfig fonts-noto-color-emoji \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package*.json ./
# Imágenes default Apple Wallet (icon/logo/strip) — los certs reales se
# inyectan via env vars base64, pero estas PNGs vienen del repo.
COPY --from=build /app/certs ./certs

# Railway / Render asignan PORT por env; default a 3001 si no
ENV PORT=3001
EXPOSE 3001

# Aplicar migraciones pendientes y arrancar
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
