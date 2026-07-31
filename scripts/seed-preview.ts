/**
 * REMOVABLE PREVIEW SCRIPT — local QA only.
 *
 * Usage:
 *   npm run db:seed:preview                 # seeds the full "selling" stage
 *   npm run db:seed:preview -- discovery    # classic A
 *   npm run db:seed:preview -- accepted     # classic B
 *   npm run db:seed:preview -- sample_approved        # classic C
 *   npm run db:seed:preview -- batch_arrived_ready    # classic D
 *   npm run db:seed:preview -- selling      # classic E (default)
 *   npm run db:seed:preview -- wave1_two_sku
 *   npm run db:seed:preview -- wave1_beginner_blocked
 *   npm run db:seed:preview -- wave1_ready_add  # leaves 15 Topic A weeks; re-seed before clean path tests
 *   npm run db:seed:preview -- wave1_archived
 *   npm run db:seed:preview -- wave1_marketing_paths
 *
 * Delete this file + `src/lib/preview/` to remove preview support entirely.
 */

import { seedPreview } from "../src/lib/preview/seed";
import { isPreviewStage, PREVIEW_STAGES, type PreviewStage } from "../src/lib/preview/config";

function parseStage(): PreviewStage {
  const arg = (process.argv[2] ?? process.env.STAGE ?? "selling").trim();
  if (!isPreviewStage(arg)) {
    console.error(
      `Unknown stage "${arg}". Valid stages: ${PREVIEW_STAGES.join(", ")}`,
    );
    process.exit(1);
  }
  return arg;
}

async function main() {
  const stage = parseStage();
  console.log(`\nSeeding preview data → stage "${stage}"...\n`);
  const result = await seedPreview(stage);

  for (const note of result.notes) console.log(`  • ${note}`);

  console.log(`\n✓ Preview ready at stage "${result.stage}".`);
  console.log(`  Login:    ${result.email}`);
  console.log(`  Password: ${result.password}`);
  console.log(`\n  Start the app with PREVIEW_MODE=1 and open /en/dashboard.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗ Preview seed failed:\n", err);
  process.exit(1);
});
