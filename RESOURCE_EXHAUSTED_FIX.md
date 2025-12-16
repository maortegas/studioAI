# Error `resource_exhausted` - Solución Implementada

## ¿Qué causa el error `resource_exhausted`?

El error `{"error": "resource_exhausted: ConnectError: [resource_exhausted] Error\n"}` ocurre cuando la API de Cursor/Claude rechaza solicitudes debido a:

1. **Rate Limiting**: Demasiadas solicitudes en un período corto
2. **Límite de Concurrencia**: Múltiples jobs ejecutándose simultáneamente
3. **Límite de Recursos**: La API tiene límites en tokens, memoria, o capacidad de procesamiento
4. **Sobrecarga del Servicio**: El servicio de IA está temporalmente sobrecargado

## Solución Implementada

### 1. Control de Concurrencia
- **Máximo 2 jobs simultáneos** para evitar saturar la API
- Cola de procesamiento que espera cuando se alcanza el límite
- Delay de 2 segundos entre el inicio de cada job

### 2. Reintentos Automáticos
- **3 reintentos** con backoff exponencial (5s → 10s → 20s)
- Detección automática de errores `resource_exhausted`
- Timeout aumentado a 10 minutos para operaciones largas

### 3. Manejo de Errores Mejorado
- Logs detallados para debugging
- Actualización correcta del estado en la base de datos
- Mensajes informativos al usuario

## Cómo Funciona

```
Job 1 → Inicia → API Call
Job 2 → Espera 2s → Inicia → API Call
Job 3 → Espera (capacidad alcanzada) → Espera que Job 1 o 2 termine
```

Si un job falla con `resource_exhausted`:
1. Worker detecta el error
2. Espera 5 segundos
3. Reintenta (hasta 3 veces)
4. Si todos fallan, marca el job como `failed`

## Monitoreo

Los logs del worker mostrarán:
- `[Worker] At capacity (2/2 active jobs). Waiting...` - Cuando está al límite
- `[Worker] Resource exhausted error detected. Retrying in 5s...` - Cuando detecta el error
- `[Worker] Job {id} completed. Active jobs: 1/2` - Cuando un job termina

## Recomendaciones

1. **No crear múltiples jobs simultáneamente** - El sistema los procesará en orden
2. **Monitorear los logs** - Para ver el estado de los jobs
3. **Esperar entre solicitudes** - Si creas jobs manualmente, espera unos segundos entre cada uno
4. **Revisar jobs fallidos** - Si un job falla, puedes reintentarlo manualmente

## Configuración

El límite de concurrencia está configurado en:
```typescript
const MAX_CONCURRENT_JOBS = 2; // En packages/worker/src/worker.ts
```

Puedes ajustarlo según tus necesidades, pero se recomienda mantenerlo bajo (2-3) para evitar rate limiting.
