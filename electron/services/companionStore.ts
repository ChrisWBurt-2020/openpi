import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  companionEvidenceRecordSchema,
  projectHarnessProfileSchema,
  type CompanionEvidenceRecord,
  type ProjectHarnessProfile,
  type ProjectHarnessProfilePatch,
  type ProjectHarnessProfileUpdate,
  projectIdForPath,
} from '../../src/lib/companion'

interface JsonRow {
  profile_json?: unknown
  evidence_json?: unknown
}

export type ProfileUpdateResult =
  | { status: 'updated'; profile: ProjectHarnessProfile }
  | { status: 'conflict'; profile: ProjectHarnessProfile }
  | { status: 'missing' }

/**
 * Durable, main-process-only storage for project companion preferences and
 * evidence addresses. Source content remains owned by its Run/session/review
 * store; this database records only resolvable addresses and availability.
 */
export class CompanionStore {
  private readonly db: Database.Database

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(`
      create table if not exists companion_profiles (
        project_id text primary key,
        project_path text not null unique,
        revision integer not null,
        profile_json text not null,
        updated_at text not null
      );
      create table if not exists companion_evidence (
        uri text primary key,
        project_id text not null,
        evidence_json text not null,
        updated_at text not null,
        foreign key(project_id) references companion_profiles(project_id) on delete cascade
      );
      create index if not exists idx_companion_evidence_project
        on companion_evidence(project_id, updated_at desc);
    `)
  }

  close(): void {
    this.db.close()
  }

  ensureProfile(projectPath: string, displayName: string): ProjectHarnessProfile {
    const existing = this.findProfileByPath(projectPath)
    if (existing) return existing
    const now = new Date().toISOString()
    const profile = projectHarnessProfileSchema.parse({
      projectId: projectIdForPath(projectPath),
      projectPath,
      displayName,
      revision: 0,
      appearance: {},
      createdAt: now,
      updatedAt: now,
    })
    this.writeProfile(profile)
    return profile
  }

  getProfile(projectId: string): ProjectHarnessProfile | null {
    const row = this.db
      .prepare('select profile_json from companion_profiles where project_id = ?')
      .get(projectId)
    return this.parseProfile(row)
  }

  findProfileByPath(projectPath: string): ProjectHarnessProfile | null {
    const row = this.db
      .prepare('select profile_json from companion_profiles where project_path = ?')
      .get(projectPath)
    return this.parseProfile(row)
  }

  listProfiles(): ProjectHarnessProfile[] {
    const rows = this.db
      .prepare('select profile_json from companion_profiles order by updated_at desc')
      .all()
    const profiles: ProjectHarnessProfile[] = []
    for (const row of rows) {
      const profile = this.parseProfile(row)
      if (profile) profiles.push(profile)
    }
    return profiles
  }

  updateProfile(request: ProjectHarnessProfileUpdate): ProfileUpdateResult {
    const current = this.getProfile(request.projectId)
    if (!current) return { status: 'missing' }
    if (current.revision !== request.expectedRevision)
      return { status: 'conflict', profile: current }
    const profile = projectHarnessProfileSchema.parse({
      ...current,
      ...profilePatch(current, request.patch),
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    })
    this.writeProfile(profile)
    return { status: 'updated', profile }
  }

  registerEvidence(record: CompanionEvidenceRecord): void {
    const parsed = companionEvidenceRecordSchema.parse(record)
    if (!this.getProfile(parsed.projectId)) throw new Error('Evidence project profile is missing')
    this.db
      .prepare(
        `insert into companion_evidence(uri, project_id, evidence_json, updated_at)
         values (@uri, @projectId, @evidenceJson, @updatedAt)
         on conflict(uri) do update set project_id = excluded.project_id,
           evidence_json = excluded.evidence_json, updated_at = excluded.updated_at`
      )
      .run({
        uri: parsed.uri,
        projectId: parsed.projectId,
        evidenceJson: JSON.stringify(parsed),
        updatedAt: new Date().toISOString(),
      })
  }

  resolveEvidence(uri: string): CompanionEvidenceRecord | null {
    const row = this.db
      .prepare('select evidence_json from companion_evidence where uri = ?')
      .get(uri)
    return this.parseEvidence(row)
  }

  listEvidence(projectId: string): CompanionEvidenceRecord[] {
    const rows = this.db
      .prepare(
        'select evidence_json from companion_evidence where project_id = ? order by updated_at desc'
      )
      .all(projectId)
    const evidence: CompanionEvidenceRecord[] = []
    for (const row of rows) {
      const record = this.parseEvidence(row)
      if (record) evidence.push(record)
    }
    return evidence
  }

  private writeProfile(profile: ProjectHarnessProfile): void {
    this.db
      .prepare(
        `insert into companion_profiles(project_id, project_path, revision, profile_json, updated_at)
         values (@projectId, @projectPath, @revision, @profileJson, @updatedAt)
         on conflict(project_id) do update set project_path = excluded.project_path,
           revision = excluded.revision, profile_json = excluded.profile_json,
           updated_at = excluded.updated_at`
      )
      .run({ ...profile, profileJson: JSON.stringify(profile) })
  }

  private parseProfile(row: unknown): ProjectHarnessProfile | null {
    const parsedRow = jsonRow(row, 'profile_json')
    if (!parsedRow) return null
    return jsonValue(parsedRow.profile_json, projectHarnessProfileSchema)
  }

  private parseEvidence(row: unknown): CompanionEvidenceRecord | null {
    const parsedRow = jsonRow(row, 'evidence_json')
    if (!parsedRow) return null
    return jsonValue(parsedRow.evidence_json, companionEvidenceRecordSchema)
  }
}

function profilePatch(
  current: ProjectHarnessProfile,
  patch: ProjectHarnessProfilePatch
): ProjectHarnessProfilePatch {
  if (!patch.appearance) return patch
  return { ...patch, appearance: { ...current.appearance, ...patch.appearance } }
}

function jsonRow(value: unknown, key: keyof JsonRow): JsonRow | null {
  if (!isRecord(value) || !(key in value)) return null
  if (key === 'profile_json') return { profile_json: value[key] }
  return { evidence_json: value[key] }
}

function jsonValue<T>(
  value: unknown,
  schema: { safeParse: (raw: unknown) => { success: boolean; data?: T } }
): T | null {
  if (typeof value !== 'string') return null
  try {
    const raw: unknown = JSON.parse(value)
    const parsed = schema.safeParse(raw)
    return parsed.success && parsed.data ? parsed.data : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
