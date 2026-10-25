import type { CapacitorConfig } from '@capacitor/cli';

// Nanote Android app — an INDEPENDENT platform. The web bundle served from
// local assets by the system WebView (https://localhost = secure context, so
// IndexedDB, MediaRecorder, Workers and the pdf.js stack all behave exactly
// like the browser). No server, no accounts — storage is unlimited on the
// device's own disk. The only network use is the translation platform
// (online engines + language-pack downloads), declared since v1.3.0.
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
