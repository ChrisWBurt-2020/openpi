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
  const extension = path.join(runtime, 'openpi-run-continuity.mjs');
  const child = spawn(pi, ['--mode', 'rpc', '--approve', '-e', extension], {
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

/** Remote equivalent of the trusted local Run extension. It emits only
 * structured tool details; Electron main remains the orchestration owner. */
export const RUNNER_RUN_EXTENSION = String.raw`
import { Type } from 'typebox';
let context = null;
const names = ['openpi_report_run_outcome', 'openpi_request_run_input', 'openpi_report_run_checkpoint'];
const contextFrom = (args) => { try { const value = JSON.parse(Buffer.from(args, 'base64url').toString('utf8')); return value && typeof value.id === 'string' ? value : null; } catch { return null; } };
const details = (type, payload) => ({ openpiRunControl: { type, context, payload } });
export default function(pi) {
  pi.registerCommand('openpi-run-context', { description: 'OpenPi internal Run context.', handler: async (args) => { context = contextFrom(args); } });
  pi.registerCommand('openpi-run-continue', { description: 'OpenPi internal Run continuation.', handler: async () => {
    if (!context) return;
    pi.sendMessage({ customType: 'openpi-run-continuation', content: '[OpenPi Run continuation] Continue the active task. Reinspect current state, do not repeat completed work, and finish, block, or request input.', display: false, details: { continuationId: context.continuationId ?? null, runId: context.id } }, { deliverAs: 'followUp', triggerTurn: true });
  } });
  pi.on('before_agent_start', (event) => {
    const active = pi.getActiveTools().filter((name) => !names.includes(name));
    pi.setActiveTools(context ? [...active, ...names] : active);
    return context ? { systemPrompt: event.systemPrompt + '\n\n## OpenPi Run contract\nGive a concise plan, then begin the first executable step in this same turn. Use openpi_report_run_outcome or openpi_request_run_input as the only tool call in their assistant batch.' } : undefined;
  });
  pi.registerTool({ name: 'openpi_report_run_outcome', label: 'Report Run Outcome', description: 'Report completed or blocked Run outcome.', parameters: Type.Object({ status: Type.Union([Type.Literal('completed'), Type.Literal('blocked')]), contractVersion: Type.Integer(), summary: Type.String(), verification: Type.Optional(Type.Array(Type.Object({ label: Type.String(), result: Type.String(), evidenceToolCallId: Type.Optional(Type.String()), notes: Type.Optional(Type.String()) }))), blockers: Type.Optional(Type.Array(Type.Object({ kind: Type.String(), message: Type.String(), suggestedAction: Type.Optional(Type.String()) }))), remainingWork: Type.Optional(Type.Array(Type.String())) }), async execute(_id, payload) { if (!context || payload.contractVersion !== context.contractVersion) return { content: [{ type: 'text', text: 'Run outcome rejected.' }], details: {}, terminate: true }; return { content: [{ type: 'text', text: 'Run outcome recorded.' }], details: details('outcome', payload), terminate: true }; } });
  pi.registerTool({ name: 'openpi_request_run_input', label: 'Request Run Input', description: 'Request a necessary user decision.', parameters: Type.Object({ question: Type.String(), reason: Type.String(), options: Type.Optional(Type.Array(Type.Object({ id: Type.String(), label: Type.String(), description: Type.Optional(Type.String()) }))) }), async execute(_id, payload) { if (!context) return { content: [{ type: 'text', text: 'Run input rejected.' }], details: {}, terminate: true }; return { content: [{ type: 'text', text: 'Run waits for input.' }], details: details('input', payload), terminate: true }; } });
  pi.registerTool({ name: 'openpi_report_run_checkpoint', label: 'Report Run Checkpoint', description: 'Report meaningful Run progress.', parameters: Type.Object({ phase: Type.String(), summary: Type.String(), completedSteps: Type.Optional(Type.Array(Type.String())), nextStep: Type.Optional(Type.String()), evidenceToolCallIds: Type.Optional(Type.Array(Type.String())) }), async execute(_id, payload) { if (!context) return { content: [{ type: 'text', text: 'Run checkpoint rejected.' }], details: {} }; return { content: [{ type: 'text', text: 'Run checkpoint recorded.' }], details: details('checkpoint', payload) }; } });
}
`
