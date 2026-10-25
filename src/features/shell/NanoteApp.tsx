'use client';
// Nanote application shell — boot sequence, theme/lang/dir application,
// view routing (single-page app router) and error containment.
import { Component, ErrorInfo, ReactNode, useEffect } from 'react';
import { useApp, useT } from '@/lib/nanote/store';
import { AppIcon } from '@/components/nanote/AppIcon';
import * as db from '@/lib/nanote/idb';
import { applyNativeStatusBar, registerNativeBackButton } from '@/lib/nanote/native';

import OnboardingView from '@/features/onboarding/OnboardingView';
import LibraryView from '@/features/library/LibraryView';
import CreateNotebookView from '@/features/notebook/CreateNotebookView';
import SettingsView from '@/features/settings/SettingsView';
import EditorShell from '@/features/editor/EditorShell';

// ---------------------------------------------------------------- error boundary
class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[nanote] crashed', error, info) }
  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center">
          <AppIcon size={72} />
          <h1 className="text-xl font-bold">Something went wrong</h1>
          <p className="max-w-md text-sm text-muted-foreground">{String(this.state.error.message ?? this.state.error)}</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground press-scale"
          >
            Reload Nanote
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------- boot splash
function BootSplash() {
  const { t } = useT();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background">
      <div className="view-enter">
        <AppIcon size={96} className="shadow-ink-2 rounded-[26%]" />
      </div>
      <div className="text-center">
        <div className="text-2xl font-bold tracking-tight">{t('app.name')}</div>
        <div className="mt-1 text-sm text-muted-foreground">{t('app.tagline')}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- router
function Router() {
  const view = useApp((s) => s.view);
  const booted = useApp((s) => s.booted);
  const { t } = useT();

  if (!booted) return <BootSplash />;

  const showStorageBanner = db.isMemoryMode();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {showStorageBanner && (
        <div className="bg-warning/15 px-4 py-1.5 text-center text-xs font-medium text-warning">
          {t('library.storageBanner')}
        </div>
      )}
      <div key={view.name} className="view-enter flex min-h-0 flex-1 flex-col">
        {view.name === 'onboarding' && <OnboardingView />}
        {view.name === 'library' && <LibraryView />}
        {view.name === 'create-notebook' && <CreateNotebookView folderId={view.folderId} />}
        {view.name === 'settings' && <SettingsView />}
        {view.name === 'editor' && <EditorShell notebookId={view.notebookId} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- root
export default function NanoteApp() {
  const settings = useApp((s) => s.settings);

  // boot once
  useEffect(() => {
    void useApp.getState().boot();
  }, []);

  // apply lang/dir instantly (no restart)
  useEffect(() => {
    const d = document.documentElement;
    d.lang = settings.lang;
    d.dir = settings.lang === 'ar' ? 'rtl' : 'ltr';
  }, [settings.lang]);

  // apply theme (light/dark/system) + keep Android system bars in sync
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
      void applyNativeStatusBar(dark);
    };
    apply();
    if (settings.theme === 'system') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
    return;
  }, [settings.theme]);

  // Android hardware back button: editor → library, inner views → back,
  // library/onboarding → exit (no-op in the browser)
  useEffect(() => {
    let dead = false;
    void registerNativeBackButton(() => {
      if (dead) return;
      import('@capacitor/app').then(({ App }) => App.exitApp()).catch(() => {});
    });
    return () => { dead = true; };
  }, []);

  // Persist pending page saves when leaving / hiding — WITHOUT closing the
  // editor. The old behavior navigated back to the library on every
  // backgrounding, so coming back to the app kicked the user out of the PDF
  // they were reading. Now the editor stays open; and even if the OS kills
  // the process, boot() session-restore reopens the same notebook+page.
  useEffect(() => {
    const flush = () => {
      useApp.getState().flushSaves();
    };
    window.addEventListener('pagehide', flush);
    const onVis = () => { if (document.hidden) flush() };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return (
    <AppErrorBoundary>
      <Router />
    </AppErrorBoundary>
  );
}
