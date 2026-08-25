import { prisma } from "../db";
import { config } from "../config";
import { getFeeStats } from "./network";

const CHECK_TIMEOUT_MS = 5_000;
const READINESS_CACHE_TTL_MS = 5_000;

export interface ReadinessResponse {
  status: "ok" | "degraded";
  database: { connected: boolean };
  stellar: { reachable: boolean; network: string };
  timestamp: string;
}

let cached: { response: ReadinessResponse; expiresAt: number } | null = null;
let inFlight: Promise<ReadinessResponse> | null = null;

function withTimeout<T>(operation: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("health check timeout")), CHECK_TIMEOUT_MS);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function checkDatabase(): Promise<boolean> {
  try {
    await withTimeout(prisma.$queryRawUnsafe('SELECT 1') as Promise<unknown>);
    return true;
  } catch {
    return false;
  }
}

export async function checkStellar(): Promise<boolean> {
  try {
    // getFeeStats uses the shared Horizon client and its existing short cache.
    await withTimeout(getFeeStats());
    return true;
  } catch {
    return false;
  }
}

async function performReadinessCheck(): Promise<ReadinessResponse> {
  const [dbResult, stellarResult] = await Promise.allSettled([
    checkDatabase(),
    checkStellar(),
  ]);

  const database = dbResult.status === "fulfilled" && dbResult.value;
  const stellar = stellarResult.status === "fulfilled" && stellarResult.value;

  const status: "ok" | "degraded" = database && stellar ? "ok" : "degraded";

  return {
    status,
    database: { connected: database },
    stellar: { reachable: stellar, network: config.STELLAR_NETWORK },
    timestamp: new Date().toISOString(),
  };
}

export async function getReadiness(): Promise<ReadinessResponse> {
  if (cached && cached.expiresAt > Date.now()) return cached.response;

  if (!inFlight) {
    inFlight = performReadinessCheck()
      .then((response) => {
        cached = { response, expiresAt: Date.now() + READINESS_CACHE_TTL_MS };
        return response;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  return inFlight;
}

export function clearReadinessCache(): void {
  cached = null;
}
