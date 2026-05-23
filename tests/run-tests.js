#!/usr/bin/env node
/**
 * Nexus card regression test runner.
 *
 * Usage:
 *   node tests/run-tests.js
 *   node tests/run-tests.js city-of-traitors   (run single scenario by name fragment)
 *
 * Requires:
 *   - forge-api server running on http://localhost:4567
 *   - Node 18+ (built-in fetch)
 */

const h = require('./helpers');

const ALL_SCENARIOS = [
  require('./scenarios/city-of-traitors'),
  require('./scenarios/wild-growth'),
  require('./scenarios/wilds-growth'),
  require('./scenarios/utopia-sprawl'),
  require('./scenarios/creature-land-zone'),
];

const filter = process.argv[2]?.toLowerCase();
const scenarios = filter
  ? ALL_SCENARIOS.filter(s => s.name.toLowerCase().includes(filter))
  : ALL_SCENARIOS;

async function checkServer() {
  try {
    const res = await fetch('http://localhost:4567/api/status');
    if (!res.ok) throw new Error(`Status ${res.status}`);
  } catch (e) {
    console.error('ERROR: forge-api server is not reachable at http://localhost:4567');
    console.error('Start the server with: java -jar forge-api/forge-api.jar');
    process.exit(1);
  }
}

async function runScenario(scenario) {
  let gameId = null;
  try {
    const session = await h.startDebugGame();
    gameId = session.id;
    await scenario.run(gameId);
    return { passed: true };
  } catch (e) {
    return { passed: false, error: e.message };
  } finally {
    if (gameId) await h.concedeGame(gameId);
  }
}

async function main() {
  console.log('Nexus card regression tests');
  console.log('─'.repeat(60));

  await checkServer();

  // Create a minimal test deck
  process.stdout.write('Setting up test deck... ');
  try {
    await h.ensureTestDeck();
    console.log('OK');
  } catch (e) {
    console.error(`FAILED: ${e.message}`);
    process.exit(1);
  }

  if (scenarios.length === 0) {
    console.log(`No scenarios match filter: "${filter}"`);
    process.exit(1);
  }

  let passed = 0, failed = 0;
  const failures = [];

  for (const scenario of scenarios) {
    process.stdout.write(`  [ ] ${scenario.name}`);
    const start = Date.now();
    const result = await runScenario(scenario);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    if (result.passed) {
      process.stdout.write(`\r  [PASS] ${scenario.name} (${elapsed}s)\n`);
      passed++;
    } else {
      process.stdout.write(`\r  [FAIL] ${scenario.name} (${elapsed}s)\n`);
      console.log(`         ${result.error}`);
      failed++;
      failures.push({ name: scenario.name, error: result.error });
    }
  }

  console.log('─'.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  // Cleanup
  try { await h.cleanupTestDeck(); } catch {}

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
