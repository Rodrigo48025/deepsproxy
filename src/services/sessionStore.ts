import fs from 'fs';
import path from 'path';
import type { Message } from '../utils/types.ts';

export interface SessionRecord {
  id: string;
  chat_session_id: string;
  parent_message_id: number | null;
  messages: Message[];
  updated_at: string;
}

const useMemoryDb = Boolean(process.env.TEST_MOCK_PLAYWRIGHT || process.env.NODE_ENV === 'test');
const sessionsFile = useMemoryDb ? null : path.resolve(process.cwd(), 'sessions.json');

let sessions: Record<string, SessionRecord> = {};
let chatSessionIndex: Record<string, string> = {};

function loadSessions(): void {
  if (!sessionsFile) return;
  try {
    const raw = fs.readFileSync(sessionsFile, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, SessionRecord>;
    sessions = parsed || {};
    chatSessionIndex = {};
    for (const id of Object.keys(sessions)) {
      const record = sessions[id];
      if (record.chat_session_id) {
        chatSessionIndex[record.chat_session_id] = id;
      }
      record.messages = record.messages || [];
    }
  } catch (error) {
    sessions = {};
    chatSessionIndex = {};
  }
}

function persistSessions(): void {
  if (!sessionsFile) return;
  fs.writeFileSync(sessionsFile, JSON.stringify(sessions, null, 2), 'utf-8');
}

loadSessions();

export function getSession(sessionId: string): SessionRecord | null {
  return sessions[sessionId] || null;
}

export function getSessionByChatSessionId(chatSessionId: string): SessionRecord | null {
  const sessionId = chatSessionIndex[chatSessionId];
  return sessionId ? sessions[sessionId] || null : null;
}

export function upsertSession(sessionId: string, chatSessionId: string, parentMessageId: number | null, messages?: Message[]): void {
  const now = new Date().toISOString();
  const existing = sessions[sessionId];
  sessions[sessionId] = {
    id: sessionId,
    chat_session_id: chatSessionId || existing?.chat_session_id || '',
    parent_message_id: parentMessageId,
    messages: messages ?? existing?.messages ?? [],
    updated_at: now,
  };
  if (sessions[sessionId].chat_session_id) {
    chatSessionIndex[sessions[sessionId].chat_session_id] = sessionId;
  }
  if (!useMemoryDb) {
    persistSessions();
  }
}

export function setSessionMessages(sessionId: string, messages: Message[]): void {
  const existing = sessions[sessionId];
  const now = new Date().toISOString();
  sessions[sessionId] = {
    id: sessionId,
    chat_session_id: existing?.chat_session_id || '',
    parent_message_id: existing?.parent_message_id ?? null,
    messages,
    updated_at: now,
  };
  if (sessions[sessionId].chat_session_id) {
    chatSessionIndex[sessions[sessionId].chat_session_id] = sessionId;
  }
  if (!useMemoryDb) {
    persistSessions();
  }
}
