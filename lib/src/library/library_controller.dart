import 'package:flutter/foundation.dart';

import '../app/settings_controller.dart';
import '../models/library_prefs.dart';
import '../persistence/document_entity.dart';
import '../persistence/library_repository.dart';

/// حالة شاشة المكتبة: القائمة + الفلتر النشط + إعادة التحميل بعد كل
/// عملية — الترتيب والعرض (شبكة/قائمة) يُقرآن من الإعدادات.
class LibraryController extends ChangeNotifier {
  LibraryController(this.repo, this.settings);

  final LibraryRepository repo;
  final SettingsController settings;

  final List<DocumentEntity> _docs = [];
  LibraryFilter filter = LibraryFilter.all;
  bool loading = true;

  List<DocumentEntity> get visible {
    final filtered = switch (filter) {
      LibraryFilter.all => List<DocumentEntity>.of(_docs),
      LibraryFilter.notes =>
        _docs.where((d) => d.kind == 0).toList(growable: false),
      LibraryFilter.pdfs =>
        _docs.where((d) => d.kind == 1).toList(growable: false),
      LibraryFilter.favorites =>
        _docs.where((d) => d.favorite).toList(growable: false),
    };
    final list = List<DocumentEntity>.of(filtered);
    switch (settings.librarySort) {
      case LibrarySort.updatedDesc:
        list.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
      case LibrarySort.createdDesc:
        list.sort((a, b) => b.createdAt.compareTo(a.createdAt));
      case LibrarySort.titleAsc:
        list.sort((a, b) => a.title.compareTo(b.title));
    }
    return list;
  }

  int get totalCount => _docs.length;

  Future<void> reload() async {
    final docs = await repo.listAll();
    _docs
      ..clear()
      ..addAll(docs);
    loading = false;
    notifyListeners();
  }

  void setFilter(LibraryFilter f) {
    if (filter == f) return;
    filter = f;
    notifyListeners();
  }

  Future<void> createNotebook(String title, int pages) async {
    await repo.createNotebook(title: title, pageCount: pages);
    await reload();
  }

  Future<DocumentEntity> importPdf(String path, String? title) async {
    final e = await repo.importPdf(sourcePath: path, title: title);
    await reload();
    return e;
  }

  Future<void> rename(DocumentEntity doc, String title) async {
    await repo.rename(doc, title);
    await reload();
  }

  Future<void> toggleFavorite(DocumentEntity doc) async {
    await repo.toggleFavorite(doc);
    await reload();
  }

  Future<void> delete(DocumentEntity doc) async {
    await repo.delete(doc);
    await reload();
  }

  Future<void> touch(int id) => repo.touch(id);
}
