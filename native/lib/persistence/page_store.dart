import 'dart:async';

import '../models/page_elements.dart';
import '../models/stroke.dart';
import 'file_store.dart';

/// In-memory page document + debounced persistence.
/// Ink is keyed by page id (never index) so reorder/delete never corrupts ink.
class PageDoc {
  final String pageId;
  final List<Stroke> strokes;
  final List<PageElement> elements;

  PageDoc(this.pageId, {List<Stroke>? strokes, List<PageElement>? elements})
      : strokes = strokes ?? [],
        elements = elements ?? [];

  int revision = 0;
}

class PageStore {
  final FileStore fs;
  PageStore(this.fs);

  final Map<String, PageDoc> _cache = {};
  final Map<String, bool> _dirty = {};
  Timer? _flushTimer;

  PageDoc load(String pageId) {
    return _cache.putIfAbsent(pageId, () {
      final j = fs.readPageJson(pageId);
      if (j == null) return PageDoc(pageId);
      return PageDoc(
        pageId,
        strokes: [
          for (final s in (j['strokes'] as List? ?? []))
            Stroke.fromJson(s as Map<String, dynamic>)
        ],
        elements: [
          for (final e in (j['elements'] as List? ?? []))
            PageElement.fromJson(e as Map<String, dynamic>)
        ],
      );
    });
  }

  PageDoc? peek(String pageId) => _cache[pageId];

  void markDirty(String pageId) {
    _dirty[pageId] = true;
    _flushTimer?.cancel();
    _flushTimer = Timer(const Duration(milliseconds: 700), flush);
  }

  Future<void> flush() async {
    final ids = List<String>.from(_dirty.keys);
    _dirty.clear();
    for (final id in ids) {
      final doc = _cache[id];
      if (doc == null) continue;
      doc.revision++;
      await fs.writePageJson(id, {
        'v': 2,
        'strokes': [for (final s in doc.strokes) s.toJson()],
        'elements': [for (final e in doc.elements) e.toJson()],
      });
    }
  }

  /// Evict from cache (used when a page is deleted for good).
  Future<void> evict(String pageId) async {
    _cache.remove(pageId);
    _dirty.remove(pageId);
    await fs.deletePageDoc(pageId);
  }

  bool isCached(String pageId) => _cache.containsKey(pageId);

  /// Copy a page doc under a new id (duplicate page).
  Future<void> copyDoc(String fromId, String toId) async {
    await flush();
    final src = fs.readPageJson(fromId);
    if (src == null) return;
    _cache.remove(toId);
    await fs.writePageJson(toId, src);
  }
}
