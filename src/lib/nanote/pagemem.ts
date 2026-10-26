// Nanote reading memory — survives process death (app killed in background,
// tab discarded, page refresh) via localStorage. Two records:
//   • per-notebook last-read page  → reopening a file lands on the last page
//   • open-notebook session        → cold boot reopens the file that was open
// localStorage is synchronous, tiny-string-cheap and persists in both the
// browser and the Android WebView. Every access is guarded — private-mode or
// blocked storage must never crash the app.

const PAGE_PREFIX = 'nanote.lastPage.';
const SESSION_KEY = 'nanote.session';

/** Remember the last page the user was reading in a notebook. */
export function rememberPage(notebookId: string, pageId: string): void {
  try { localStorage.setItem(PAGE_PREFIX + notebookId, pageId) } catch { /* ignore */ }
}

/** Last page read in a notebook, or null when never opened. */
export function recallPage(notebookId: string): string | null {
  try { return localStorage.getItem(PAGE_PREFIX + notebookId) } catch { return null }
}

/** Mark a notebook as the currently-open session (cold boot reopens it). */
export function rememberSession(notebookId: string): void {
  try { localStorage.setItem(SESSION_KEY, notebookId) } catch { /* ignore */ }
}

/** The user explicitly left the editor — the next boot shows the library. */
export function clearSession(): void {
  try { localStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
}

/** The notebook that was open when the app last ran, or null. */
export function recallSession(): string | null {
  try { return localStorage.getItem(SESSION_KEY) } catch { return null }
}

// ------------------------------------------------------------------ library place memory
// The tab/folder the user was browsing in the library. Survives app restarts so
// a note created inside a tab is found in that tab when the user comes back —
// the library reopens exactly where the user left it.

const NAV_KEY = 'nanote.lastNav';

/** Remember the library browsing place (tab + folder). */
export function rememberNav(tabId: string | null, folderId: string | null): void {
  try { localStorage.setItem(NAV_KEY, JSON.stringify({ tabId, folderId })) } catch { /* ignore */ }
}

/** The last library browsing place, or nulls when never recorded. */
export function recallNav(): { tabId: string | null; folderId: string | null } {
  try {
    const raw = localStorage.getItem(NAV_KEY);
    if (!raw) return { tabId: null, folderId: null };
    const v = JSON.parse(raw) as { tabId?: string | null; folderId?: string | null };
    return { tabId: v.tabId ?? null, folderId: v.folderId ?? null };
  } catch { return { tabId: null, folderId: null } }
}
