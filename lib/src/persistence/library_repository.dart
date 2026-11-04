import 'dart:io';
import 'dart:math';

import 'package:isar/isar.dart';
import 'package:path_provider/path_provider.dart';
import 'package:pdfx/pdfx.dart';

import 'app_database.dart';
import 'document_entity.dart';
import 'stroke_entity.dart';

/// مستودع المكتبة: كل عمليات سجلات المستندات + الحذف المتسلسل
/// (السجل + حبره + ملف PDF الفعلي) + نسخ الملفات المستوردة إلى
/// مجلد التطبيق حتى تبقى بعد اختفاء المصدر الأصلي.
class LibraryRepository {
  LibraryRepository._(this._db);

  final Isar _db;
  final Random _random = Random();

  static Future<LibraryRepository> open() async {
    return LibraryRepository._(await AppDatabase.instance());
  }

  /// مجلد تخزين ملفات PDF المستوردة.
  Future<Directory> _pdfDir() async {
    final dir = await getApplicationDocumentsDirectory();
    return Directory('${dir.path}/pdfs').create(recursive: true);
  }

  Future<List<DocumentEntity>> listAll() =>
      _db.documentEntitys.where().findAll();

  Future<DocumentEntity> createNotebook({
    required String title,
    required int pageCount,
  }) async {
    final now = DateTime.now().millisecondsSinceEpoch;
    final e = DocumentEntity()
      ..docId = _newDocId()
      ..title = title
      ..kind = 0
      ..favorite = false
      ..pdfFile = ''
      ..pageCount = pageCount
      ..createdAt = now
      ..updatedAt = now;
    await _db.writeTxn(() => _db.documentEntitys.put(e));
    return e;
  }

  /// استيراد PDF: نسخ إلى مجلد التطبيق + قراءة عدد الصفحات.
  Future<DocumentEntity> importPdf({
    required String sourcePath,
    String? title,
  }) async {
    final docId = _newDocId();
    final dir = await _pdfDir();
    final dest = File('${dir.path}/$docId.pdf');
    await File(sourcePath).copy(dest.path);

    var pages = 0;
    try {
      final doc = await PdfDocument.openFile(dest.path);
      pages = doc.pagesCount;
      await doc.close();
    } catch (_) {
      pages = 0; // ليس قاتلاً — المساحة تعرف مقاساتها عند الفتح
    }

    final now = DateTime.now().millisecondsSinceEpoch;
    final e = DocumentEntity()
      ..docId = docId
      ..title = (title != null && title.trim().isNotEmpty)
          ? title.trim()
          : _guessTitle(sourcePath)
      ..kind = 1
      ..favorite = false
      ..pdfFile = '$docId.pdf'
      ..pageCount = pages
      ..createdAt = now
      ..updatedAt = now;
    await _db.writeTxn(() => _db.documentEntitys.put(e));
    return e;
  }

  Future<void> rename(DocumentEntity doc, String title) async {
    doc.title = title.trim().isEmpty ? doc.title : title.trim();
    await _db.writeTxn(() => _db.documentEntitys.put(doc));
  }

  Future<void> toggleFavorite(DocumentEntity doc) async {
    doc.favorite = !doc.favorite;
    await _db.writeTxn(() => _db.documentEntitys.put(doc));
  }

  /// "آخر استخدام" — يُستدعى عند فتح المستند (أساس فرز "الأحدث").
  Future<void> touch(int id) async {
    final e = await _db.documentEntitys.get(id);
    if (e == null) return;
    e.updatedAt = DateTime.now().millisecondsSinceEpoch;
    await _db.writeTxn(() => _db.documentEntitys.put(e));
  }

  /// حذف متسلسل: السجل + كل حبره + ملف PDF الفعلي.
  Future<void> delete(DocumentEntity doc) async {
    await _db.writeTxn(() async {
      await _db.strokeEntitys.filter().docIdEqualTo(doc.docId).deleteAll();
      await _db.documentEntitys.delete(doc.id);
    });
    if (doc.pdfFile.isNotEmpty) {
      try {
        final dir = await _pdfDir();
        final f = File('${dir.path}/${doc.pdfFile}');
        if (await f.exists()) await f.delete();
      } catch (_) {
        // ملف يتيم لا يوقف الحذف — السجل هو مصدر الحقيقة
      }
    }
  }

  /// المسار الكامل لملف PDF الخاص بالمستند (إن كان PDF وموجوداً).
  Future<String?> pdfPathOf(DocumentEntity doc) async {
    if (doc.kind != 1 || doc.pdfFile.isEmpty) return null;
    final dir = await _pdfDir();
    final f = File('${dir.path}/${doc.pdfFile}');
    return await f.exists() ? f.path : null;
  }

  String _newDocId() =>
      'doc_${DateTime.now().microsecondsSinceEpoch}_${_random.nextInt(1 << 32)}';

  String _guessTitle(String path) {
    final base = path.replaceAll('\\', '/').split('/').last;
    if (base.isEmpty) return 'مستند PDF';
    return base.toLowerCase().endsWith('.pdf')
        ? base.substring(0, base.length - 4)
        : base;
  }
}
