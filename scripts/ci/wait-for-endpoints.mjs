import net from 'node:net';

const endpoints = process.argv.slice(2);
if (!endpoints.length) throw new Error('Pass at least one http(s):// or tcp:// endpoint');

const timeoutMs = Number(process.env.CI_WAIT_TIMEOUT_MS ?? 120_000);
const pollMs = Number(process.env.CI_WAIT_POLL_MS ?? 2_000);

function checkTcp(url) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
    const finish = error => {
      socket.destroy();
      error ? reject(error) : resolve();
    };
    socket.setTimeout(2_000, () => finish(new Error('connection timed out')));
    socket.once('connect', () => finish());
    socket.once('error', finish);
  });
}

async function checkEndpoint(value) {
  const url = new URL(value);
  if (url.protocol === 'tcp:') return checkTcp(url);
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

const pending = new Set(endpoints);
const deadline = Date.now() + timeoutMs;
const errors = new Map();

while (pending.size && Date.now() < deadline) {
  await Promise.all([...pending].map(async endpoint => {
    try {
      await checkEndpoint(endpoint);
      pending.delete(endpoint);
      errors.delete(endpoint);
      process.stdout.write(`Ready: ${endpoint}\n`);
    } catch (error) {
      errors.set(endpoint, error.message);
    }
  }));
  if (pending.size) await new Promise(resolve => setTimeout(resolve, pollMs));
}

if (pending.size) {
  const details = [...pending].map(endpoint => `${endpoint}: ${errors.get(endpoint) ?? 'not ready'}`).join('\n');
  throw new Error(`Endpoints did not become ready within ${timeoutMs}ms:\n${details}`);
}
