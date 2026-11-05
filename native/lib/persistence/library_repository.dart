import 'dart:async';
import 'dart:typed_data';

import '../models/library_models.dart';
import '../models/paper.dart';
import 'file_store.dart';
import 'page_store.dart';

/// Library CRUD over db.json with debounced persistence.
/// All mutations update in-memory rows immediately and notify listeners;
/// the JSON index flushes to disk shortly after.
class LibraryRepository {
  final FileStore fs;
  late final PageStore pages;

  List<NotebookRow> notebooks = [];
  List<FolderRow> folders = [];
  List<PageRow> pageRows = []; // includes trashed (trashedAt set)
  List<PdfFileRow> pdfFiles = [];
  List<StickerRow> stickers = [];
  List<RecordingRow> recordings = [];

  final _controller = StreamController<void>.broadcast();
  Stream<void> get changes => _controller.stream;
  void _notify() {
    if (!_controller.isClosed) _controller.add(null);
  }

  Timer? _flushTimer;

  LibraryRepository(this.fs) {
    pages = PageStore(fs);
  }

  Future<void> load() async {
    final db = fs.readDbJson();
    notebooks = [
      for (final j in (db['notebooks'] as List? ?? []))
        NotebookRow.fromJson(j as Map<String, dynamic>)
    ];
    folders = [
      for (final j in (db['folders'] as List? ?? []))
        FolderRow.fromJson(j as Map<String, dynamic>)
    ];
    pageRows = [
      for (final j in (db['pages'] as List? ?? []))
        PageRow.fromJson(j as Map<String, dynamic>)
    ];
    pdfFiles = [
      for (final j in (db['pdfs'] as List? ?? []))
        PdfFileRow.fromJson(j as Map<String, dynamic>)
    ];
    stickers = [
      for (final j in (db['stickers'] as List? ?? []))
        StickerRow.fromJson(j as Map<String, dynamic>)
    ];
    recordings = [
      for (final j in (db['recordings'] as List? ?? []))
        RecordingRow.fromJson(j as Map<String, dynamic>)
    ];
    _seed();
    _notify();
  }

  /// First boot → create the default notebook so the app is never empty.
  void _seed() {
    if (notebooks.any((n) => !n.trashed)) return;
    final now = DateTime.now();
    final nb = NotebookRow(
      id: newId(), title: 'ملاحظاتي', createdAt: now,
      updatedAt: now, lastOpenedAt: now, sortIndex: 0,
    );
    notebooks.add(nb);
    final page = PageRow(
      id: newId(), notebookId: nb.id, sortIndex: 0,
      template: PaperTemplate.ruled, sizeIdx: 0,
      createdAt: now, updatedAt: now,
    );
    pageRows.add(page);
    _scheduleFlush();
  }

  void _scheduleFlush() {
    _flushTimer?.cancel();
    _flushTimer = Timer(const Duration(milliseconds: 400), _flush);
  }

  Future<void> _flush() async {
    await fs.writeDbJson({
      'v': 2,
      'notebooks': [for (final n in notebooks) n.toJson()],
      'folders': [for (final f in folders) f.toJson()],
      'pages': [for (final p in pageRows) p.toJson()],
      'pdfs': [for (final p in pdfFiles) p.toJson()],
      'stickers': [for (final s in stickers) s.toJson()],
      'recordings': [for (final r in recordings) r.toJson()],
    });
  }

  Future<void> flushAll() async {
    await pages.flush();
    await _flush();
  }

  // ───────────────────────── notebooks ─────────────────────────

  NotebookRow createNotebook({
    required String title, String? parentId,
    int coverIdx = 0, int colorIdx = 0,
    PaperTemplate template = PaperTemplate.ruled, int sizeIdx = 0,
  }) {
    final now = DateTime.now();
    final nb = NotebookRow(
      id: newId(), title: title, parentId: parentId,
      coverIdx: coverIdx, colorIdx: colorIdx,
      createdAt: now, updatedAt: now, lastOpenedAt: now,
      sortIndex: notebooks.length,
    );
    notebooks.add(nb);
    pageRows.add(PageRow(
      id: newId(), notebookId: nb.id, sortIndex: 0,
      template: template, sizeIdx: sizeIdx,
      createdAt: now, updatedAt: now,
    ));
    _scheduleFlush();
    _notify();
    return nb;
  }

