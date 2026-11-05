import 'dart:async';

import '../models/settings.dart';
import 'file_store.dart';

/// Settings: JSON file + change stream.
class SettingsStore {
  final FileStore fs;
  SettingsStore(this.fs);

  late AppSettings value;
  final _controller = StreamController<String>.broadcast();
  Stream<String> get changes => _controller.stream;

  Future<void> load() async {
    final j = fs.readSettingsJson();
    value = j == null ? AppSettings() : AppSettings.fromJson(j);
  }

  Future<void> update(AppSettings next) async {
    value = next;
    await fs.writeSettingsJson(next.toJson());
    if (!_controller.isClosed) _controller.add('settings');
  }

  void dispose() => _controller.close();
}
