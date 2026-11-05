import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';

import '../persistence/file_store.dart';

/// Decoded image LRU (24 entries) for user images & PNG stickers.
/// Widgets listen to [ready] and repaint when their decode lands.
class ImageCache extends ChangeNotifier {
  static const maxEntries = 24;
  final FileStore fs;
  ImageCache(this.fs);

  final Map<String, ui.Image> _map = {};
  final List<String> _lru = [];

  ChangeNotifier get ready => this;

  ui.Image? get(String fileKey) => _map[fileKey];

  /// Returns the image if cached; kicks off a decode otherwise.
  ui.Image? load(String fileKey) {
    final hit = _map[fileKey];
    if (hit != null) {
      _lru.remove(fileKey);
      _lru.add(fileKey);
      return hit;
    }
    _decode(fileKey);
    return null;
  }

  Future<void> _decode(String fileKey) async {
    try {
      final bytes = await fs.tryReadBytes('images', fileKey) ??
          await fs.tryReadBytes('stickers', fileKey);
      if (bytes == null) return;
      final codec = await ui.instantiateImageCodec(bytes);
      final frame = await codec.getNextFrame();
      _store(fileKey, frame.image);
      notifyListeners();
    } catch (_) {
      // missing/corrupt file — stay silent, painter draws a placeholder
    }
  }

  void _store(String key, ui.Image img) {
    if (_map.containsKey(key)) {
      _map[key]?.dispose();
    }
    _map[key] = img;
    _lru.remove(key);
    _lru.add(key);
    while (_lru.length > maxEntries) {
      final oldest = _lru.removeAt(0);
      _map.remove(oldest)?.dispose();
    }
  }

  @override
  void dispose() {
    for (final img in _map.values) {
      img.dispose();
    }
    _map.clear();
    super.dispose();
  }
}