  void renameNotebook(NotebookRow nb, String title) {
    nb.title = title;
    nb.updatedAt = DateTime.now();
    _scheduleFlush();
    _notify();
  }

  void moveNotebook(NotebookRow nb, String? folderId) {
    nb.parentId = folderId;
    _scheduleFlush();
    _notify();
  }

  void toggleFavorite(NotebookRow nb) {
    nb.favorite = !nb.favorite;
    _scheduleFlush();
    _notify();
  }

  void touchNotebook(NotebookRow nb) {
    nb.lastOpenedAt = nb.updatedAt = DateTime.now();
    _scheduleFlush();
  }

  /// Soft-delete: notebook + its pages move to trash (recoverable 30 days).
  void trashNotebook(NotebookRow nb) {
    final t = DateTime.now();
    nb.trashedAt = t;
    for (final p in pageRows.where((p) => p.notebookId == nb.id)) {
      _trashPageRow(p, t);
    }
    _scheduleFlush();
    _notify();
  }

  void restoreNotebook(NotebookRow nb) {
    nb.trashedAt = null;
    for (final p in pageRows.where((p) => p.notebookId == nb.id)) {
      p.updatedAt = DateTime.now();
    }
    _scheduleFlush();
    _notify();
  }

  /// Hard-delete: page docs, recordings, then the notebook itself.
  Future<void> purgeNotebook(NotebookRow nb) async {
    final ids = pageRows.where((p) => p.notebookId == nb.id).map((p) => p.id).toList();
    for (final pid in ids) {
      await _purgePageAssets(pid);
    }
    pageRows.removeWhere((p) => p.notebookId == nb.id);
    notebooks.remove(nb);
    _scheduleFlush();
    _notify();
  }

  NotebookRow? notebookById(String id) =>
      notebooks.where((n) => n.id == id).firstOrNull;

  // ───────────────────────── pages ─────────────────────────

  List<PageRow> visiblePages(String notebookId) {
    final list = pageRows
        .where((p) => p.notebookId == notebookId)
        .toList()
      ..sort((a, b) => a.sortIndex.compareTo(b.sortIndex));
    return list;
  }

  PageRow? pageById(String id) =>
      pageRows.where((p) => p.id == id).firstOrNull;

  PageRow addPage(String notebookId, {int? afterSortIndex,
      PaperTemplate? template, int? sizeIdx, String? pdfFileId, int? pdfIndex}) {
    final now = DateTime.now();
    final pages = visiblePages(notebookId);
    final idx = afterSortIndex == null ? pages.length : afterSortIndex + 1;
    for (final p in pages) {
      if (p.sortIndex >= idx) p.sortIndex++;
    }
    final row = PageRow(
      id: newId(), notebookId: notebookId, sortIndex: idx,
      template: template ?? pages.firstOrNull?.template ?? PaperTemplate.ruled,
      sizeIdx: sizeIdx ?? pages.firstOrNull?.sizeIdx ?? 0,
      pdfFileId: pdfFileId, pdfIndex: pdfIndex,
      createdAt: now, updatedAt: now,
    );
    pageRows.add(row);
    final nb = notebookById(notebookId);
    if (nb != null) nb.updatedAt = now;
    _scheduleFlush();
    _notify();
    return row;
  }

  void updatePage(PageRow page) {
    page.updatedAt = DateTime.now();
    _scheduleFlush();
    _notify();
  }

  void reorderPage(PageRow page, int newIndex) {
    final pages = visiblePages(page.notebookId);
    pages.remove(page);
    final clamped = newIndex.clamp(0, pages.length);
    pages.insert(clamped, page);
    for (var i = 0; i < pages.length; i++) {
      pages[i].sortIndex = i;
    }
    _scheduleFlush();
    _notify();
  }

  void movePageToNotebook(PageRow page, String targetNotebookId) {
    final pages = visiblePages(targetNotebookId);
    page.notebookId = targetNotebookId;
    page.sortIndex = pages.length;
    updatePage(page);
  }

