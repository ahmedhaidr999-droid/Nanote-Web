import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../persistence/file_store.dart';
import '../persistence/library_repository.dart';
import '../persistence/settings_store.dart';

/// Full backup/restore as a single portable `.nanote` file (JSON envelope):
///   { v: 2, db: {...}, settings: {...}, pages: {id: doc}, files: {key: b64} }
/// IDs are preserved — a restore reproduces the exact library on any device.
class BackupService {
  final FileStore fs;
  final LibraryRepository repo;
  final SettingsStore settings;

  BackupService(this.fs, this.repo, this.settings);

  Future<void> createAndShare() async {
    await repo.flushAll();
    final db = fs.readDbJson();
    final settingsJson = fs.readSettingsJson();

    final pages = <String, dynamic>{};
    final pagesDir = Directory('${fs.root.path}/pages');
    if (pagesDir.existsSync()) {
      for (final f in pagesDir.listSync()) {
        if (f is File && f.path.endsWith('.json')) {
          final id = f.uri.pathSegments.last.replaceFirst('.json', '');
          pages[id] = jsonDecode(utf8.decode(
              utf8.encode(f.readAsStringSync())));
        }
      }
    }

    final files = <String, String>{};
    final filesRoot = Directory('${fs.root.path}/files');
    if (filesRoot.existsSync()) {
      for (final kind in ['images', 'stickers', 'pdfs', 'recordings']) {
        final d = Directory('${filesRoot.path}/$kind');
        if (!d.existsSync()) continue;
        for (final f in d.listSync()) {
          if (f is File) {
            final key = f.uri.pathSegments.last;
            final bytes = f.readAsBytesSync();
            // store under "kind/key" so restore keeps buckets straight
            files['$kind/$key'] = base64Encode(bytes);
          }
        }
      }
    }

    final payload = jsonEncode({
      'v': 2, 'db': db, 'settings': settingsJson,
      'pages': pages, 'files': files,
    });
    final tmp = await getTemporaryDirectory();
    final stamp = DateTime.now().toIso8601String().split('T').first;
    final f = File('${tmp.path}/nanote-backup-$stamp.nanote');
    await f.writeAsString(payload, flush: true);
    await SharePlus.instance.share(ShareParams(
      files: [XFile(f.path)],
      subject: 'Nanote backup',
    ));
  }

  /// Picks a .nanote file and replaces all local content. Returns true on
  /// success (caller should reload everything & rebuild the UI).
  Future<bool> pickAndRestore() async {
    final res = await FilePicker.platform.pickFiles(
      type: FileType.custom, allowedExtensions: ['nanote', 'json'],
      withData: true,
    );
    final file = res.files.firstOrNull;
    final bytes = file?.bytes;
    if (bytes == null) return false;
    try {
      final Map<String, dynamic> data =
          jsonDecode(utf8.decode(bytes)) as Map<String, dynamic>;
      if (data['v'] != 2) return false;
      return await restore(data);
    } catch (e) {
      debugPrint('Nanote restore failed: $e');
      return false;
    }
  }

  Future<bool> restore(Map<String, dynamic> data) async {
    try {
      await repo.flushAll();
      // wipe current content
      _wipe(Directory('${fs.root.path}/pages'));
      _wipe(Directory('${fs.root.path}/files'));
      // db + settings
      if (data['db'] is Map<String, dynamic>) {
        await fs.writeDbJson(data['db'] as Map<String, dynamic>);
      }
      if (data['settings'] is Map<String, dynamic>) {
        await fs.writeSettingsJson(data['settings'] as Map<String, dynamic>);
      }
      // pages
      final pages = data['pages'] as Map<String, dynamic>? ?? {};
      for (final e in pages.entries) {
        await fs.writePageJson(e.key, e.value as Map<String, dynamic>);
      }
      // files
      final files = data['files'] as Map<String, dynamic>? ?? {};
      for (final e in files.entries) {
        final parts = e.key.split('/');
        if (parts.length != 2) continue;
        final f = fs.fileOf(parts[0], parts[1]);
        await f.create(recursive: true);
        await f.writeAsBytes(base64Decode(e.value as String), flush: true);
      }
      return true;
    } catch (e) {
      debugPrint('Nanote restore error: $e');
      return false;
    }
  }

  static void _wipe(Directory d) {
    if (d.existsSync()) {
      d.deleteSync(recursive: true);
    }
    d.createSync(recursive: true);
  }
}
