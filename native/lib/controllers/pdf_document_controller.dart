import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:pdfx/pdfx.dart';

/// One open PDF (PDFium via pdfx) with progressive quality buckets and an
/// LRU image cache — proven engine from the first native spike:
///  • zero rendering DURING pinch (GPU-scaled current bitmap),
///  • re-render of visible pages only after zoom settles,
///  • all page ops serialized through one queue (Android requirement).
class PdfDocController extends ChangeNotifier {
  PdfDocController(this.fileKey, {this.maxRenderWidthPx = 2200});

  final String fileKey;
  static const _buckets = [1.0, 1.5, 2.0, 3.0, 4.0];
  static const _maxCached = 14;

  final double maxRenderWidthPx;
  PdfDocument? _doc;
  final Map<int, Size> _pointSizes = {};
  final Map<String, ui.Image> _cache = {};
  final List<String> _lru = [];
  final Set<String> _rendering = {};
  Future<void> _queueTail = Future<void>.value();
  double _basePixelWidth = 1080;
  bool _disposed = false;
  int pageCount = 0;
  bool get isReady => _doc != null;

  Future<void> _enqueue(Future<void> Function() task) {
    final result = _queueTail.then((_) => task());
    _queueTail = result.then<void>((_) {}, onError: (Object _) {});
    return result;
  }

  Future<void> open(Uint8List bytes) async {
    try {
      _doc = await PdfDocument.openData(bytes);
      pageCount = _doc!.pagesCount;
      notifyListeners();
      _loadPageSizes();
    } catch (e) {
      debugPrint('Nanote PDF open failed: $e');
    }
  }

  void _loadPageSizes() {
    final doc = _doc;
    if (doc == null) return;
    _enqueue(() async {
      for (var i = 0; i < pageCount; i++) {
        if (_disposed || _pointSizes.containsKey(i)) continue;
        try {
          final p = await doc.getPage(i + 1); // pdfx is 1-based
          try {
            _pointSizes[i] = Size(p.width, p.height);
          } finally {
            await p.close();
          }
          if (i < 3 || i % 10 == 0) _safeNotify();
        } catch (_) {
          continue;
        }
      }
      _safeNotify();
    });
  }

  void _safeNotify() {
    if (!_disposed) notifyListeners();
  }

  Size pointSize(int page) {
    final s = _pointSizes[page] ?? _pointSizes[0] ?? const Size(595, 842);
    if (s.width <= 0 || s.height <= 0 ||
        !s.width.isFinite || !s.height.isFinite) {
      return const Size(595, 842);
    }
    return s;
  }

  void configure({required double basePixelWidth}) =>
      _basePixelWidth = basePixelWidth;

  double bucketFor(double scale, double dpr) {
    final need = scale * dpr;
    for (final b in _buckets) {
      if (b >= need) return b;
    }
    return _buckets.last;
  }

  int _pxFor(double bucket) =>
      (_basePixelWidth * bucket).round().clamp(240, maxRenderWidthPx.round());

  String _key(int page, int px) => '$page@$px';

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

  void ensureRendered(int page, double bucket) {
    final doc = _doc;
    if (doc == null || page < 0 || page >= pageCount) return;
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
        _safeNotify();
      } catch (err) {
        debugPrint('Nanote PDF render failed (page ${page + 1}): $err');
      } finally {
        _rendering.remove(key);
      }
    });
  }

  Future<void> _renderInto(PdfDocument doc, int page, int px, String key) async {
    final p = await doc.getPage(page + 1);
    ui.Image? image;
    try {
      final h = px * p.height / p.width;
      final rendered = await p.render(
          width: px.toDouble(), height: h, backgroundColor: '#FFFFFF');
      if (rendered == null || _disposed) return;
      final codec = await ui.instantiateImageCodec(rendered.bytes);
      final frame = await codec.getNextFrame();
      image = frame.image;
    } finally {
      await p.close();
    }
    if (_disposed) {
      image?.dispose();
      return;
    }
    _store(key, image!);
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

/// Registry of open PDFs inside one workspace session (a notebook may mix
/// pages from several imported PDFs).
class PdfLibrary extends ChangeNotifier {
  final Map<String, PdfDocController> _docs = {};

  PdfDocController? controllerOf(String fileKey) => _docs[fileKey];

  PdfDocController openCached(String fileKey, Uint8List bytes) {
    return _docs.putIfAbsent(
        fileKey, () => PdfDocController(fileKey)..open(bytes));
  }

  /// Read the page count of a PDF without keeping it open (library import).
  static Future<int> pageCountOf(Uint8List bytes) async {
    try {
      final doc = await PdfDocument.openData(bytes);
      final n = doc.pagesCount;
      await doc.close();
      return n;
    } catch (_) {
      return 0;
    }
  }

  @override
  void dispose() {
    for (final d in _docs.values) {
      d.dispose();
    }
    _docs.clear();
    super.dispose();
  }
}
