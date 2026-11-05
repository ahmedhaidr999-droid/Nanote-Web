# Nanote Native (Flutter)

تطبيق نانوت الأصلي (Native) — نفس مميزات نسخة الويب v1.9.1، مكتوب بـ Flutter بدون أي WebView.

## البنية

```
native/lib/
  main.dart                 — الإقلاع، الثيم، RTL، الترجمة
  theme/nanote_theme.dart   — ألوان v1.9.1 (فاتح/داكن) + ThemeData
  i18n/strings.dart         — عربي/إنجليزي + أرقام هندية
  models/                   — paper/stroke/elements/library/settings
  persistence/              — مخزن ملفات JSON (pages/<id>.json — الحبر مربوط بمعرف الصفحة لا ترتيبها)
  controllers/              — المحرك: stroke engine (تراجع 200)، أدوات، PDF (pdfx buckets)، صوت، ليزر، تمييز أشكال
  services/                 — ترجمة (MyMemory + قاموس)، تصدير PNG/PDF، نسخ احتياطي .nanote، كاش صور
  workspace/                — الرسامون + راوتر الإيماءات + مساحة العمل + شريط الأدوات + filmstrip
  ui/                       — المكتبة، الإعدادات، الأوراق (صفحات/ألوان/نص/ملصقات/ترجمة/صوت)
```

## المميزات

دفاتر ومجلدات ومفضلة ومحذوفات (30 يوماً) • 12 قالب ورق × 3 مقاسات • استيراد PDF كدفتر (رندر متدرج الدقة) • 5 أنواع أقلام + 16 لوناً + تظليل مجموعات • ممحاة خطوط/مساحة • 12 شكلاً متجهياً + تمييز أشكال (RDP) • نص RTL + صور + ملصقات (إيموجي + PNG) • تحديد لاسو مع تجميع ونقل/تحجيم/تدوير • حافظة وترتيب z • مسطرة بمغناطيس 15° • ليزر (وضعان) • صوت متزامن مع الحبر (replay) • ترجمة + Ask AI • تصدير PNG/PDF ومشاركة • نسخ احتياطي كامل • رفض الكف وأزرار القلم القابلة للتخصيص • مظهر داكن/فاتح وعربي/إنجليزي.

## البناء محلياً

```bash
cd native
flutter create --platforms=android --org com.nanote --project-name nanote .
flutter pub get
flutter run            # أو flutter build apk --release
```

## CI

`.github/workflows/native-apk.yml` — عند كل دفع لـ `native-v2`: توليد منصة أندرويد، تحليل، بناء release، توقيع بمفتاح NANOTE_*، رفع artifact + prerelease باسم `native-latest`.
