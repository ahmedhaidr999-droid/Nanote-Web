import type { CapacitorConfig } from '@capacitor/cli';

// Nanote Android app — the browser app, unchanged, served from local assets
// by the system WebView (https://localhost = secure context, so IndexedDB,
// MediaRecorder, Workers and the pdf.js stack all behave exactly like the
// browser). No server, no network, no accounts.
const config: CapacitorConfig = {
  appId: 'com.nanote.web',
  appName: 'Nanote',
  webDir: 'out',
  server: {
    androidScheme: 'https',
    hostname: 'localhost',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