  /// Duplicates the page row AND its ink/elements doc.
  Future<PageRow> duplicatePage(PageRow page) async {
    final copy = addPage(page.notebookId,
        afterSortIndex: page.sortIndex,
        template: page.template, sizeIdx: page.sizeIdx,
        pdfFileId: page.pdfFileId, pdfIndex: page.pdfIndex);
    await pages.copyDoc(page.id, copy.id);
    return copy;
  }

  void _trashPageRow(PageRow p, DateTime t) {
    p.updatedAt = t;
    // PageRow has no own trashedAt; trashed state derives from its notebook.
    // (Trashing a notebook trashes all its pages implicitly.)
  }

  /// Delete a single page (inside a live notebook): purge doc + assets.
  Future<void> deletePage(PageRow page) async {
    await _purgePageAssets(page.id);
    pageRows.remove(page);
    _scheduleFlush();
    _notify();
  }

  Future<void> _purgePageAssets(String pageId) async {
    await pages.evict(pageId);
    for (final r in recordings.where((r) => r.pageId == pageId).toList()) {
      await fs.deleteFile('recordings', r.fileKey);
      recordings.remove(r);
    }
  }

  // ───────────────────────── folders ─────────────────────────

  FolderRow createFolder(String name, {String? parentId}) {
    final f = FolderRow(
      id: newId(), name: name, parentId: parentId,
      createdAt: DateTime.now(), sortIndex: folders.length,
    );
    folders.add(f);
    _scheduleFlush();
    _notify();
    return f;
  }

  void renameFolder(FolderRow f, String name) {
    f.name = name;
    _scheduleFlush();
    _notify();
  }

  Future<void> deleteFolder(FolderRow f, {bool purgeContent = false}) async {
    final children = notebooks.where((n) => n.parentId == f.id).toList();
    if (purgeContent) {
      for (final nb in children) {
        await purgeNotebook(nb);
      }
    } else {
      for (final nb in children) {
        nb.parentId = f.parentId;
      }
    }
    for (final sub in folders.where((x) => x.parentId == f.id).toList()) {
      sub.parentId = f.parentId;
    }
    folders.remove(f);
    _scheduleFlush();
    _notify();
  }

  // ───────────────────────── pdf import ─────────────────────────

  /// Import a PDF as a new notebook (one page per PDF page).
  Future<NotebookRow?> importPdfAsNotebook({
    required String displayName,
    required Uint8List bytes,
    required int pageCount,
  }) async {
    final key = await fs.saveBytesAs('pdfs', '.pdf', bytes);
    final now = DateTime.now();
    final pdf = PdfFileRow(
      id: newId(), name: displayName, pageCount: pageCount,
      sizeBytes: bytes.length, addedAt: now,
    );
    pdfFiles.add(pdf);
    final nb = createNotebook(title: displayName);
    // Replace the seeded blank page with the pdf pages.
    final seeded = visiblePages(nb.id).firstOrNull;
    if (seeded != null) {
      pageRows.remove(seeded);
      await pages.evict(seeded.id);
    }
    for (var i = 0; i < pageCount; i++) {
      pageRows.add(PageRow(
        id: newId(), notebookId: nb.id, sortIndex: i,
        pdfFileId: key, pdfIndex: i,
        createdAt: now, updatedAt: now,
      ));
    }
    _scheduleFlush();
    _notify();
    return nb;
  }

  Uint8List? pdfBytes(String fileKey) => fs.tryReadBytesSync('pdfs', fileKey);

  // ───────────────────────── stickers ─────────────────────────

  Future<StickerRow> addPngSticker(Uint8List bytes) async {
    final key = await fs.saveBytesAs('stickers', '.png', bytes);
    final s = StickerRow(id: newId(), fileKey: key, addedAt: DateTime.now());
    stickers.add(s);
    _scheduleFlush();
    _notify();
    return s;
  }

  Future<void> deleteSticker(StickerRow s) async {
    if (s.fileKey != null) await fs.deleteFile('stickers', s.fileKey!);
    stickers.remove(s);
    _scheduleFlush();
    _notify();
  }

