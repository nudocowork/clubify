#!/usr/bin/env bash
#
# Deploy manual a Railway. Mientras el webhook de GitHub→Railway esté roto
# (ver memoria del proyecto), este script es la forma fiable de publicar
# cambios del backend.
#
# Pre-requisitos:
#   - Railway CLI instalado:   npm i -g @railway/cli
#   - Sesión activa:           railway login
#   - Vinculado al proyecto:   railway link
#
# Uso:
#   ./scripts/deploy-railway.sh                # deploy del backend
#   ./scripts/deploy-railway.sh --no-migrate   # deploy sin correr migrations
#
# Default: corre Prisma generate + migrate deploy ANTES del deploy. Si la
# migration falla, abortamos sin deployar — evita publicar un binario que
# espera un schema que la DB todavía no tiene.

set -euo pipefail

NO_MIGRATE=false
for arg in "$@"; do
  case "$arg" in
    --no-migrate) NO_MIGRATE=true ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
  esac
done

if ! command -v railway >/dev/null 2>&1; then
  echo "❌ Railway CLI no instalado. Corré:"
  echo "   npm i -g @railway/cli"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT/backend"

if [ "$NO_MIGRATE" = false ]; then
  if [ -z "${PROD_DATABASE_URL:-}" ]; then
    echo "⚠️  PROD_DATABASE_URL no seteada — skip migrations."
    echo "   Tip: export PROD_DATABASE_URL=\$(railway variables get DATABASE_URL --json | jq -r .DATABASE_URL)"
    echo "   O corré con --no-migrate si querés deployar sin tocar schema."
    read -r -p "¿Continuar sin migrate? [y/N]: " ans
    [[ "${ans,,}" == "y" ]] || exit 1
  else
    echo "→ Generando Prisma client..."
    DATABASE_URL="$PROD_DATABASE_URL" npx prisma generate

    echo "→ Aplicando migrations a prod..."
    # Memoria del proyecto: `prisma migrate deploy` cuelga en Railway runtime
    # — por eso lo corremos DESDE LOCAL contra la public URL de la DB.
    DATABASE_URL="$PROD_DATABASE_URL" npx prisma migrate deploy
  fi
fi

echo "→ Building deploy a Railway..."
railway up --detach

echo "✓ Deploy iniciado. Seguilo en:"
echo "   railway logs --tail"
