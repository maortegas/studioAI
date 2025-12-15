#!/bin/bash

# Script para detener el contenedor de PostgreSQL

echo "🛑 Deteniendo contenedor de PostgreSQL..."

if docker compose version &> /dev/null; then
    docker compose down
else
    docker-compose down
fi

echo "✅ Contenedor detenido"

