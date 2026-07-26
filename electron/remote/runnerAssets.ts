/** Versioned, user-owned remote runner programs. They deliberately depend only
 * on Node's standard library and the privately installed Pi runtime. */
export const RUNNER_DAEMON = String.raw`
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

const home = process.env.HOME;
if (!home) process.exit(2);
const runtime = path.join(home, '.openpi', 'runtime', '0.82.1');
const runDir = path.join(home, '.openpi', 'run');
const socketPath = path.join(runDir, 'runner.sock');
fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
try { fs.unlinkSync(socketPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const runners = new Map();

function send(socket, line) { if (!socket.destroyed) socket.write(line + '\n'); }
function stop(runner) { runner.child.kill('TERM'); setTimeout(() => runner.child.kill('KILL'), 3000).unref(); }
function spawnRunner(id, cwd, environment) {
  const pi = path.join(runtime, 'node_modules', '.bin', 'pi');
  const child = spawn(pi, ['--mode', 'rpc', '--approve'], {
    cwd,
    env: { ...process.env, ...environment },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });
  const runner = { child, clients: new Set(), buffer: [], partial: '' };
  runners.set(id, runner);
  const receive = (chunk) => {
    runner.partial += chunk.toString('utf8');
    const lines = runner.partial.split('\n');
    runner.partial = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (!line) continue;
      runner.buffer.push(line);
      if (runner.buffer.length > 4000) runner.buffer.shift();
      for (const client of runner.clients) send(client, line);
    }
  };
  child.stdout.on('data', receive);
  child.stderr.on('data', (chunk) => {
    const event = JSON.stringify({ type: 'session_event', event: { type: 'remote_runner_stderr', text: chunk.toString('utf8').slice(0, 2000) } });
    runner.buffer.push(event); for (const client of runner.clients) send(client, event);
  });
  child.on('exit', (code) => {
    const event = JSON.stringify({ type: 'session_event', event: { type: 'remote_runner_exit', code } });
    for (const client of runner.clients) send(client, event);
    runners.delete(id);
  });
  return runner;
}

const server = net.createServer((socket) => {
  let partial = ''; let attached = null;
  socket.on('data', (chunk) => {
    partial += chunk.toString('utf8');
    const lines = partial.split('\n'); partial = lines.pop() ?? '';
    for (const raw of lines) {
      if (!raw.trim()) continue;
      let message; try { message = JSON.parse(raw); } catch { socket.destroy(); return; }
      if (message.type === 'attach') {
        if (attached) { socket.destroy(); return; }
        attached = String(message.runnerId);
        let runner = runners.get(attached);
        if (!runner) runner = spawnRunner(attached, String(message.cwd), message.env && typeof message.env === 'object' ? message.env : {});
        runner.clients.add(socket);
        for (const line of runner.buffer) send(socket, line);
        continue;
      }
      if (!attached) { socket.destroy(); return; }
      const runner = runners.get(attached);
      if (!runner) { socket.destroy(); return; }
      if (message.type === 'terminate') { stop(runner); continue; }
      runner.child.stdin.write(raw + '\n');
    }
  });
  socket.on('close', () => { if (attached) runners.get(attached)?.clients.delete(socket); });
});
server.listen(socketPath, () => fs.chmodSync(socketPath, 0o600));
`

export const RUNNER_CONNECTOR = String.raw`
import net from 'node:net';
const home = process.env.HOME;
if (!home) process.exit(2);
const runtime = home + '/.openpi/runtime/0.82.1';
const socketPath = home + '/.openpi/run/runner.sock';
const attach = JSON.stringify({
  type: 'attach', runnerId: process.env.OPENPI_RUNNER_ID,
  cwd: process.env.OPENPI_WORKSPACE,
  env: Object.fromEntries(Object.entries(process.env).filter(([key]) => /(_API_KEY|_TOKEN)$/.test(key))),
});
const socket = net.connect(socketPath);
socket.on('connect', () => { socket.write(attach + '\n'); process.stdin.pipe(socket); });
socket.pipe(process.stdout);
socket.on('error', () => process.exit(1));
`
