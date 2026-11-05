import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:path_provider/path_provider.dart';

/// Root store under the app-documents directory:
///   nanote/
///     db.json              — library index (notebooks/pages/pdfs/stickers/recordings/folders)
///     settings.json        — app settings
///     pages/<pageId>.json  — ink + elements per page (keyed by page id → reorder-safe)
///     files/images|stickers|pdfs|recordings/<key>
class FileStore {
  late final Directory root;
  Directory get pagesDir => _dir('pages');
  Directory get filesDir => _dir('files');

  Directory _dir(String name) {
    final d = Directory('${root.path}/$name');
    if (!d.existsSync()) d.createSync(recursive: true);
    return d;
  }

  Future<void> init() async {
    root = Directory(
        '${(await getApplicationDocumentsDirectory()).path}/nanote');
    if (!root.existsSync()) root.createSync(recursive: true);
    _dir('pages');
    _dir('files/images');
    _dir('files/stickers');
    _dir('files/pdfs');
    _dir('files/recordings');
  }

  String _filesPath(String kind, String key) => '${root.path}/files/$kind/$key';

  /// Writes bytes into a store bucket; returns the generated file key.
  Future<String> saveBytesAs(String kind, String ext, Uint8List bytes) async {
    final key = '${DateTime.now().microsecondsSinceEpoch}_'
        '${_randInt.nextInt(0xffff).toRadixString(36)}$ext';
    final f = File(_filesPath(kind, key));
    await f.create(recursive: true);
    await f.writeAsBytes(bytes, flush: true);
    return key;
  }

  File fileOf(String kind, String key) => File(_filesPath(kind, key));
  Uint8List readBytes(String kind, String key) =>
      File(_filesPath(kind, key)).readAsBytesSync();

  Future<Uint8List?> tryReadBytes(String kind, String key) async {
    try {
      return await File(_filesPath(kind, key)).readAsBytes();
    } catch (_) {
      return null;
    }
  }

  Future<void> deleteFile(String kind, String key) async {
    try {
      await File(_filesPath(kind, key)).delete();
    } catch (_) {}
  }

  // ── page documents ──
  File pageFile(String pageId) => File('${root.path}/pages/$pageId.json');

  Map<String, dynamic>? readPageJson(String pageId) {
    try {
      final txt = pageFile(pageId).readAsStringSync();
      return jsonDecode(utf8.decode(utf8.encode(txt))) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  /// Atomic-ish write: write to temp then rename (no torn files on crash).
  Future<void> writePageJson(String pageId, Map<String, dynamic> doc) async {
    final f = pageFile(pageId);
    final tmp = File('${f.path}.tmp');
    await tmp.writeAsString(jsonEncode(doc), flush: true);
    await tmp.rename(f.path);
  }

  Future<void> deletePageDoc(String pageId) async {
    try {
      await pageFile(pageId).delete();
    } catch (_) {}
  }

  // ── db.json (library index) ──
  File get dbFile => File('${root.path}/db.json');

  Map<String, dynamic> readDbJson() {
    try {
      return jsonDecode(utf8.decode(
          utf8.encode(dbFile.readAsStringSync()))) as Map<String, dynamic>;
    } catch (_) {
      return {};
    }
  }

  Future<void> writeDbJson(Map<String, dynamic> db) async {
    final tmp = File('${dbFile.path}.tmp');
    await tmp.writeAsString(jsonEncode(db), flush: true);
    await tmp.rename(dbFile.path);
  }

  // ── settings.json ──
  File get settingsFile => File('${root.path}/settings.json');

  Map<String, dynamic>? readSettingsJson() {
    try {
      return jsonDecode(utf8.decode(
          utf8.encode(settingsFile.readAsStringSync()))) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  Future<void> writeSettingsJson(Map<String, dynamic> s) async {
    final tmp = File('${settingsFile.path}.tmp');
    await tmp.writeAsString(jsonEncode(s), flush: true);
    await tmp.rename(settingsFile.path);
  }

}

/// Tiny unique-id generator: millis + xorshift suffix.
String newId() {
  final r = _randInt.nextInt(0xffffff);
  return '${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}'
      '${r.toRadixString(36).padLeft(4, '0')}';
}

final _randInt = _Rng();
class _Rng {
  int _s = 0x9E3779B9;
  int nextInt(int max) {
    _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5;
    return (_s & 0x7fffffff) % max;
  }
}
