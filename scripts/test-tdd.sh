#!/bin/bash

# Script para verificar que el TDD funciona correctamente
# Uso: ./scripts/test-tdd.sh [SESSION_ID]

set -e

DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_USER=${DB_USER:-postgres}
DB_PASSWORD=${DB_PASSWORD:-postgres}
DB_NAME=${DB_NAME:-devflow_studio}

SESSION_ID=${1:-""}

echo "🧪 Verificando que el TDD funciona..."
echo ""

# Función para ejecutar queries SQL
run_sql() {
  PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -A -c "$1"
}

# Paso 1: Verificar migración
echo "📊 Paso 1: Verificando migración..."
MIGRATION_CHECK=$(run_sql "
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'coding_sessions' 
AND column_name = 'tdd_cycle';
")

if [ -z "$MIGRATION_CHECK" ]; then
  echo "❌ ERROR: La columna tdd_cycle no existe. Aplica la migración primero."
  exit 1
fi
echo "✅ Columna tdd_cycle existe"

INDEX_CHECK=$(run_sql "
SELECT indexname 
FROM pg_indexes 
WHERE tablename = 'coding_sessions' 
AND indexname = 'idx_coding_sessions_tdd_cycle';
")

if [ -z "$INDEX_CHECK" ]; then
  echo "⚠️  ADVERTENCIA: El índice GIN no existe"
else
  echo "✅ Índice GIN existe"
fi

# Paso 2: Si no hay SESSION_ID, buscar una sesión con TDD
if [ -z "$SESSION_ID" ]; then
  echo ""
  echo "📊 Paso 2: Buscando sesiones con TDD..."
  SESSION_ID=$(run_sql "
  SELECT cs.id 
  FROM coding_sessions cs
  JOIN ai_jobs aj ON cs.test_generation_job_id = aj.id
  WHERE aj.args->>'test_strategy' = 'tdd'
  ORDER BY cs.created_at DESC
  LIMIT 1;
  ")
  
  if [ -z "$SESSION_ID" ]; then
    echo "⚠️  No se encontró ninguna sesión con TDD. Crea una primero."
    echo ""
    echo "Para crear una sesión:"
    echo "  curl -X POST http://localhost:3001/api/coding-sessions/create \\"
    echo "    -H 'Content-Type: application/json' \\"
    echo "    -d '{\"project_id\": \"...\", \"story_id\": \"...\", \"programmer_type\": \"backend\", \"test_strategy\": \"tdd\"}'"
    exit 0
  fi
  
  echo "✅ Sesión encontrada: $SESSION_ID"
else
  echo ""
  echo "📊 Paso 2: Verificando sesión: $SESSION_ID"
fi

# Paso 3: Verificar estado de la sesión
echo ""
echo "📊 Paso 3: Estado de la sesión..."
SESSION_STATUS=$(run_sql "
SELECT status 
FROM coding_sessions 
WHERE id = '$SESSION_ID';
")

if [ -z "$SESSION_STATUS" ]; then
  echo "❌ ERROR: La sesión no existe"
  exit 1
fi

echo "✅ Estado actual: $SESSION_STATUS"

# Paso 4: Verificar TDD cycle
echo ""
echo "📊 Paso 4: Verificando ciclo TDD..."
TDD_CYCLE=$(run_sql "
SELECT tdd_cycle 
FROM coding_sessions 
WHERE id = '$SESSION_ID';
")

if [ -z "$TDD_CYCLE" ] || [ "$TDD_CYCLE" = "" ]; then
  echo "⚠️  ADVERTENCIA: El ciclo TDD no está inicializado"
  echo ""
  echo "Para activar modo TDD estricto:"
  echo "  1. Obtén el test_generation_job_id:"
  echo "     SELECT test_generation_job_id FROM coding_sessions WHERE id = '$SESSION_ID';"
  echo ""
  echo "  2. Actualiza el job:"
  echo "     UPDATE ai_jobs SET args = args || '{\"tdd_mode\": \"strict\"}'::jsonb WHERE id = 'JOB_ID';"
else
  echo "✅ Ciclo TDD inicializado"
  
  # Extraer información del ciclo
  PHASE=$(run_sql "
  SELECT tdd_cycle->>'phase' 
  FROM coding_sessions 
  WHERE id = '$SESSION_ID';
  ")
  
  TEST_INDEX=$(run_sql "
  SELECT tdd_cycle->>'test_index' 
  FROM coding_sessions 
  WHERE id = '$SESSION_ID';
  ")
  
  TOTAL_TESTS=$(run_sql "
  SELECT tdd_cycle->>'total_tests' 
  FROM coding_sessions 
  WHERE id = '$SESSION_ID';
  ")
  
  TESTS_PASSED=$(run_sql "
  SELECT tdd_cycle->>'tests_passed' 
  FROM coding_sessions 
  WHERE id = '$SESSION_ID';
  ")
  
  echo "   Fase actual: $PHASE"
  echo "   Test actual: $((TEST_INDEX + 1)) de $TOTAL_TESTS"
  echo "   Tests pasados: $TESTS_PASSED de $TOTAL_TESTS"
fi

# Paso 5: Verificar jobs relacionados
echo ""
echo "📊 Paso 5: Verificando jobs relacionados..."
TEST_JOB_ID=$(run_sql "
SELECT test_generation_job_id 
FROM coding_sessions 
WHERE id = '$SESSION_ID';
")

if [ -n "$TEST_JOB_ID" ]; then
  echo "✅ Test generation job: $TEST_JOB_ID"
  
  TDD_MODE=$(run_sql "
  SELECT args->>'tdd_mode' 
  FROM ai_jobs 
  WHERE id = '$TEST_JOB_ID';
  ")
  
  if [ "$TDD_MODE" = "strict" ]; then
    echo "✅ Modo TDD estricto activado"
  else
    echo "⚠️  Modo TDD estricto NO activado (actual: $TDD_MODE)"
    echo ""
    echo "Para activarlo:"
    echo "  UPDATE ai_jobs SET args = args || '{\"tdd_mode\": \"strict\"}'::jsonb WHERE id = '$TEST_JOB_ID';"
  fi
  
  JOB_STATUS=$(run_sql "
  SELECT status 
  FROM ai_jobs 
  WHERE id = '$TEST_JOB_ID';
  ")
  
  echo "   Estado del job: $JOB_STATUS"
fi

# Paso 6: Verificar transiciones de estado esperadas
echo ""
echo "📊 Paso 6: Verificando transiciones de estado..."
case "$SESSION_STATUS" in
  "generating_tests")
    echo "✅ Estado correcto: Generando tests (esperando que termine)"
    ;;
  "tests_generated")
    echo "✅ Estado correcto: Tests generados (debería inicializar TDD cycle)"
    ;;
  "tdd_red")
    echo "✅ Estado correcto: Fase RED (test debería fallar)"
    ;;
  "tdd_green")
    echo "✅ Estado correcto: Fase GREEN (implementando código mínimo)"
    ;;
  "tdd_refactor")
    echo "✅ Estado correcto: Fase REFACTOR (mejorando código)"
    ;;
  "completed")
    echo "✅ Estado correcto: Completado"
    ;;
  "failed")
    echo "⚠️  Estado: Fallido (revisa los logs)"
    ;;
  *)
    echo "⚠️  Estado: $SESSION_STATUS (no es un estado TDD típico)"
    ;;
esac

# Resumen
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Resumen:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Migración aplicada"
echo "✅ Sesión encontrada: $SESSION_ID"
echo "✅ Estado: $SESSION_STATUS"

if [ -n "$TDD_CYCLE" ] && [ "$TDD_CYCLE" != "" ]; then
  echo "✅ Ciclo TDD inicializado"
  echo "   → Fase: $PHASE"
  echo "   → Progreso: $((TEST_INDEX + 1))/$TOTAL_TESTS"
else
  echo "⚠️  Ciclo TDD no inicializado"
fi

if [ "$TDD_MODE" = "strict" ]; then
  echo "✅ Modo TDD estricto activado"
else
  echo "⚠️  Modo TDD estricto NO activado"
fi

echo ""
echo "💡 Para más detalles, consulta: TEST_TDD_GUIDE.md"

