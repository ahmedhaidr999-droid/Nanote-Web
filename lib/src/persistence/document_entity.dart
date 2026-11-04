import 'package:isar/isar.dart';

part 'document_entity.g.dart';

/// سجل مستند في المكتبة (دفتر فارغ أو PDF مستورد).
///
/// [docId] هو نفسه المفتاح الذي تربط به StrokeRepository حبر
/// المستند — فحذف السجل يحذف حبره تلقائياً في LibraryRepository.
@collection
class DocumentEntity {
  Id id = Isar.autoIncrement;

  @Index()
  late String docId;

  late String title;

  /// 0 دفتر فارغ · 1 PDF مستورد.
  late int kind;

  late bool favorite;

  /// اسم ملف PDF داخل مجلد pdfs/ (فارغ للدفاتر) — يُخزَّن الاسم فقط
  /// وليس مساراً كاملاً حتى لا ينكسر عند تغيّر مسار التطبيق.
  late String pdfFile;

  late int pageCount;

  late int createdAt;
  late int updatedAt;
}
