import 'dart:async';

import 'package:flutter/foundation.dart';

import '../controllers/stroke_engine.dart';
import '../models/ink_change.dart';
import 'stroke_repository.dart';

/// الحفظ التلقائي: يربط StrokeEngine بـ StrokeRepository عبر خطاف
/// onCommit ويطبّق التغييرات **تزايدياً في الخلفية**.
///
/// الضمانات:
///  1. صفر حجب للرسم — الخطاف لا يفعل شيئاً سوى إضافة العملية إلى
///     طابور؛ الكتابة الفعلية تتم داخل معاملات Isar غير المتزامنة.
///  2. تسلسل مضمون — طابور FIFO واحد: لا تُطبَّق دفعة قبل سابقتها.
///  3. دمج ذكي — التغييرات المتراكمة أثناء كتابةٍ جارية تُجمَّع في
///     معاملة واحدة (الأثر الصافي يُحسب داخل applyChanges).
///  4. متانة — فشلٌ عابر يُعاد محاولته (حتى 3 مرات لكل دفعة) ثم
///     تُسقَط بتسجيل، وdispose ينتظر تصريف كل شيء قبل العودة —
///     لا يضيع شيء عند إغلاق الشاشة.
class InkAutoSaver {
  InkAutoSaver._(this._engine, this._repo);

  final StrokeEngine _engine;
  final StrokeRepository _repo;

  final List<List<InkChange>> _pending = <List<InkChange>>[];
  Future<void>? _drainFuture;
  bool _disposed = false;

  /// فتح مستند بالحفظ التلقائي: تحميل الحبر المحفوظ أولاً ثم تفعيل
  /// الخطاف (بهذا الترتيب لا تُعاد كتابة ما حُمِّل للتو عند الفتح).
  /// يعيد null إذا تعذّر فتح القاعدة — التطبيق يعمل بلا حفظ بدل
  /// الانهيار (يُسجَّل السبب).
  static Future<InkAutoSaver?> attach(
    StrokeEngine engine,
    String docId,
  ) async {
    try {
      final repo = await StrokeRepository.open(docId);
      final saver = InkAutoSaver._(engine, repo);
      engine.importStrokes(await repo.loadAll());
      engine.onCommit = saver._enqueue;
      return saver;
    } catch (e) {
      debugPrint('Nanote: auto-save disabled ($e)');
      return null;
    }
  }

  void _enqueue(List<InkChange> changes) {
    if (_disposed || changes.isEmpty) return;
    _pending.add(changes);
    _drainFuture ??= _drainLoop();
  }

  /// يبدأ التصريف إن لم يكن جارياً، ويعيد مستقبله دائماً — يستخدمه
  /// dispose للانتظار حتى اكتمال أي كتابة جارية (لا سباق إغلاق).
  Future<void> _flush() {
    final future = _drainFuture ??= _drainLoop();
    return future;
  }

  Future<void> _drainLoop() async {
    try {
      var failures = 0;
      while (_pending.isNotEmpty) {
        // دمج كل الدفعات المتراكمة الآن في معاملة واحدة.
        final batch = <InkChange>[for (final b in _pending) ...b];
        _pending.clear();
        try {
          await _repo.applyChanges(batch);
          failures = 0;
        } catch (e) {
          failures++;
          debugPrint('Nanote: auto-save batch failed ($failures) ($e)');
          if (failures >= 3) {
            // استسلام لهذه الدفعة — قاعدة محلية والفشل المتكرر يعني
            // عطلاً في القرص؛ لا معنى لتجميد الإغلاق إلى الأبد.
            failures = 0;
            continue;
          }
          _pending.insert(0, batch);
          await Future<void>.delayed(const Duration(milliseconds: 200));
        }
      }
    } finally {
      _drainFuture = null;
    }
  }

  /// الإغلاق: إيقاف الاستقبال ثم تصريف الطابور كاملاً — انتظاره يضمن
  /// أن كل ما رسمه المستخدم مكتوب فعلاً قبل إنهاء الشاشة.
  Future<void> dispose() async {
    _disposed = true;
    _engine.onCommit = null;
    try {
      await _flush();
    } finally {
      await _repo.close();
    }
  }
}
