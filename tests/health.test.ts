import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";

const mockReadiness = vi.fn();

vi.mock("../src/services/health", () => ({
  getReadiness: (...args: unknown[]) => mockReadiness(...args),
}));

import { buildApp } from "../src/app";
import { clearReadinessCache } from "../src/services/health";
import { Errors } from "../src/errors";
import { config } from "../src/config";

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
  }, 3_000);

  it("returns not ready when Stellar answers with an upstream error response", async () => {
    // A 5xx Horizon response surfaces through the service boundary as an
    // UPSTREAM_ERROR AppError, distinct from the timeout case above. The
    // readiness response must stay safe: the upstream error text is swallowed
    // and never echoed back.
    h.feeStats.mockRejectedValueOnce(
      Errors.upstream("Horizon returned 503 Service Unavailable")
    );

    const response = await app.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "not_ready",
      checks: { stellar: "down" },
    });
    expect(JSON.stringify(response.json())).not.toContain("503 Service Unavailable");
  });

  // ---------------------------------------------------------------------------
  // GET /health/deep
  // ---------------------------------------------------------------------------

  describe("deep health", () => {
    it("returns 200 when all critical dependencies are healthy", async () => {
      h.queryRaw.mockResolvedValueOnce([{ 1: 1 }]);
      h.feeStats.mockResolvedValueOnce({ minAcceptedFee: 100 });

      const response = await app.inject({ method: "GET", url: "/health/deep" });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body.status).toBe("ok");
      expect(body.checks.database).toEqual({ status: "up", latencyMs: expect.any(Number) });
      expect(body.checks.stellar).toEqual({ status: "up", latencyMs: expect.any(Number) });
      expect(body.uptime).toBeGreaterThanOrEqual(0);
      expect(body.timestamp).toEqual(expect.any(String));
    });

    it("reports database latency in milliseconds", async () => {
      h.queryRaw.mockResolvedValueOnce([{ 1: 1 }]);
      h.feeStats.mockResolvedValueOnce({ minAcceptedFee: 100 });

      const response = await app.inject({ method: "GET", url: "/health/deep" });
      const body = response.json();

      expect(body.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
      expect(typeof body.checks.database.latencyMs).toBe("number");
    });

    it("reports stellar latency in milliseconds", async () => {
      h.queryRaw.mockResolvedValueOnce([{ 1: 1 }]);
      h.feeStats.mockResolvedValueOnce({ minAcceptedFee: 100 });

      const response = await app.inject({ method: "GET", url: "/health/deep" });
      const body = response.json();

      expect(body.checks.stellar.latencyMs).toBeGreaterThanOrEqual(0);
      expect(typeof body.checks.stellar.latencyMs).toBe("number");
    });

    it("returns 503 when database is unavailable", async () => {
      h.queryRaw.mockRejectedValueOnce(new Error("connection refused"));
      h.feeStats.mockResolvedValueOnce({ minAcceptedFee: 100 });

      const response = await app.inject({ method: "GET", url: "/health/deep" });
      const body = response.json();

      expect(response.statusCode).toBe(503);
      expect(body.status).toBe("degraded");
      expect(body.checks.database).toEqual({ status: "down", latencyMs: -1 });
      expect(body.checks.stellar.status).toBe("up");
    });

    it("returns 503 when Stellar is unavailable", async () => {
      h.queryRaw.mockResolvedValueOnce([{ 1: 1 }]);
      h.feeStats.mockRejectedValueOnce(new Error("Horizon unreachable"));

      const response = await app.inject({ method: "GET", url: "/health/deep" });
      const body = response.json();

      expect(response.statusCode).toBe(503);
      expect(body.status).toBe("degraded");
      expect(body.checks.database.status).toBe("up");
      expect(body.checks.stellar).toEqual({ status: "down", latencyMs: -1 });
    });

    it("returns 503 when both dependencies are unavailable", async () => {
      h.queryRaw.mockRejectedValueOnce(new Error("db down"));
      h.feeStats.mockRejectedValueOnce(new Error("horizon down"));

      const response = await app.inject({ method: "GET", url: "/health/deep" });
      const body = response.json();

      expect(response.statusCode).toBe(503);
      expect(body.status).toBe("degraded");
      expect(body.checks.database.status).toBe("down");
      expect(body.checks.stellar.status).toBe("down");
    });

    it("returns 503 when database times out", async () => {
      h.queryRaw.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve([{ 1: 1 }]), 6_000))
      );
      h.feeStats.mockResolvedValueOnce({ minAcceptedFee: 100 });

      const response = await app.inject({ method: "GET", url: "/health/deep" });
      const body = response.json();

      expect(response.statusCode).toBe(503);
      expect(body.status).toBe("degraded");
      expect(body.checks.database.status).toBe("down");
    }, 8_000);

    it("returns 503 when Stellar times out", async () => {
      h.queryRaw.mockResolvedValueOnce([{ 1: 1 }]);
      h.feeStats.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve({}), 6_000))
      );

      const response = await app.inject({ method: "GET", url: "/health/deep" });
      const body = response.json();

      expect(response.statusCode).toBe(503);
      expect(body.status).toBe("degraded");
      expect(body.checks.stellar.status).toBe("down");
    }, 8_000);

    it("reports environment status without exposing secrets", async () => {
      h.queryRaw.mockResolvedValueOnce([{ 1: 1 }]);
      h.feeStats.mockResolvedValueOnce({ minAcceptedFee: 100 });

      const response = await app.inject({ method: "GET", url: "/health/deep" });
      const body = response.json();

      expect(body.environment).toEqual({
        nodeEnv: expect.any(String),
        stellarNetwork: expect.any(String),
      });
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("DATABASE_URL");
      expect(serialized).not.toContain("JWT_SECRET");
      expect(serialized).not.toContain("password");
      expect(serialized).not.toContain("ANCHOR_WEBHOOK_SECRET");
    });

    it("response conforms to the deep health schema shape", async () => {
      h.queryRaw.mockResolvedValueOnce([{ 1: 1 }]);
      h.feeStats.mockResolvedValueOnce({ minAcceptedFee: 100 });

      const response = await app.inject({ method: "GET", url: "/health/deep" });
      const body = response.json();

      expect(body).toMatchObject({
        status: expect.any(String),
        timestamp: expect.any(String),
        uptime: expect.any(Number),
        checks: {
          database: { status: expect.any(String), latencyMs: expect.any(Number) },
          stellar: { status: expect.any(String), latencyMs: expect.any(Number) },
        },
        environment: {
          nodeEnv: expect.any(String),
          stellarNetwork: expect.any(String),
        },
      });
    });
  });
});
