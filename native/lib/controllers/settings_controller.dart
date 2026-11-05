import 'dart:async';

import 'package:flutter/material.dart';

import '../models/settings.dart';
import '../persistence/settings_store.dart';

/// App-wide settings + theme/locale resolution. MaterialApp rebuilds on it.
class SettingsController extends ChangeNotifier {
  final SettingsStore store;
  SettingsController(this.store);

  AppSettings get s => store.value;
  StreamSubscription? _sub;

  Future<void> load() async {
    await store.load();
    _sub = store.changes.listen((_) => notifyListeners());
  }

  Future<void> update(AppSettings next) async {
    await store.update(next);
    notifyListeners();
  }

  Future<void> Function(AppSettings) get updater => update;

  ThemeMode get themeMode => switch (s.themeMode) {
    'light' => ThemeMode.light,
    'dark' => ThemeMode.dark,
    _ => ThemeMode.system,
  };

  Locale get locale => switch (s.language) {
    'ar' => const Locale('ar'),
    'en' => const Locale('en'),
    _ => WidgetsBinding.instance.platformDispatcher.locale.languageCode == 'en'
        ? const Locale('en') : const Locale('ar'),
  };

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}
