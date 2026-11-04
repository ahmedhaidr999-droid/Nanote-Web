import 'package:flutter/painting.dart' show Color;
import 'package:isar/isar.dart';
import 'package:perfect_freehand/perfect_freehand.dart';

import '../models/ink_change.dart';
import '../models/stroke.dart';
import 'app_database.dart';
import 'stroke_entity.dart';

/// حفظ/تحميل **تزايدي** لحبر مستند واحد عبر Isar.
///
/// لا يُعاد كتابة المستند كله أثناء العمل أبداً: كل التزام خط أو مسحه
/// يُترجم داخل [applyChanges] إلى put/delete لصف واحد فقط داخل معاملة
/// صغيرة، وتُدار معرّفات الصفوف يدوياً (خريطة strokeId→rowId) بحيث:
///
///  1. التراجع عن رسم = حذف الصف؛ إعادته = إعادة كتابة الصف **بنفس
///     المعرّف** → يعود إلى موضع عادل في الترتيب (z-order صحيح دائماً).
///  2. معرّف الصف المحذوف لا يُعاد استخدامه أبداً → الترتيب مستقر
///     عبر الجلسات حتى لو حُذفت خطوط قديمة.
///  3. الدفعة الواحدة قد تحوي عمليات متضاربة (أضف ثم امسح قبل اكتمال
///     الكتابة) — يُحسب "الأثر الصافي" فلا تُكتب صفوف ميتة.
class StrokeRepository {
  StrokeRepository._(this._db, this.docId);

  final Isar _db;
  final String docId;

  /// strokeId → معرّف صف Isar (للحذف وإعادة الكتابة بنفس الصف).
  final Map<String, Id> _rowIds = {};

  /// أصغر معرّف حر — لا يُعاد استخدام معرّف محذوف أبداً.
  Id _nextId = 1;

  bool _closed = false;

  /// فتح مستودع لمستند — يشارك مثيل Isar العام (AppDatabase).
  static Future<StrokeRepository> open(String docId) async {
    return StrokeRepository._(await AppDatabase.instance(), docId);
  }

  /// تحميل حبر المستند كاملاً (مرة واحدة عند الفتح) — يعمّر خريطة
  /// المعرّفات ويجهّز _nextId فوق أعلى معرّف موجود.
  Future<Map<int, List<Stroke>>> loadAll() async {
    if (_closed) return <int, List<Stroke>>{};
    final rows = await _db.strokeEntitys.filter().docIdEqualTo(docId).findAll();
    // ترتيب z = ترتيب المعرّف (استعلام Isar يرجع الصفوف مرتبة بمعرّفها).
    final result = <int, List<Stroke>>{};
    Id maxId = 0;
    for (final r in rows) {
      if (r.id > maxId) maxId = r.id;
      _rowIds[r.strokeId] = r.id;
      result.putIfAbsent(r.page, () => <Stroke>[]).add(_toModel(r));
    }
    _nextId = maxId + 1;
    return result;
  }

  /// تطبيق دفعة تغييرات تفاضلية (تصل من InkAutoSaver) — قد تحوي أكثر
  /// من دفعة مستخدم مُدمَجة، وتُعالَج بالترتيب مع فصل عمليات الاستبدال
  /// الشامل عند حدودها كي لا تُبتلع التغييرات الطارئة بعدها.
  Future<void> applyChanges(List<InkChange> changes) async {
    if (_closed || changes.isEmpty) return;
    var start = 0;
    for (var i = 0; i < changes.length; i++) {
      final c = changes[i];
      if (c is InkReplacedAll) {
        await _applyIncremental(changes.sublist(start, i));
        await _replaceAll(c.pages);
        start = i + 1;
      }
    }
    if (start < changes.length) {
      await _applyIncremental(changes.sublist(start));
    }
  }

