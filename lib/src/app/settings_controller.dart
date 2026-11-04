import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart' show Color, ThemeMode;
import 'package:isar/isar.dart';

import '../models/library_prefs.dart';
import '../persistence/app_database.dart';
import '../persistence/settings_entity.dart';

/// إعدادات التطبيق الحية: تُحمَّل مرة عند الإقلاع، وكل تغيير يُكتب
/// إلى Isar في الخلفية (write-through مع debounce قصير لسلاسة
/// السحّابات) ويُبلَّغ المستمعون فوراً — السمة والمكتبة ومساحة العمل
/// كلها تقرأ من هنا.
class SettingsController extends ChangeNotifier {
  SettingsController._(this._db, this._row);

  final Isar _db;
  SettingsEntity _row;
  Timer? _saveDebounce;
  bool _disposed = false;

  /// التحميل — مع إنشاء الصف الافتراضي عند أول تشغيل.
  static Future<SettingsController> load() async {
    final db = await AppDatabase.instance();
    var row = await db.settingsEntitys.get(1);
    if (row == null) {
      final fresh = SettingsEntity()..setDefaults();
      await db.writeTxn(() => db.settingsEntitys.put(fresh));
      row = fresh;
    }
    return SettingsController._(db, row);
  }

  ThemeMode get themeMode =>
      _enumValue(_row.themeMode, ThemeMode.values, ThemeMode.system);

  set themeMode(ThemeMode v) => _set(_row..themeMode = v.index);

  Color get penColor => Color(_row.penColorValue);

  set penColor(Color v) => _set(_row..penColorValue = v.toARGB32());

  double get penSize => _row.penSize;

  set penSize(double v) => _set(_row..penSize = v);

  int get defaultPageCount => _row.defaultPageCount;

  set defaultPageCount(int v) => _set(_row..defaultPageCount = v);

  LibraryView get libraryView =>
      _enumValue(_row.libraryView, LibraryView.values, LibraryView.grid);

  set libraryView(LibraryView v) => _set(_row..libraryView = v.index);

  LibrarySort get librarySort => _enumValue(
      _row.librarySort, LibrarySort.values, LibrarySort.updatedDesc);

  set librarySort(LibrarySort v) => _set(_row..librarySort = v.index);

  // ───────────────────────── الداخل ─────────────────────────

  void _set(SettingsEntity updated) {
    _row = updated;
    notifyListeners();
    _saveDebounce?.cancel();
    _saveDebounce = Timer(const Duration(milliseconds: 250), _write);
  }

  Future<void> _write() async {
    if (_disposed) return;
    try {
      await _db.writeTxn(() => _db.settingsEntitys.put(_row));
    } catch (e) {
      debugPrint('Nanote: settings write failed ($e)');
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _saveDebounce?.cancel();
    super.dispose();
  }
}

/// قراءة enum مخزَّن كرقم مع قيمة بديلة آمنة — لا انهيار أبداً بسبب
/// قيمة قديمة في القاعدة بعد تغيير ترتيب الـ enum.
T _enumValue<T>(int index, List<T> values, T fallback) =>
    index >= 0 && index < values.length ? values[index] : fallback;
