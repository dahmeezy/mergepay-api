# Health endpoints

The API exposes an unauthenticated operational probe:

- `GET /health` returns the overall health of the API, including database
  connectivity (Prisma) and Stellar Horizon network status. Returns `200` with
  `{ "status": "ok", ... }` when both checks pass, or `503` with
  `{ "status": "degraded", ... }` when a dependency is unavailable.

## Response format

```json
{
  "status": "ok",
  "database": { "connected": true },
  "stellar": { "reachable": true, "network": "testnet" },
  "timestamp": "2026-01-15T12:00:00.000Z"
}
```

## Behaviour

- The database check runs `SELECT 1` via Prisma to verify the connection is
  alive.
- The Stellar check pings Horizon via the shared fee-stats client.
- Both checks run concurrently with a 5-second timeout each.
- Results are cached for five seconds to avoid thundering herds.
- Responses contain only dependency state and never include connection strings,
  URLs, credentials, or upstream error details.

## Operational notes

The API and worker are separate processes. This endpoint reports API process
and API dependency health only; it does not assert that the background worker
is running. Monitor the worker process independently using its process
supervisor, logs, and job metrics. A healthy `/health` response therefore
does not mean settlement submission or reconciliation jobs are being consumed.
