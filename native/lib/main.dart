import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'controllers/library_controller.dart';
import 'controllers/settings_controller.dart';
import 'i18n/strings.dart';
import 'persistence/file_store.dart';
import 'persistence/library_repository.dart';
import 'persistence/settings_store.dart';
import 'services/backup_service.dart';
import 'services/image_cache.dart';
import 'theme/nanote_theme.dart';
import 'ui/home_shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final fs = FileStore();
  await fs.init();

  final repo = LibraryRepository(fs);
  final settings = SettingsController(SettingsStore(fs));
  await settings.load();

  final library = LibraryController(repo);
  await library.boot();

  final images = AppImageCache(fs);
  final backup = BackupService(fs, repo, settings.store);

  runApp(NanoteApp(
    library: library,
    repo: repo,
    settings: settings,
    fs: fs,
    images: images,
    backup: backup,
  ));
}

class NanoteApp extends StatelessWidget {
  final LibraryController library;
  final LibraryRepository repo;
  final SettingsController settings;
  final FileStore fs;
  final AppImageCache images;
  final BackupService backup;

  const NanoteApp({
    super.key,
    required this.library,
    required this.repo,
    required this.settings,
    required this.fs,
    required this.images,
    required this.backup,
  });

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: settings,
      builder: (context, _) => MaterialApp(
        title: 'Nanote',
        debugShowCheckedModeBanner: false,
        theme: nanoteTheme(Brightness.light),
        darkTheme: nanoteTheme(Brightness.dark),
        themeMode: settings.themeMode,
        locale: settings.locale,
        supportedLocales: const [Locale('ar'), Locale('en')],
        localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
          NanoteLocalizationsDelegate(),
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        builder: (context, child) => Directionality(
          textDirection: I18n.of(context).dir,
          child: child ?? const SizedBox.shrink(),
        ),
        home: HomeShell(
          library: library,
          repo: repo,
          settings: settings,
          fs: fs,
          images: images,
          backup: backup,
        ),
      ),
    );
  }
}
