import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";

const mockReadiness = vi.fn();

vi.mock("../src/services/health", () => ({
  getReadiness: (...args: unknown[]) => mockReadiness(...args),
}));

import healthRoutes from "../src/routes/health";

function createApp() {
  const app = Fastify({ logger: false });
  app.register(healthRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /health", () => {
  it("returns 200 with status ok when all checks pass", async () => {
    mockReadiness.mockResolvedValue({
      status: "ok",
      database: { connected: true },
      stellar: { reachable: true, network: "testnet" },
      timestamp: new Date().toISOString(),
    });

    const app = createApp();
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.database.connected).toBe(true);
    expect(body.stellar.reachable).toBe(true);
    expect(body.stellar.network).toBe("testnet");
    expect(typeof body.timestamp).toBe("string");
  });

  it("returns 503 with status degraded when database is down", async () => {
    mockReadiness.mockResolvedValue({
      status: "degraded",
      database: { connected: false },
      stellar: { reachable: true, network: "testnet" },
      timestamp: new Date().toISOString(),
    });

    const app = createApp();
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe("degraded");
    expect(body.database.connected).toBe(false);
    expect(body.stellar.reachable).toBe(true);
  });

  it("returns 503 with status degraded when stellar is unreachable", async () => {
    mockReadiness.mockResolvedValue({
      status: "degraded",
      database: { connected: true },
      stellar: { reachable: false, network: "testnet" },
      timestamp: new Date().toISOString(),
    });

    const app = createApp();
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe("degraded");
    expect(body.database.connected).toBe(true);
    expect(body.stellar.reachable).toBe(false);
  });

  it("returns 503 when both checks fail", async () => {
    mockReadiness.mockResolvedValue({
      status: "degraded",
      database: { connected: false },
      stellar: { reachable: false, network: "testnet" },
      timestamp: new Date().toISOString(),
    });

    const app = createApp();
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe("degraded");
    expect(body.database.connected).toBe(false);
    expect(body.stellar.reachable).toBe(false);
  });

  it("requires no authentication", async () => {
    mockReadiness.mockResolvedValue({
      status: "ok",
      database: { connected: true },
      stellar: { reachable: true, network: "testnet" },
      timestamp: new Date().toISOString(),
    });

    const app = createApp();
    // No authorization header
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
  });
});
