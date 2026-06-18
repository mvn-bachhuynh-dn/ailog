#!/usr/bin/env node
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { TIMELOG_DIR, loadConfig } from '../lib/config.mjs';
import * as kiroAdapter from '../lib/adapters/kiro.mjs';
import * as claudeAdapter from '../lib/adapters/claude.mjs';
import * as codexAdapter from '../lib/adapters/codex.mjs';
import * as geminiAdapter from '../lib/adapters/gemini.mjs';

const ADAPTERS = [kiroAdapter, claudeAdapter, codexAdapter, geminiAdapter];

function loadProcessed(dir) {
  try { return JSON.parse(readFileSync(join(dir, '.processed.json'), 'utf8')); } catch { return {}; }
}

function makeEmitter(timelogDir) {
  return (entry) => {
    const clean = Object.fromEntries(Object.entries(entry).filter(([, v]) => v != null));
    appendFileSync(join(timelogDir, `${entry.ts.slice(0, 10)}.jsonl`), JSON.stringify(clean) + '\n');
  };
}

export function scanSessions(kiroDir, timelogDir, claudeFile) {
  timelogDir = timelogDir || TIMELOG_DIR;
  const config = loadConfig(timelogDir);
  mkdirSync(timelogDir, { recursive: true });
  const processed = loadProcessed(timelogDir);
  const emit = makeEmitter(timelogDir);

  const results = {};
  for (const adapter of ADAPTERS) {
    let dir;
    if (adapter.name === 'kiro') dir = kiroDir || adapter.defaultDir;
    else if (adapter.name === 'claude') dir = claudeFile || adapter.defaultDir;
    else dir = adapter.defaultDir;

    try {
      results[adapter.name] = adapter.scan(dir, config, processed, emit);
    } catch {
      results[adapter.name] = { sessions: 0, events: 0 };
    }
  }

  writeFileSync(join(timelogDir, '.processed.json'), JSON.stringify(processed));

  const total = Object.values(results).reduce((a, r) => ({ sessions: a.sessions + r.sessions, events: a.events + r.events }), { sessions: 0, events: 0 });
  return { newSessions: total.sessions, newEvents: total.events, ...results, error: null };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = scanSessions();
  if (r.error) console.error(`Error: ${r.error}`);
  else {
    const parts = [];
    for (const adapter of ADAPTERS) {
      const d = r[adapter.name];
      if (d?.sessions) parts.push(`${adapter.name}: ${d.sessions} sessions/${d.events} events`);
    }
    if (!parts.length) parts.push('No new data');
    console.log(`${parts.join(' | ')} → ${TIMELOG_DIR}`);
  }
}
