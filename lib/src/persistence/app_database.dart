import 'package:isar/isar.dart';
import 'package:path_provider/path_provider.dart';

import 'document_entity.dart';
import 'settings_entity.dart';
import 'stroke_entity.dart';

/// مثيل Isar واحد مشترك لكل التطبيق.
///
/// ⚠️ Isar يرفض فتح نفس القاعدة بقوائم مخططات مختلفة، لذا يجب أن
/// يمرَّ كل الوصول إلى القاعدة من هنا — قائمة المخططات الكاملة في
/// مكان واحد فقط (إضافة كيان جديد = سطر واحد هنا).
class AppDatabase {
  AppDatabase._();

  static Future<Isar>? _opening;

  /// كل مخططات التطبيق — المكان الوحيد الذي تُسجَّل فيه.
  static List<CollectionSchema<dynamic>> get schemas => [
        StrokeEntitySchema,
        DocumentEntitySchema,
        SettingsEntitySchema,
      ];

  /// الفتح مرة واحدة فقط حتى مع استدعاءات متزامنة (شاشات متعددة) —
  /// المستقبل نفسه يُعاد للجميع فلا يوجد فتح مزدوج أبداً.
  static Future<Isar> instance() {
    return _opening ??= _open();
  }

  static Future<Isar> _open() async {
    final dir = await getApplicationDocumentsDirectory();
    return Isar.open(
      schemas,
      directory: dir.path,
      name: 'nanote',
    );
  }
}
