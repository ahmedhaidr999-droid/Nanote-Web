import 'dart:async';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';

import '../models/library_models.dart';
import '../persistence/file_store.dart';
import '../persistence/library_repository.dart';
import 'pdf_document_controller.dart';

/// Library UI state machine: current folder stack, search, sort, snapshots.
class LibraryController extends ChangeNotifier {
  final LibraryRepository repo;
  LibraryController(this.repo);

  String? currentFolderId;
  String query = '';
  LibrarySort sort = LibrarySort.updated;
  bool sortAsc = false;
  LibraryViewMode viewMode = LibraryViewMode.grid;
  LibrarySnapshot snapshot = LibrarySnapshot.empty;

  StreamSubscription? _sub;
  bool _booted = false;

  Future<void> boot() async {
    if (_booted) return;
    _booted = true;
    await repo.load();
    await repo.purgeExpiredTrash();
    _sub = repo.changes.listen((_) => _refresh());
    _refresh();
  }

  void _refresh() {
    snapshot = repo.snapshot(
      parentId: currentFolderId,
      query: query,
      sort: sort,
      sortAsc: sortAsc,
    );
    notifyListeners();
  }

  void setSearch(String q) {
    query = q;
    _refresh();
  }

  void setSort(LibrarySort s) {
    if (sort == s) {
      sortAsc = !sortAsc;
    } else {
      sort = s;
      sortAsc = s == LibrarySort.title; // titles default A→Z
    }
    _refresh();
  }

  void toggleViewMode() {
    viewMode = viewMode == LibraryViewMode.grid
        ? LibraryViewMode.list : LibraryViewMode.grid;
    notifyListeners();
  }

  void openFolder(String? id) {
    currentFolderId = id;
    query = '';
    _refresh();
  }

  FolderRow? get currentFolder =>
      currentFolderId == null ? null : repo.folders
          .where((f) => f.id == currentFolderId).firstOrNull;

  List<FolderRow> folderTrail() {
    final trail = <FolderRow>[];
    FolderRow? f = currentFolder;
    while (f != null) {
      trail.insert(0, f);
      f = f.parentId == null ? null
          : repo.folders.where((x) => x.id == f!.parentId).firstOrNull;
    }
    return trail;
  }

  // ── import ──

  /// Pick a PDF → one notebook with a page per PDF page.
  Future<NotebookRow?> importPdf() async {
    final res = await FilePicker.platform.pickFiles(
      type: FileType.custom, allowedExtensions: ['pdf'], withData: true,
    );
    final file = res?.files.firstOrNull;
    if (file == null) return null;
    final bytes = file.bytes;
    if (bytes == null) return null;
    final name = (file.name.isEmpty ? 'PDF' : file.name)
        .replaceAll(RegExp(r'\.pdf$', caseSensitive: false), '');
    final count = await PdfLibrary.pageCountOf(bytes);
    if (count <= 0) return null;
    return repo.importPdfAsNotebook(
        displayName: name, bytes: bytes, pageCount: count);
  }

  /// Pick PNGs → user sticker collection.
  Future<void> importStickers() async {
    final res = await FilePicker.platform.pickFiles(
      type: FileType.custom, allowedExtensions: ['png'], withData: true,
      allowMultiple: true,
    );
    for (final f in res?.files ?? const <PlatformFile>[]) {
      final b = f.bytes;
      if (b != null) await repo.addPngSticker(b);
    }
  }

  Uint8List? pdfBytesFor(String fileKey) => repo.pdfBytes(fileKey);

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}
