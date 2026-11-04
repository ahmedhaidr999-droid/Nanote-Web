import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:pdfx/pdfx.dart';

/// الطبقة الخلفية: فتح المستند عبر pdfx (محرك PDFium) + رندرة متدرجة
/// الدقة (Quality Buckets) مع كاش LRU محكوم الذاكرة.
///
/// استراتيجية الدقة — هذا ما يجعل النص حاداً بدون أي تهنيج:
///  1. أثناء إيماءة التكبير: صفر رندرة على الإطلاق؛ الصورة الحالية
///     تُكبَّر بمصفوفة GPU فقط (تظل نسبية الحدة مقبولة للحظة).
///  2. بعد استقرار التكبير 220ms: تُرَنْدَر الصفحات المرئية فقط بالدقة
///     الجديدة المطلوبة (scale × dpr) ضمن سقف ذاكرة محدد.
///  3. عند التصغير: يُعاد استخدام النسخة الأعلى دقة كما هي (تظل حادة).
///
/// ملاحظة pdfx: أندرويد لا يسمح بالرندرة المتوازية، لذا كل عمليات
/// الصفحات (فتح/رندرة/إغلاق) تمر عبر طابور مسلسل واحد.
class PdfDocumentController extends ChangeNotifier {
  PdfDocumentController({this.maxRenderWidthPx = 2200});

  static const List<double> _buckets = [1.0, 1.5, 2.0, 3.0, 4.0];

  /// حد الكاش — نحو 18 صورة صفحة كحد أقصى في الذاكرة (LRU).
  static const int _maxCached = 18;

  /// سقف عرض أي صورة مرندرة بالبكسل (تضييق الذاكرة على الأجهزة الضعيفة).
  final double maxRenderWidthPx;

  PdfDocument? _doc;
  final Map<int, Size> _pointSizes = {};
  final Map<String, ui.Image> _cache = {};
  final List<String> _lru = [];
  final Set<String> _rendering = {};

  /// الطابور المسلسل لعمليات الصفحات (متطلب pdfx على أندرويد).
  Future<void> _queueTail = Future<void>.value();

  bool _blank = false;
  bool _disposed = false;
  String? _error;
  double _basePixelWidth = 1080;

  int pageCount = 0;

  bool get isBlank => _blank;
  bool get isReady => _blank || _doc != null;
  String? get error => _error;

  /// تسلسل كل عمليات الصفحات عبر طابور واحد — بلا أي توازٍ.
  Future<void> _enqueue(Future<void> Function() task) {
    final result = _queueTail.then((_) => task());
    _queueTail = result.then<void>((_) {}, onError: (Object _) {});
    return result;
  }

  // ───────────────────────── الفتح ─────────────────────────

  /// وضع الدفتر الفارغ — يعمل بلا ملف PDF (تجربة فورية للمحرك).
  Future<void> openBlank({int pages = 3}) async {
    _blank = true;
    pageCount = pages;
    for (var i = 0; i < pages; i++) {
      _pointSizes[i] = const Size(595, 842); // A4
    }
    notifyListeners();
  }

  Future<void> open({String? path, Uint8List? bytes, String? asset}) async {
    try {
      _doc = path != null
          ? await PdfDocument.openFile(path)
          : bytes != null
              ? await PdfDocument.openData(bytes)
              : await PdfDocument.openAsset(asset!);
      pageCount = _doc!.pagesCount;
      notifyListeners();
      _loadPageSizes();
    } catch (e) {
      _error = '$e';
      notifyListeners();
    }
  }

  /// تُحمَّل مقاسات الصفحات بالخلفية — التخطيط يبدأ فوراً بمقاس A4
  /// الافتراضي ثم يصحح نفسه تدريجياً (بدون قفزات مع مستندات موحّدة).
  void _loadPageSizes() {
    final doc = _doc;
    if (doc == null) return;
    _enqueue(() async {
      for (var i = 0; i < pageCount; i++) {
        if (_disposed || _pointSizes.containsKey(i)) continue;
        try {
          final size = await _readPageSize(doc, i);
          _pointSizes[i] = size;
          if (i < 3 || i % 10 == 0) notifyListeners();
        } catch (_) {
          continue;
        }
      }
      if (!_disposed) notifyListeners();
    });
  }

  Future<Size> _readPageSize(PdfDocument doc, int page) async {
    final p = await doc.getPage(page + 1); // pdfx يبدأ الترقيم من 1
    try {
      return Size(p.width, p.height);
    } finally {
      await p.close();
    }
  }

