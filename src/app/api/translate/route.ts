// POST /api/translate — the in-app translation engine for selected PDF text.
// Backend-only z-ai-web-dev-sdk usage (never client-side). Used by the
// editor's text-selection toolbar to translate a highlighted passage.
//
// BROWSER VERSION ONLY for now: the Android APK is a static export with no
// server, so when the user asks to port the app we must decide (a) give the
// APK INTERNET permission for this single endpoint, or (b) ship the APK
// without translation. The client already degrades gracefully (toast error).
import { NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';

const MAX_CHARS = 5000;

const LANG_NAMES: Record<string, string> = {
  ar: 'Arabic',
  en: 'English',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  tr: 'Turkish',
  ru: 'Russian',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  hi: 'Hindi',
  ur: 'Urdu',
  fa: 'Persian',
  id: 'Indonesian',
  ms: 'Malay',
};

export async function POST(req: Request) {
  let body: { text?: string; target?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const text = (body.text ?? '').toString().trim();
  const target = (body.target ?? 'ar').toString().toLowerCase();
  if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 });
  if (text.length > MAX_CHARS) return NextResponse.json({ error: 'text too long' }, { status: 400 });

  const targetName = LANG_NAMES[target] ?? 'Arabic';
  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          content:
            `You are a translation engine. Translate the user's text into ${targetName}. ` +
            'Preserve meaning, tone and formatting (line breaks, lists). ' +
            'Detect the source language automatically; if the text is already in the target language, translate it into English instead. ' +
            'Reply with ONLY the translation — no preamble, no quotes, no explanations.',
        },
        { role: 'user', content: text },
      ],
      thinking: { type: 'disabled' },
    });
    const translation = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!translation) return NextResponse.json({ error: 'empty translation' }, { status: 502 });
    return NextResponse.json({ translation, target });
  } catch (e) {
    console.warn('[nanote] translate failed', e);
    return NextResponse.json({ error: 'translation failed' }, { status: 502 });
  }
}
