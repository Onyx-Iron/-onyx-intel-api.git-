import { assertIntegrationTestEnvReady, loadIntegrationTestEnv } from "../lib/test-utils/integration-guard";
import { verifyRemoteTakeoffSchema } from "../lib/test-utils/schema-fingerprint";

async function main(): Promise<void> {
  const env = loadIntegrationTestEnv();
  const required = process.env.CI === "true" || process.env.REQUIRE_INTEGRATION_TESTS === "true";
  if (!assertIntegrationTestEnvReady(env, required)) {
    console.log(`Integration schema check skipped: ${env.skipReason}`);
    return;
  }

  const result = await verifyRemoteTakeoffSchema({
    supabaseUrl: env.supabaseUrl!,
    serviceKey: env.serviceKey!,
  });

  console.log(
    `Integration schema verified for ${result.projectRef} ` +
    `(${result.checkedPathCount} required takeoff boundaries)`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