  /// مقاس الصفحة بنقاط PDF (مع بديل A4 آمن حتى تصل المقاسات الحقيقية).
  Size pointSize(int page) {
    final s = _pointSizes[page] ?? _pointSizes[0] ?? const Size(595, 842);
    if (s.width <= 0 ||
        s.height <= 0 ||
        !s.width.isFinite ||
        !s.height.isFinite) {
      return const Size(595, 842);
    }
    return s;
  }

  /// يحدده Workspace: عرض المستند المنطقي × كثافة الشاشة.
  void configure({required double basePixelWidth}) {
    _basePixelWidth = basePixelWidth;
  }

  // ───────────────────── الرندرة المتدرجة ─────────────────────

  /// أصغر "دلو" دقة يغطي الحاجة الحالية (scale × dpr).
  double bucketFor(double scale, double dpr) {
    final need = scale * dpr;
    for (final b in _buckets) {
      if (b >= need) return b;
    }
    return _buckets.last;
  }

  int _pxFor(double bucket) {
    final raw = (_basePixelWidth * bucket).round();
    return raw.clamp(240, maxRenderWidthPx.round()).toInt();
  }

  String _key(int page, int px) => '$page@$px';

  /// أفضل صورة متاحة: يفضَّل أعلى دقة موجودة ≥ المطلوبة، وإلا أدق
  /// نسخة أقل (تُكبَّر مؤقتاً حتى تكتمل النسخة الأعلى).
  ui.Image? pickBitmap(int page, double bucket) {
    ui.Image? fallback;
    for (final b in const [4.0, 3.0, 2.0, 1.5, 1.0]) {
      final key = _key(page, _pxFor(b));
      final img = _cache[key];
      if (img == null) continue;
      if (b + 1e-9 >= bucket) return _touch(key, img);
      fallback ??= _touch(key, img);
    }
    return fallback;
  }

  ui.Image _touch(String key, ui.Image img) {
    _lru.remove(key);
    _lru.add(key);
    return img;
  }

  /// طلب رندرة (مُزال التكرار بالكامل): لا يفعل شيئاً إذا وُجدت نسخة
  /// بنفس الدقة أو أدق، أو إذا كانت نفس النسخة قيد الرندرة أصلاً.
  void ensureRendered(int page, double bucket) {
    final doc = _doc;
    if (_blank || doc == null || page < 0 || page >= pageCount) return;

    final px = _pxFor(bucket);

    for (final b in _buckets) {
      if (b + 1e-9 < bucket) continue;
      if (_cache.containsKey(_key(page, _pxFor(b)))) return;
    }
    final key = _key(page, px);
    if (_cache.containsKey(key) || _rendering.contains(key)) return;

    _rendering.add(key);
    _enqueue(() async {
      try {
        if (_disposed) return;
        await _renderInto(doc, page, px, key);
        if (!_disposed) notifyListeners();
      } catch (err) {
        debugPrint('Nanote PDF render failed (page ${page + 1}): $err');
      } finally {
        _rendering.remove(key);
      }
    });
  }

  Future<void> _renderInto(
      PdfDocument doc, int page, int px, String key) async {
    final p = await doc.getPage(page + 1);
    ui.Image? image;
    try {
      // pdfx 2.11 يتطلب العرض والارتفاع معاً — نحافظ على نسبة الصفحة.
      final h = px * p.height / p.width;
      final rendered = await p.render(
        width: px.toDouble(),
        height: h,
        backgroundColor: '#FFFFFF',
      );
      if (rendered == null || _disposed) return;

      // pdfx يعيد بايتات مضغوطة (JPEG) → نفك الترميز إلى ui.Image.
      final codec = await ui.instantiateImageCodec(rendered.bytes);
      final frame = await codec.getNextFrame();
      image = frame.image;
    } finally {
      // pdfx: يجب إغلاق الصفحة بعد الرندرة (أندرويد لا يسمح بالتوازي).
      await p.close();
    }

    if (_disposed) {
      image.dispose();
      return;
    }
    _store(key, image);
  }

  void _store(String key, ui.Image img) {
    _cache.remove(key)?.dispose();
    _cache[key] = img;
    _lru.remove(key);
    _lru.add(key);
    while (_lru.length > _maxCached) {
      final oldest = _lru.removeAt(0);
      _cache.remove(oldest)?.dispose();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _doc?.close();
    _doc = null;
    for (final img in _cache.values) {
      img.dispose();
    }
    _cache.clear();
    super.dispose();
  }
}
