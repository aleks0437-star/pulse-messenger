import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const timeoutMs = Number(process.env.CI_WAIT_TIMEOUT_MS ?? 120_000);
const pollMs = Number(process.env.CI_WAIT_POLL_MS ?? 2_000);
const expectations = [
  { service: 'postgres', state: 'healthy' },
  { service: 'redis', state: 'healthy' },
  { service: 'minio', state: 'healthy' },
  { service: 'minio-init', state: 'completed' },
  { service: 'livekit', state: 'running' },
];

async function run(command, args) {
  return execFileAsync(command, args, { maxBuffer: 10 * 1024 * 1024 });
}

async function inspectService(service) {
  const { stdout } = await run('docker', ['compose', 'ps', '--all', '--quiet', service]);
  const id = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!id) return { ready: false, detail: 'container not created' };

  const inspected = await run('docker', ['inspect', '--format', '{{json .State}}', id]);
  const state = JSON.parse(inspected.stdout.trim());
  const health = state.Health?.Status;
  return {
    raw: state,
    detail: health ? `${state.Status}/${health}` : state.Status,
  };
}

function isReady(expectation, state) {
  if (expectation.state === 'healthy') {
    return state.raw?.Status === 'running' && state.raw?.Health?.Status === 'healthy';
  }
  if (expectation.state === 'completed') {
    return state.raw?.Status === 'exited' && state.raw?.ExitCode === 0;
  }
  return state.raw?.Status === 'running';
}

async function printDiagnostics() {
  try {
    const { stdout, stderr } = await run('docker', ['compose', 'ps', '--all']);
    process.stderr.write(`\nCompose state at timeout:\n${stdout}${stderr}`);
  } catch (error) {
    process.stderr.write(`\nCould not collect Compose state: ${error.message}\n`);
  }
}

const deadline = Date.now() + timeoutMs;
let lastSummary = '';

while (Date.now() < deadline) {
  try {
    const states = await Promise.all(expectations.map(async expectation => ({
      expectation,
      inspected: await inspectService(expectation.service),
    })));
    const summary = states.map(({ expectation, inspected }) => `${expectation.service}=${inspected.detail}`).join(', ');
    if (summary !== lastSummary) {
      process.stdout.write(`Waiting for Compose: ${summary}\n`);
      lastSummary = summary;
    }
    if (states.every(({ expectation, inspected }) => isReady(expectation, inspected))) {
      process.stdout.write('Compose dependencies are ready.\n');
      process.exit(0);
    }

    const failed = states.find(({ expectation, inspected }) =>
      expectation.state !== 'completed' && inspected.raw?.Status === 'exited',
    );
    if (failed) throw new Error(`${failed.expectation.service} exited with code ${failed.inspected.raw.ExitCode}`);
    const bootstrapFailed = states.find(({ expectation, inspected }) =>
      expectation.state === 'completed' && inspected.raw?.Status === 'exited' && inspected.raw?.ExitCode !== 0,
    );
    if (bootstrapFailed) throw new Error(`${bootstrapFailed.expectation.service} exited with code ${bootstrapFailed.inspected.raw.ExitCode}`);
  } catch (error) {
    if (/exited with code/.test(error.message)) {
      await printDiagnostics();
      throw error;
    }
    lastSummary = `inspection failed: ${error.message}`;
    process.stdout.write(`${lastSummary}\n`);
  }
  await new Promise(resolve => setTimeout(resolve, pollMs));
}

await printDiagnostics();
throw new Error(`Compose services did not become ready within ${timeoutMs}ms`);