  // ───────────────────────── recordings ─────────────────────────

  RecordingRow addRecording({
    required String pageId, required String fileKey, required int durationMs,
  }) {
    final r = RecordingRow(
      id: newId(), pageId: pageId, fileKey: fileKey,
      durationMs: durationMs, createdAt: DateTime.now(),
    );
    recordings.add(r);
    _scheduleFlush();
    _notify();
    return r;
  }

  List<RecordingRow> recordingsOf(String pageId) =>
      recordings.where((r) => r.pageId == pageId && r.trashedAt == null).toList();

  Future<void> deleteRecording(RecordingRow r) async {
    await fs.deleteFile('recordings', r.fileKey);
    recordings.remove(r);
    _scheduleFlush();
    _notify();
  }

  // ───────────────────────── trash ─────────────────────────

  static const trashRetentionDays = 30;

  List<NotebookRow> get trashedNotebooks => notebooks
      .where((n) => n.trashedAt != null)
      .toList()
    ..sort((a, b) => b.trashedAt!.compareTo(a.trashedAt!));

  /// Call on boot: purge notebooks past retention.
  Future<void> purgeExpiredTrash() async {
    final cutoff = DateTime.now().subtract(
        const Duration(days: trashRetentionDays));
    final expired = notebooks
        .where((n) => n.trashedAt != null && n.trashedAt!.isBefore(cutoff))
        .toList();
    for (final nb in expired) {
      await purgeNotebook(nb);
    }
  }

  Future<void> emptyTrash() async {
    for (final nb in trashedNotebooks.toList()) {
      await purgeNotebook(nb);
    }
  }

  // ───────────────────────── snapshot ─────────────────────────

  LibrarySnapshot snapshot({
    String? parentId,
    String query = '',
    LibrarySort sort = LibrarySort.updated,
    bool sortAsc = false,
  }) {
    final q = query.trim().toLowerCase();
    var nbs = notebooks.where((n) => !n.trashed && n.parentId == parentId);

    if (q.isNotEmpty) {
      // search covers ALL notebooks regardless of folder depth.
      nbs = notebooks.where((n) =>
          !n.trashed && n.title.toLowerCase().contains(q));
    }

    int cmp(NotebookRow a, NotebookRow b) {
      int v;
      switch (sort) {
        case LibrarySort.title:
          v = a.title.compareTo(b.title);
        case LibrarySort.created:
          v = a.createdAt.compareTo(b.createdAt);
        case LibrarySort.updated:
          v = a.updatedAt.compareTo(b.updatedAt);
      }
      return sortAsc ? v : -v;
    }

    final list = nbs.toList()..sort(cmp);

    final pageCounts = <String, int>{};
    final lastActivity = <String, DateTime>{};
    for (final p in pageRows) {
      pageCounts[p.notebookId] = (pageCounts[p.notebookId] ?? 0) + 1;
    }
    for (final nb in notebooks) {
      var last = nb.updatedAt;
      for (final p in pageRows.where((p) => p.notebookId == nb.id)) {
        if (p.updatedAt.isAfter(last)) last = p.updatedAt;
      }
      lastActivity[nb.id] = last;
    }

    final flds = folders.where((f) => f.parentId == parentId).toList()
      ..sort((a, b) => a.sortIndex.compareTo(b.sortIndex));

    return LibrarySnapshot(
      notebooks: list,
      folders: flds,
      favorites: notebooks.where((n) => !n.trashed && n.favorite).toList()
        ..sort(cmp),
      trashNotebooks: trashedNotebooks,
      pageCountByNotebook: pageCounts,
      notebookLastActivity: lastActivity,
      totalNotebooks: notebooks.where((n) => !n.trashed).length,
      query: query,
      sort: sort,
      sortAsc: sortAsc,
    );
  }

  void dispose() {
    _flushTimer?.cancel();
    _controller.close();
  }
}

extension on FileStore {
  Uint8List? tryReadBytesSync(String kind, String key) {
    try {
      return fileOf(kind, key).readAsBytesSync();
    } catch (_) {
      return null;
    }
  }
}
