#!/bin/bash

# Script para configurar la base de datos con Docker

echo "🚀 Configurando base de datos con Docker..."

# Verificar si Docker está instalado
if ! command -v docker &> /dev/null; then
    echo "❌ Docker no está instalado. Por favor instala Docker primero."
    exit 1
fi

# Verificar si docker-compose está instalado
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ docker-compose no está instalado. Por favor instala docker-compose primero."
    exit 1
fi

# Iniciar PostgreSQL con Docker Compose
echo "📦 Iniciando contenedor de PostgreSQL..."
if docker compose version &> /dev/null; then
    docker compose up -d postgres
else
    docker-compose up -d postgres
fi

# Esperar a que PostgreSQL esté listo
echo "⏳ Esperando a que PostgreSQL esté listo..."
sleep 5

# Verificar que el contenedor está corriendo
if ! docker ps | grep -q devflow-postgres; then
    echo "❌ El contenedor de PostgreSQL no está corriendo. Verifica los logs con: docker compose logs postgres"
    exit 1
fi

echo "✅ PostgreSQL está corriendo en el puerto 5432"

# Ejecutar migraciones
echo "🔄 Ejecutando migraciones..."
cd database
DB_HOST=localhost DB_PORT=5432 DB_USER=postgres DB_PASSWORD=postgres DB_NAME=devflow_studio npm run migrate

if [ $? -eq 0 ]; then
    echo "✅ Base de datos configurada exitosamente!"
    echo ""
    echo "📝 Información de conexión:"
    echo "   Host: localhost"
    echo "   Port: 5432"
    echo "   User: postgres"
    echo "   Password: postgres"
    echo "   Database: devflow_studio"
    echo ""
    echo "Para detener el contenedor: docker compose down"
    echo "Para ver los logs: docker compose logs -f postgres"
else
    echo "❌ Error al ejecutar migraciones"
    exit 1
fi

