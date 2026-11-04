import 'package:flutter/painting.dart' show Color;
import 'package:isar/isar.dart';
import 'package:path_provider/path_provider.dart';
import 'package:perfect_freehand/perfect_freehand.dart';

import '../models/stroke.dart';

part 'stroke_repository.g.dart';

/// كيان الحبر في Isar.
/// النقاط مخزَّنة كقائمة مسطحة [x, y, pressure, x, y, pressure, ...]
/// بفضاء نقاط الصفحة — نفس فضاء المحرك تماماً، لذا لا يحدث أي انزياح
/// عند التحميل مهما تغيّر حجم الشاشة أو اتجاهها.
@collection
class StrokeEntity {
  Id id = Isar.autoIncrement;

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

/// حفظ/تحميل حبر مستند كامل (استبدال بسيط وموثوق لكل مساحة العمل).
/// يُستخدم تلقائياً من DocumentWorkspace عند تمرير docId.
class StrokeRepository {
  StrokeRepository._(this._db, this.docId);

  final Isar _db;
  final String docId;
  bool _closed = false;

  static Future<StrokeRepository> open(String docId) async {
    final dir = await getApplicationDocumentsDirectory();
    final db = await Isar.open([StrokeEntitySchema], directory: dir.path);
    return StrokeRepository._(db, docId);
  }

  Future<void> saveAll(Map<int, List<Stroke>> pages) async {
    if (_closed) return;
    final entities = <StrokeEntity>[
      for (final e in pages.entries)
        for (final s in e.value)
          StrokeEntity()
            ..docId = docId
            ..page = e.key
            ..colorValue = s.style.color.toARGB32()
            ..size = s.style.size
            ..thinning = s.style.thinning
            ..smoothing = s.style.smoothing
            ..streamline = s.style.streamline
            ..simulatePressure = s.style.simulatePressure
            ..points = [
              for (final p in s.points) ...[p.x, p.y, p.pressure ?? 0.5],
            ],
    ];

    await _db.writeTxn(() async {
      await _db.strokeEntitys.filter().docIdEqualTo(docId).deleteAll();
      await _db.strokeEntitys.putAll(entities);
    });
  }

  Future<Map<int, List<Stroke>>> loadAll() async {
    if (_closed) return <int, List<Stroke>>{};
    final rows = await _db.strokeEntitys.filter().docIdEqualTo(docId).findAll();
    final result = <int, List<Stroke>>{};
    for (final r in rows) {
      final pts = <PointVector>[];
      for (var i = 0; i + 2 < r.points.length; i += 3) {
        pts.add(PointVector(r.points[i], r.points[i + 1], r.points[i + 2]));
      }
      result
          .putIfAbsent(r.page, () => <Stroke>[])
          .add(
            Stroke(
              id: '${docId}_${r.id}',
              style: StrokeStyle(
                color: Color(r.colorValue),
                size: r.size,
                thinning: r.thinning,
                smoothing: r.smoothing,
                streamline: r.streamline,
                simulatePressure: r.simulatePressure,
              ),
              points: pts,
            ),
          );
    }
    return result;
  }

  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    await _db.close();
  }
}
