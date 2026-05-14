/*
 * File: playwright.ts
 * Project: deepsproxy
 * Author: Pedro Farias
 * Created: 2026-05-09
 */

import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';

let context: BrowserContext | null = null;
export let activePage: Page | null = null;

// Lock para garantir que apenas uma navegação acontece por vez
let navigationLock: Promise<void> = Promise.resolve();

export async function initPlaywright(forceHeadless?: boolean) {
  if (process.env.TEST_MOCK_PLAYWRIGHT) return;
  if (context) return;

  // Prioridade: argumento da função > .env > default (true)
  const isHeadless = forceHeadless !== undefined ? forceHeadless : (process.env.PLAYWRIGHT_HEADLESS !== 'false');
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined;
  
  // Caminho absoluto para garantir que os cookies são os mesmos do login
  const profilePath = path.resolve(process.cwd(), 'deepseek_profile');
  
  console.log(`🌐 [Playwright] Inicializando browser (Headless: ${isHeadless})`);
  console.log(`📂 [Playwright] Usando perfil: ${profilePath}`);

  context = await chromium.launchPersistentContext(profilePath, {
    headless: isHeadless,
    executablePath,
    viewport: { width: 1280, height: 720 },
  });

  // Reutiliza a página inicial que o PersistentContext abre automaticamente
  const pages = context.pages();
  activePage = pages[0];

  // Fecha abas extras se existirem
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close();
  }

  if (!activePage) {
    activePage = await context.newPage();
  }
}

export async function closePlaywright() {
  if (process.env.TEST_MOCK_PLAYWRIGHT) return;
  if (context) {
    await context.close();
    context = null;
    activePage = null;
  }
}

export async function getDeepSeekHeaders(forceNew = false): Promise<{ headers: Record<string, string>, chatSessionId: string, parentMessageId: number | null }> {
  // Aguarda a sua vez na fila
  const currentLock = navigationLock;
  let release: () => void;
  navigationLock = new Promise((resolve) => { release = resolve; });
  await currentLock;

  try {
    if (!activePage) throw new Error('Playwright não inicializado');

    console.log('🔄 [Auth] Capturando novo PoW...');

    // Navega para o DeepSeek se necessário ou se estivermos na página de login
    const currentUrl = activePage.url();
    const isAtLogin = currentUrl.includes('/sign_in') || currentUrl.includes('/login');
    
    if (!currentUrl.includes('chat.deepseek.com') || isAtLogin || forceNew) {
      console.log(`🌐 [Auth] Navegando para chat.deepseek.com (URL actual: ${currentUrl})...`);
      await activePage.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    // Espera pelo textarea — é a prova definitiva de que estamos logados
    console.log('⏳ [Auth] Aguardando interface do chat...');
    const textarea = await activePage.waitForSelector('textarea', { timeout: 15000 }).catch(() => null);

    if (!textarea) {
      // O textarea não apareceu — agora sim verificamos se estamos na página de login
      const finalUrl = activePage.url();
      console.error(`❌ [Auth] textarea não encontrado. URL actual: ${finalUrl}`);
      
      if (finalUrl.includes('/login') || finalUrl.includes('/sign_in')) {
        throw new Error('SESSÃO EXPIRADA: O DeepSeek redirecionou para login. Executa "npm run login".');
      }
      throw new Error(`SESSÃO EXPIRADA: Interface do chat não carregou. URL: ${finalUrl}. Executa "npm run login".`);
    }

    console.log('✅ [Auth] Interface do chat detectada. Capturando PoW...');

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        activePage?.unroute('**/api/v0/chat/completion').catch(() => {});
        reject(new Error('TIMEOUT: O DeepSeek não gerou o desafio PoW a tempo (25s).'));
      }, 25000);

      activePage!.route('**/api/v0/chat/completion', async (route, request) => {
        if (request.method() !== 'POST') return route.continue();
        
        clearTimeout(timeout);
        const reqHeaders = request.headers();
        let uiSessionId = '';
        let uiParentMessageId: number | null = null;

        const postData = request.postData();
        if (postData) {
          try {
            const payload = JSON.parse(postData);
            uiSessionId = payload.chat_session_id || '';
            uiParentMessageId = payload.parent_message_id ?? null;
          } catch {}
        }

        const extractedHeaders = {
          'x-ds-pow-response': reqHeaders['x-ds-pow-response'] || '',
          'authorization': reqHeaders['authorization'] || '',
          'cookie': reqHeaders['cookie'] || '',
          'x-hif-dliq': reqHeaders['x-hif-dliq'] || '',
          'x-hif-leim': reqHeaders['x-hif-leim'] || ''
        };

        // ABORTA o pedido para não "sujar" o chat com mensagens "a"
        await route.abort('aborted');
        await activePage!.unroute('**/api/v0/chat/completion').catch(() => {});

        console.log(`🔑 [Token OK] Session: ${uiSessionId}`);
        resolve({ headers: extractedHeaders, chatSessionId: uiSessionId, parentMessageId: uiParentMessageId });
      });

      // Digita "a" para disparar o desafio PoW
      activePage!.fill('textarea', 'a')
        .then(() => activePage!.keyboard.press('Enter'))
        .catch(reject);
    });
  } finally {
    // Libera o lock para o próximo pedido na fila
    release!();
  }
}
