import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { detectProject } from '../config.mjs';

export const name = 'gemini';
const GEMINI_DIR = process.env.GEMINI_DIR || join(homedir(), '.gemini');
export const defaultDir = GEMINI_DIR;

export function scan(dir, config, processed, emit) {
  const geminiDir = dir || GEMINI_DIR;
  const tmpDir = join(geminiDir, 'tmp');
  if (!existsSync(tmpDir)) return { sessions: 0, events: 0 };

  // Gemini stores projects in ~/.gemini/tmp/<name>/chats/<session>.json
  // and maps paths in ~/.gemini/projects.json
  let projectMap = {};
  try { projectMap = JSON.parse(readFileSync(join(geminiDir, 'projects.json'), 'utf8')); } catch {}

  let sessions = 0, events = 0;
  let projectDirs;
  try { projectDirs = readdirSync(tmpDir); } catch { return { sessions: 0, events: 0 }; }

  for (const projName of projectDirs) {
    const chatsDir = join(tmpDir, projName, 'chats');
    if (!existsSync(chatsDir)) continue;

    let chatFiles;
    try { chatFiles = readdirSync(chatsDir).filter(f => f.endsWith('.json')); } catch { continue; }

    // Reverse-lookup cwd from projects.json
    const cwd = Object.entries(projectMap).find(([, v]) => v === projName)?.[0] || null;
    const project = cwd ? detectProject(cwd, config) : projName;

    for (const file of chatFiles) {
      const sessionId = file.replace('.json', '');
      const key = `gemini:${sessionId}`;
      const filePath = join(chatsDir, file);
      let mtime;
      try { mtime = statSync(filePath).mtimeMs; } catch { continue; }
      if (processed[key] === String(Math.floor(mtime))) continue;

      let chat;
      try { chat = JSON.parse(readFileSync(filePath, 'utf8')); } catch { continue; }

      // Gemini chat format: array of messages or object with messages
      const messages = Array.isArray(chat) ? chat : (chat.messages || chat.turns || []);
      const userMsgs = messages.filter(m => m.role === 'user' && m.content);

      if (userMsgs.length === 0) continue;

      // Use file mtime as approximate timestamp if no timestamps in data
      const baseTs = chat.createdAt || chat.created_at || mtime;
      const startTs = new Date(typeof baseTs === 'number' && baseTs > 1e12 ? baseTs : baseTs * 1000).toISOString();

      emit({ ts: startTs, event: 'SessionStart', session: sessionId, project, cwd, source: 'gemini' });
      events++;

      for (const msg of userMsgs) {
        const ts = msg.timestamp ? new Date(msg.timestamp).toISOString() : startTs;
        const prompt = (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)).slice(0, 500);
        emit({ ts, event: 'UserPromptSubmit', session: sessionId, project, cwd, source: 'gemini', prompt });
        events++;
      }

      processed[key] = String(Math.floor(mtime));
      sessions++;
    }
  }
  return { sessions, events };
}
