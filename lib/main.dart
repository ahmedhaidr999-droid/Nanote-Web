import 'package:flutter/material.dart';

import 'src/app/settings_controller.dart';
import 'src/library/library_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final settings = await SettingsController.load();
  runApp(NanoteApp(settings: settings));
}

class NanoteApp extends StatelessWidget {
  const NanoteApp({super.key, required this.settings});

  final SettingsController settings;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: settings,
      builder: (context, _) => MaterialApp(
        title: 'Nanote',
        debugShowCheckedModeBanner: false,
        themeMode: settings.themeMode,
        theme: ThemeData(
          useMaterial3: true,
          colorSchemeSeed: const Color(0xFF8250DF),
        ),
        darkTheme: ThemeData(
          useMaterial3: true,
          colorSchemeSeed: const Color(0xFF8250DF),
          brightness: Brightness.dark,
        ),
        home: LibraryScreen(settings: settings),
      ),
    );
  }
}
