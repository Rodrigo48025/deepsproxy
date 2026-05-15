/*
 * File: deepseek.ts
 * Project: deepsproxy
 * Author: Pedro Farias
 * Created: 2026-05-09
 * 
 * Last Modified: Sat May 09 2026
 * Modified By: Pedro Farias
 */

import { getDeepSeekHeaders } from './playwright.ts';
import { getSession, getSessionByChatSessionId, upsertSession } from './sessionStore.ts';

export function updateSessionParent(sessionId: string, parentId: number | null, chatSessionId: string) {
  if (sessionId && chatSessionId) {
    upsertSession(sessionId, chatSessionId, parentId);
  }
}

export interface DeepSeekPayload {
  chat_session_id?: string;
  parent_message_id?: number | null;
  model_type: string | null;
  prompt: string;
  ref_file_ids: string[];
  thinking_enabled: boolean;
  search_enabled: boolean;
  preempt: boolean;
}

export async function createDeepSeekStream(
  prompt: string, 
  enableThinking: boolean, 
  forcedParentId?: number | null,
  sessionId?: string
): Promise<{ stream: ReadableStream, headers: Record<string, string>, uiSessionId: string, sessionId: string }> {
  // Obtain fresh headers/PoW from Playwright
  // If forcedParentId is null, it means we are explicitly starting a new session
  const { headers, chatSessionId, parentMessageId } = await getDeepSeekHeaders(forcedParentId === null);

  let effectiveSessionId = sessionId || chatSessionId;
  let actualParentId: number | null = parentMessageId;

  const savedSession = sessionId ? getSession(sessionId) : undefined;
  if (!savedSession && chatSessionId) {
    const sessionByChatId = getSessionByChatSessionId(chatSessionId);
    if (sessionByChatId) {
      effectiveSessionId = sessionByChatId.id;
    }
  }

  if (forcedParentId !== undefined) {
    actualParentId = forcedParentId;
  } else if (savedSession) {
    actualParentId = savedSession.parent_message_id;
  } else if (!savedSession && chatSessionId) {
    const sessionByChatId = getSessionByChatSessionId(chatSessionId);
    if (sessionByChatId) {
      actualParentId = sessionByChatId.parent_message_id;
    }
  }

  if (!effectiveSessionId) {
    effectiveSessionId = chatSessionId;
  }

  if (effectiveSessionId && chatSessionId) {
    upsertSession(effectiveSessionId, chatSessionId, actualParentId);
  }

  const payload: DeepSeekPayload = {
    chat_session_id: chatSessionId || undefined,
    parent_message_id: actualParentId,
    model_type: null,
    prompt: prompt,
    ref_file_ids: [],
    thinking_enabled: enableThinking,
    search_enabled: true,
    preempt: false
  };

  const response = await fetch('https://chat.deepseek.com/api/v0/chat/completion', {
    method: 'POST',
    headers: {
      'accept': '*/*',
      'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'authorization': headers['authorization'],
      'content-type': 'application/json',
      'origin': 'https://chat.deepseek.com',
      'x-ds-pow-response': headers['x-ds-pow-response'],
      'x-hif-dliq': headers['x-hif-dliq'],
      'x-hif-leim': headers['x-hif-leim'],
      'x-app-version': '20240126.1',
      'x-client-locale': 'pt_BR',
      'x-client-platform': 'web',
      'x-client-version': '1.0.0'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Failed to fetch from DeepSeek: ${response.status} ${response.statusText} - ${errText}`);
  }

  return { stream: response.body, headers, uiSessionId: chatSessionId, sessionId: effectiveSessionId };
}
