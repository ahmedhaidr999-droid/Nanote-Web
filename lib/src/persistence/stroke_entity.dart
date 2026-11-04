import 'package:isar/isar.dart';

part 'stroke_entity.g.dart';

/// كيان الحبر في Isar — مطابق لنموذجَي Stroke وStrokeStyle.
///
/// النقاط مخزَّنة كقائمة مسطحة [x, y, pressure, x, y, pressure, ...]
/// بفضاء نقاط الصفحة (PDF points) — نفس فضاء المحرك تماماً، لذا لا
/// يحدث أي انزياح عند التحميل مهما تغيّر حجم الشاشة أو اتجاهها.
///
/// - [strokeId]: مفتاح مستقر عبر الجلسات (نفس Stroke.id).
/// - [id]: يُدار يدوياً من StrokeRepository بحيث يبقى ترتيب الصفوف
///   في القاعدة = ترتيب إنشاء الخطوط (z-order) حتى مع المسح
///   والتراجع والإعادة — ولا يُعاد استخدام معرّف محذوف أبداً.
@collection
class StrokeEntity {
  Id id = Isar.autoIncrement;

  /// معرّف الخط المستقر (Stroke.id) — يُقرأ للربط عند التحميل.
  late String strokeId;

  @Index()
  late String docId;

  late int page;
  late int colorValue;
  late double size;
  late double thinning;
  late double smoothing;
  late double streamline;
  late bool simulatePressure;
  late List<double> points;
}
