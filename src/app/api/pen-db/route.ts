// GET /api/pen-db — serves the stylus knowledge base (version + records) as
// JSON. The app fetches this at runtime (Settings → Electronic pens → Update
// database) and merges any NEWER version via pendb.mergePenDb() — the pen
// database updates WITHOUT an app update. Records ship with the same honesty
// contract as the bundled module: confidence badges + sources per record.
//
// APK NOTE: this tree builds with `output: "export"` (the Android app is a
// static bundle), so the route is FORCE-STATIC — Next prerenders the response
// to a JSON file the WebView can still fetch. The client degrades gracefully
// (up-to-date toast) wherever the file can't be reached.
import { NextResponse } from 'next/server';
import { serializePenDb } from '@/lib/nanote/pendb';

export const dynamic = 'force-static';

export async function GET() {
  return NextResponse.json(serializePenDb(), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
