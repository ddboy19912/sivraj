import { Hono } from "hono";

export const healthRoutes = new Hono();

healthRoutes.get("/", (c) =>
  c.json({
    ok: true,
    service: "sivraj-api",
  }),
);

healthRoutes.get("/storage", (c) => {
  const checks = {
    authConfigured: hasEnv("JWT_SECRET"),
    databaseConfigured: hasEnv("DATABASE_URL"),
    suiConfigured: hasEnv("SUI_RPC_URL") && hasEnv("SUI_PRIVATE_KEY"),
    sealConfigured:
      hasEnv("SEAL_PACKAGE_ID") &&
      hasEnv("SEAL_POLICY_ID") &&
      hasEnv("SEAL_KEY_SERVERS"),
    walrusConfigured: hasEnv("WALRUS_NETWORK") && hasEnv("WALRUS_EPOCHS"),
    uploadRelayConfigured: hasEnv("WALRUS_UPLOAD_RELAY_URL"),
  };

  const ready = Object.values(checks).every(Boolean);

  return c.json({
    ok: ready,
    service: "sivraj-api",
    storage: {
      mode: "encrypted_walrus",
      checks,
      ready,
    },
  });
});

function hasEnv(key: string): boolean {
  const value = process.env[key];
  return typeof value === "string" && value.length > 0;
}
