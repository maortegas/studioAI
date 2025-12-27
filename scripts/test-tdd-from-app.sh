#!/bin/bash

# Script para probar el ciclo TDD desde la aplicación
# Uso: ./scripts/test-tdd-from-app.sh [PROJECT_ID] [STORY_ID]

set -e

API_URL=${API_URL:-http://localhost:3001}
PROJECT_ID=${1:-""}
STORY_ID=${2:-""}

echo "🧪 Probando ciclo TDD desde la aplicación..."
echo ""

if [ -z "$PROJECT_ID" ] || [ -z "$STORY_ID" ]; then
  echo "❌ ERROR: Debes proporcionar PROJECT_ID y STORY_ID"
  echo ""
  echo "Uso: ./scripts/test-tdd-from-app.sh PROJECT_ID STORY_ID"
  echo ""
  echo "Ejemplo:"
  echo "  ./scripts/test-tdd-from-app.sh abc123 def456"
  exit 1
fi

echo "📊 Creando sesión de codificación con TDD..."
echo "   Project ID: $PROJECT_ID"
echo "   Story ID: $STORY_ID"
echo ""

# Crear sesión con TDD
RESPONSE=$(curl -s -X POST "$API_URL/api/coding-sessions/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"project_id\": \"$PROJECT_ID\",
    \"story_id\": \"$STORY_ID\",
    \"programmer_type\": \"backend\",
    \"test_strategy\": \"tdd\"
  }")

SESSION_ID=$(echo $RESPONSE | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ -z "$SESSION_ID" ]; then
  echo "❌ ERROR: No se pudo crear la sesión"
  echo "Respuesta: $RESPONSE"
  exit 1
fi

echo "✅ Sesión creada: $SESSION_ID"
echo ""

# Verificar que el job tiene tdd_mode='strict'
echo "📊 Verificando que tdd_mode='strict' está activado..."
sleep 2

DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_USER=${DB_USER:-postgres}
DB_PASSWORD=${DB_PASSWORD:-postgres}
DB_NAME=${DB_NAME:-devflow_studio}

TDD_MODE=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -A -c "
SELECT aj.args->>'tdd_mode'
FROM coding_sessions cs
JOIN ai_jobs aj ON cs.test_generation_job_id = aj.id
WHERE cs.id = '$SESSION_ID';
")

if [ "$TDD_MODE" = "strict" ]; then
  echo "✅ tdd_mode='strict' está activado automáticamente"
else
  echo "❌ ERROR: tdd_mode='strict' NO está activado (actual: $TDD_MODE)"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Verificación completada"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Próximos pasos:"
echo "   1. El worker procesará la generación de tests"
echo "   2. Cuando termine, inicializará el ciclo TDD automáticamente"
echo "   3. El estado cambiará a: tdd_red → tdd_green → tdd_refactor"
echo ""
echo "💡 Para monitorear el progreso:"
echo "   curl $API_URL/api/coding-sessions/$SESSION_ID | jq '.status, .tdd_cycle'"
echo ""
echo "💡 Para ver el stream de eventos:"
echo "   curl -N $API_URL/api/coding-sessions/stream/$SESSION_ID"
echo ""

