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
# nest build --tsc consume mucha RAM; el heap por defecto de Node OOMea en el
# contenedor de build de Railway al crecer el código (FATAL: JS heap out of
# memory, exit 134). Subimos el límite a 4GB solo para el build. (2026-08-17)
RUN NODE_OPTIONS="--max-old-space-size=4096" npm run build

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
# Scripts de migration (wrapper que auto-resuelve P3018/P3009 "already exists"
# para schemas pre-existentes via db push). El startCommand de railway.json
# llama a scripts/migrate-resolve-and-deploy.mjs antes de arrancar el server,
# así nunca hay desfase entre el código y las columnas físicas de la DB.
COPY --from=build /app/scripts ./scripts
# Imágenes default Apple Wallet (icon/logo/strip) — los certs reales se
# inyectan via env vars base64, pero estas PNGs vienen del repo.
COPY --from=build /app/certs ./certs

# Railway inyecta PORT en runtime; NO hardcodear ENV PORT acá porque
# eso podría sobrescribir el valor que Railway intenta inyectar para
# el routing del healthcheck. Dejamos que main.ts haga `?? 3001` como
# fallback solo si Railway no inyectó nada.
# EXPOSE es solo metadata (Railway ignora este número y usa $PORT);
# lo dejamos en 8080 que es el más común para servicios HTTP.
EXPOSE 8080

# CMD fallback — railway.json startCommand suele pisarlo. Mantenemos la
# misma lógica para que el container también funcione fuera de Railway.
CMD ["sh", "-c", "node scripts/migrate-resolve-and-deploy.mjs && node dist/main.js"]