  /// الجزء التزايدي: أثر صافٍ لكل خط ثم معاملة واحدة صغيرة.
  Future<void> _applyIncremental(List<InkChange> changes) async {
    if (changes.isEmpty) return;

    // آخر عملية لكل خط داخل الدفعة هي الفعّالة:
    // (أُضيف ثم مُسح قبل اكتمال الكتابة) = لا يُكتب إطلاقاً.
    final net = <String, InkChange>{};
    for (final c in changes) {
      switch (c) {
        case InkAdded(:final stroke):
          net[stroke.id] = c;
        case InkRemoved(:final stroke):
          net[stroke.id] = c;
        case InkReplacedAll():
          break; // غير متوقع هنا — فُصلت عند الحدود أعلاه.
      }
    }

    final toPut = <StrokeEntity>[];
    final toDelete = <Id>[];
    for (final c in net.values) {
      switch (c) {
        case InkAdded(:final page, :final stroke):
          final rowId = _rowIds[stroke.id] ?? _nextId++;
          _rowIds[stroke.id] = rowId;
          toPut.add(_toEntity(rowId, page, stroke));
        case InkRemoved(:final stroke):
          final rowId = _rowIds[stroke.id];
          if (rowId != null) toDelete.add(rowId);
        case InkReplacedAll():
          break;
      }
    }
    if (toPut.isEmpty && toDelete.isEmpty) return;

    await _db.writeTxn(() async {
      if (toDelete.isNotEmpty) {
        await _db.strokeEntitys.deleteAll(toDelete);
      }
      if (toPut.isNotEmpty) {
        await _db.strokeEntitys.putAll(toPut);
      }
    });
  }

  /// استبدال كامل (استيراد/فتح محتوى جديد) — يعيد استخدام معرّفات
  /// الصفوف المعروفة للحفاظ على z-order عبر الجلسات.
  Future<void> _replaceAll(Map<int, List<Stroke>> pages) async {
    if (_closed) return;
    final keep = <String>{};
    final entities = <StrokeEntity>[];
    for (final e in pages.entries) {
      for (final s in e.value) {
        keep.add(s.id);
        final rowId = _rowIds[s.id] ?? _nextId++;
        _rowIds[s.id] = rowId;
        entities.add(_toEntity(rowId, e.key, s));
      }
    }
    await _db.writeTxn(() async {
      await _db.strokeEntitys.filter().docIdEqualTo(docId).deleteAll();
      if (entities.isNotEmpty) {
        await _db.strokeEntitys.putAll(entities);
      }
    });
    _rowIds.removeWhere((k, _) => !keep.contains(k));
  }

  /// إسقاط المستودع — القاعدة نفسها مشتركة (AppDatabase) ولا تُغلق هنا.
  Future<void> close() async {
    _closed = true;
    _rowIds.clear();
  }

  // ───────────────────────── التحويل ─────────────────────────

  StrokeEntity _toEntity(Id rowId, int page, Stroke s) => StrokeEntity()
    ..id = rowId
    ..strokeId = s.id
    ..docId = docId
    ..page = page
    ..colorValue = s.style.color.toARGB32()
    ..size = s.style.size
    ..thinning = s.style.thinning
    ..smoothing = s.style.smoothing
    ..streamline = s.style.streamline
    ..simulatePressure = s.style.simulatePressure
    ..points = [
      for (final p in s.points) ...[p.x, p.y, p.pressure ?? 0.5],
    ];

  Stroke _toModel(StrokeEntity r) {
    final pts = <PointVector>[];
    for (var i = 0; i + 2 < r.points.length; i += 3) {
      pts.add(PointVector(r.points[i], r.points[i + 1], r.points[i + 2]));
    }
    return Stroke(
      id: r.strokeId,
      style: StrokeStyle(
        color: Color(r.colorValue),
        size: r.size,
        thinning: r.thinning,
        smoothing: r.smoothing,
        streamline: r.streamline,
        simulatePressure: r.simulatePressure,
      ),
      points: pts,
    );
  }
}
