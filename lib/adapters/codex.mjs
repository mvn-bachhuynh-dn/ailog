import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { detectProject, matchTicket } from '../config.mjs';

export const name = 'codex';
const CODEX_DB = process.env.CODEX_DB_PATH || join(homedir(), '.codex', 'state_5.sqlite');
export const defaultDir = CODEX_DB;

export function scan(dbPath, config, processed, emit) {
  const db = dbPath || CODEX_DB;
  if (!existsSync(db)) return { sessions: 0, events: 0 };

  let rows;
  try {
    const sql = `SELECT id, created_at, updated_at, cwd, title, first_user_message, git_branch FROM threads WHERE has_user_event = 1 ORDER BY created_at`;
    const raw = execSync(`sqlite3 -json "${db}" "${sql}"`, { encoding: 'utf8', timeout: 10000 });
    rows = JSON.parse(raw || '[]');
  } catch { return { sessions: 0, events: 0 }; }

  let sessions = 0, events = 0;
  for (const row of rows) {
    const key = `codex:${row.id}`;
    if (processed[key] === String(row.updated_at)) continue;

    const cwd = row.cwd || null;
    const project = cwd ? detectProject(cwd, config) : 'unknown';
    const prompt = (row.first_user_message || row.title || '').slice(0, 500);
    const ticket = matchTicket(prompt, config) || (row.git_branch ? matchTicket(row.git_branch, config) : null);

    const startTs = new Date(row.created_at * 1000).toISOString();
    emit({ ts: startTs, event: 'SessionStart', session: row.id, project, ticket, cwd, source: 'codex' });
    events++;

    if (prompt) {
      emit({ ts: startTs, event: 'UserPromptSubmit', session: row.id, project, cwd, source: 'codex', prompt, ticket });
      events++;
    }

    if (row.updated_at && row.updated_at !== row.created_at) {
      emit({ ts: new Date(row.updated_at * 1000).toISOString(), event: 'SessionEnd', session: row.id, project, ticket, cwd, source: 'codex' });
      events++;
    }

    processed[key] = String(row.updated_at);
    sessions++;
  }
  return { sessions, events };
}
