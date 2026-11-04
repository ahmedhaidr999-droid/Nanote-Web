import 'package:isar/isar.dart';

part 'settings_entity.g.dart';

/// إعدادات التطبيق — صف واحد (id = 1) يُقرأ عند الإقلاع ويُكتب
/// write-through عند كل تغيير (مع debounce قصير لسلاسة السحّابات).
@collection
class SettingsEntity {
  Id id = 1;

  /// 0 نظام · 1 فاتح · 2 داكن (ThemeMode.index).
  late int themeMode;

  /// لون القلم الافتراضي (ARGB32).
  late int penColorValue;

  /// قطر القلم الافتراضي بنقاط الصفحة.
  late double penSize;

  /// عدد صفحات الدفتر الجديد.
  late int defaultPageCount;

  /// 0 شبكة · 1 قائمة (LibraryView.index).
  late int libraryView;

  /// 0 آخر تحديث · 1 الأحدث إنشاءً · 2 العنوان (LibrarySort.index).
  late int librarySort;

  /// القيم الافتراضية لأول تشغيل.
  void setDefaults() {
    themeMode = 0; // النظام
    penColorValue = 0xFF1C1C1E;
    penSize = 3.5;
    defaultPageCount = 20;
    libraryView = 0; // شبكة
    librarySort = 0; // آخر تحديث
  }
}
