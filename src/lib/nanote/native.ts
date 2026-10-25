// Nanote native bridge — every Capacitor call lives in this module and is
// lazy-imported behind isNative(), so the browser bundle never pulls plugin
// code and browser behavior stays exactly the same as before.
// In the Android APK (WebView served from https://localhost) these helpers
// give the web app native superpowers: share-sheet exports, live app info,
// themed system bars and a real hardware back button.
import { APP_VERSION } from './version';

type CapGlobal = { isNativePlatform?: () => boolean };

const capGlobal = (): CapGlobal | undefined =>
  (window as unknown as { Capacitor?: CapGlobal }).Capacitor;

export const isNative = (): boolean => {
  try {
    return capGlobal()?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
};

/** Open the GitHub releases page (user-initiated; external browser on Android). */
export const openReleasesPage = (): void => {
  window.open('https://github.com/ahmedhaidr999-droid/Nanote-Web/releases', '_blank', 'noopener,noreferrer');
};

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Export/share a file natively: the blob is written to the app cache, then
 * handed to the Android system share sheet (save to Files / Drive, print,
 * send via WhatsApp, etc.). "Cancel" resolves quietly — real failures still
 * reject so callers can toast them.
 */
export async function nativeShareBlob(blob: Blob, filename: string, title: string): Promise<'shared' | 'downloaded'> {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const path = `nanote-exports/${filename.replace(/[^\w.\-]+/g, '_')}`;
  await Filesystem.writeFile({
    path,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
    encoding: Encoding.ASCII, // base64 payload
    recursive: true,
  });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  try {
    await Share.share({
      title,
      dialogTitle: title,
      files: [uri], // file:// URL — wrapped through the FileProvider
    });
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? e);
    if (/cancel/i.test(msg)) return 'shared'; // user dismissed the sheet
    throw e;
  } finally {
    void Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {});
  }
  return 'shared';
}

/** Installed version: APK versionName on Android, APP_VERSION in the browser. */
export async function getAppVersion(): Promise<string> {
  if (!isNative()) return APP_VERSION;
  try {
    const { App } = await import('@capacitor/app');
    return (await App.getInfo()).version || APP_VERSION;
  } catch {
    return APP_VERSION;
  }
}

/** Match the Android system bars to the app theme (no-op in the browser). */
export async function applyNativeStatusBar(dark: boolean): Promise<void> {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: dark ? '#0E1622' : '#F7F9FC' });
  } catch {
    /* cosmetic only */
  }
}

/** Register the Android hardware back button (no-op in the browser). */
export async function registerNativeBackButton(onExit: () => void): Promise<void> {
  if (!isNative()) return;
  const { App } = await import('@capacitor/app');
  const { useApp } = await import('./store');
  App.addListener('backButton', () => {
    const s = useApp.getState();
    if (s.view.name === 'editor') s.closeEditor();
    else if (s.view.name === 'library' || s.view.name === 'onboarding') onExit();
    else s.goBack();
  });
}
