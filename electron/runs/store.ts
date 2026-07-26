import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { RunState } from '../../src/lib/runs'
import { migrateRunState } from './state'

export class RunStore {
  private readonly db: Database.Database

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      create table if not exists runs (
        id text primary key, session_path text, thread_id text not null,
        workspace_path text not null, checkout_id text not null,
        lifecycle text not null, state_json text not null, updated_at text not null
      );
      drop index if exists idx_runs_checkout_active;
      create table if not exists run_events (
        run_id text not null, sequence integer not null, type text not null,
        payload_json text not null, created_at text not null,
        primary key(run_id, sequence)
      );
      create table if not exists run_dispatches (
        continuation_id text primary key, run_id text not null,
        dispatched_at text, acknowledged_at text
      );
      create table if not exists run_checkout_leases (
        checkout_id text primary key, run_id text not null, run_epoch integer not null,
        updated_at text not null
      );
      create table if not exists run_meta (key text primary key, value text not null);
      insert or replace into run_meta(key, value) values ('schema_version', '2');
    `)
  }

  save(state: RunState, checkoutId: string, eventType: string): void {
    const now = new Date().toISOString()
    const tx = this.db.transaction(() => {
      const row = this.db
        .prepare('select coalesce(max(sequence), 0) as sequence from run_events where run_id = ?')
        .get(state.id) as { sequence: number }
      const sequence = row.sequence + 1
      this.db
        .prepare(`insert into runs(id, session_path, thread_id, workspace_path, checkout_id, lifecycle, state_json, updated_at)
          values (?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(id) do update set session_path=excluded.session_path, thread_id=excluded.thread_id,
          workspace_path=excluded.workspace_path, lifecycle=excluded.lifecycle, state_json=excluded.state_json, updated_at=excluded.updated_at`)
        .run(
          state.id,
          state.sessionPath,
          state.threadId ?? '',
          state.workspacePath,
          checkoutId,
          state.lifecycle,
          JSON.stringify(state),
          now
        )
      if (!holdsCheckoutLease(state)) {
        this.db.prepare('delete from run_checkout_leases where run_id = ?').run(state.id)
      } else {
        this.db
          .prepare(`insert into run_checkout_leases(checkout_id, run_id, run_epoch, updated_at)
            values (?, ?, ?, ?)
            on conflict(checkout_id) do update set run_epoch=excluded.run_epoch, updated_at=excluded.updated_at
            where run_checkout_leases.run_id = excluded.run_id`)
          .run(checkoutId, state.id, state.runEpoch, now)
      }
      this.db
        .prepare(
          'insert into run_events(run_id, sequence, type, payload_json, created_at) values (?, ?, ?, ?, ?)'
        )
        .run(state.id, sequence, eventType, JSON.stringify(state), now)
    })
    tx()
  }

  getByThread(threadId: string): RunState | null {
    const row = this.db
      .prepare('select state_json from runs where thread_id = ? order by updated_at desc limit 1')
      .get(threadId) as { state_json: string } | undefined
    return row ? this.parse(row.state_json) : null
  }

  getBySession(sessionPath: string): RunState | null {
    const row = this.db
      .prepare(
        'select state_json from runs where session_path = ? order by updated_at desc limit 1'
      )
      .get(sessionPath) as { state_json: string } | undefined
    return row ? this.parse(row.state_json) : null
  }

  list(workspacePath?: string): RunState[] {
    const rows = workspacePath
      ? this.db
          .prepare('select state_json from runs where workspace_path = ? order by updated_at desc')
          .all(workspacePath)
      : this.db.prepare('select state_json from runs order by updated_at desc').all()
    return (rows as Array<{ state_json: string }>).flatMap((row) => {
      const value = this.parse(row.state_json)
      return value ? [value] : []
    })
  }

  hasCheckoutOwner(checkoutId: string): boolean {
    return Boolean(
      this.db
        .prepare(
          "select 1 from run_checkout_leases lease join runs on runs.id = lease.run_id where lease.checkout_id = ? and runs.lifecycle != 'terminal' limit 1"
        )
        .get(checkoutId)
    )
  }

  /** No sidecar is confirmed at startup, so recovery always requires an explicit Resume. */
  releaseRestartedRuns(): void {
    const rows = this.db.prepare('select id, state_json from runs').all() as Array<{
      id: string
      state_json: string
    }>
    const now = new Date().toISOString()
    const tx = this.db.transaction(() => {
      for (const row of rows) {
        const state = this.parse(row.state_json)
        if (!state || state.lifecycle === 'terminal') continue
        const paused: RunState = {
          ...state,
          lifecycle: 'paused',
          phase: null,
          activeTurnId: null,
          activeTools: {},
          recoveryNotice: 'OpenPi restarted. Resume explicitly after inspecting the workspace.',
          updatedAt: now,
          lastEventAt: now,
        }
        this.db
          .prepare('update runs set lifecycle = ?, state_json = ?, updated_at = ? where id = ?')
          .run(paused.lifecycle, JSON.stringify(paused), now, row.id)
      }
      this.db.prepare('delete from run_checkout_leases').run()
    })
    tx()
  }

  releaseLease(runId: string): void {
    this.db.prepare('delete from run_checkout_leases where run_id = ?').run(runId)
  }

  scheduleDispatch(continuationId: string, runId: string): boolean {
    const result = this.db
      .prepare('insert or ignore into run_dispatches(continuation_id, run_id) values (?, ?)')
      .run(continuationId, runId)
    return result.changes === 1
  }

  acknowledgeDispatch(continuationId: string): void {
    this.db
      .prepare(
        'update run_dispatches set dispatched_at = coalesce(dispatched_at, ?), acknowledged_at = ? where continuation_id = ?'
      )
      .run(new Date().toISOString(), new Date().toISOString(), continuationId)
  }

  private parse(value: string): RunState | null {
    try {
      return migrateRunState(JSON.parse(value))
    } catch {
      return null
    }
  }
}

/** A disconnected or unconfirmed worker cannot truthfully reserve a checkout. */
function holdsCheckoutLease(state: RunState): boolean {
  if (state.lifecycle === 'terminal') return false
  return !(
    state.lifecycle === 'waiting' &&
    (state.waitingReason === 'connection_lost' || state.waitingReason === 'runner_unconfirmed')
  )
}
