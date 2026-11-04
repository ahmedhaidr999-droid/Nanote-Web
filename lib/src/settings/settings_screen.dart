import 'package:flutter/material.dart';

import '../app/settings_controller.dart';
import '../controllers/tool_controller.dart';
import '../models/library_prefs.dart';

/// الإعدادات — نسخة Native من شاشة الإعدادات القديمة، مرتبطة فعلياً:
/// السمة تعمل فوراً على كل التطبيق، والقلم الافتراضي يدخل مساحة
/// العمل مع كل مستند يُفتح، وتفضيلات المكتبة تُطبَّق في شاشتها.
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key, required this.settings});

  final SettingsController settings;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('الإعدادات')),
      body: AnimatedBuilder(
        animation: settings,
        builder: (context, _) => ListView(
          children: [
            _section(context, 'المظهر'),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: SegmentedButton<ThemeMode>(
                segments: const [
                  ButtonSegment(
                    value: ThemeMode.system,
                    label: Text('النظام'),
                    icon: Icon(Icons.brightness_auto_outlined),
                  ),
                  ButtonSegment(
                    value: ThemeMode.light,
                    label: Text('فاتح'),
                    icon: Icon(Icons.light_mode_outlined),
                  ),
                  ButtonSegment(
                    value: ThemeMode.dark,
                    label: Text('داكن'),
                    icon: Icon(Icons.dark_mode_outlined),
                  ),
                ],
                selected: {settings.themeMode},
                onSelectionChanged: (s) => settings.themeMode = s.first,
              ),
            ),
            _section(context, 'القلم الافتراضي'),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: [
                      for (final c in ToolController.palette)
                        _ColorDot(
                          color: c,
                          selected:
                              settings.penColor.toARGB32() == c.toARGB32(),
                          onTap: () => settings.penColor = c,
                        ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      const Text('السمك'),
                      Expanded(
                        child: Slider(
                          value: settings.penSize,
                          min: 1,
                          max: 8,
                          divisions: 14,
                          label: settings.penSize.toStringAsFixed(1),
                          onChanged: (v) => settings.penSize = v,
                        ),
                      ),
                      SizedBox(
                        width: 40,
                        child: Text(
                          settings.penSize.toStringAsFixed(1),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            _section(context, 'الدفاتر الجديدة'),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  const Text('عدد الصفحات'),
                  Expanded(
                    child: Slider(
                      value: settings.defaultPageCount.toDouble(),
                      min: 1,
                      max: 100,
                      divisions: 99,
                      label: '${settings.defaultPageCount}',
                      onChanged: (v) =>
                          settings.defaultPageCount = v.round(),
                    ),
                  ),
                  SizedBox(
                    width: 36,
                    child: Text(
                      '${settings.defaultPageCount}',
                      textAlign: TextAlign.center,
                    ),
                  ),
                ],
              ),
            ),
            _section(context, 'المكتبة'),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16),
              child: _LibraryPrefs(),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Widget _section(BuildContext context, String title) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 8),
        child: Text(
          title,
          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                color: Theme.of(context).colorScheme.primary,
              ),
        ),
      );
}

class _LibraryPrefs extends StatelessWidget {
  const _LibraryPrefs();

  @override
  Widget build(BuildContext context) {
    // الـ settings تُقرأ من الخارج عبر AnimatedBuilder الأب — هذه
    // القطعة تُبنى من جديد مع كل تغيير، لذا نصل إليها من الـ scope.
    final settings =
        context.findAncestorWidgetOfExactType<SettingsScreen>()!.settings;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('العرض الافتراضي'),
        const SizedBox(height: 6),
        SegmentedButton<LibraryView>(
          segments: const [
            ButtonSegment(
              value: LibraryView.grid,
              label: Text('شبكة'),
              icon: Icon(Icons.grid_view_outlined),
            ),
            ButtonSegment(
              value: LibraryView.list,
              label: Text('قائمة'),
              icon: Icon(Icons.view_list_outlined),
            ),
          ],
          selected: {settings.libraryView},
          onSelectionChanged: (s) => settings.libraryView = s.first,
        ),
        const SizedBox(height: 12),
        const Text('الترتيب الافتراضي'),
        const SizedBox(height: 6),
        SegmentedButton<LibrarySort>(
          segments: const [
            ButtonSegment(
                value: LibrarySort.updatedDesc, label: Text('تعديل')),
            ButtonSegment(
                value: LibrarySort.createdDesc, label: Text('إنشاء')),
            ButtonSegment(value: LibrarySort.titleAsc, label: Text('عنوان')),
          ],
          selected: {settings.librarySort},
          onSelectionChanged: (s) => settings.librarySort = s.first,
        ),
      ],
    );
  }
}

class _ColorDot extends StatelessWidget {
  const _ColorDot({
    required this.color,
    required this.selected,
    required this.onTap,
  });

  final Color color;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      customBorder: const CircleBorder(),
      onTap: onTap,
      child: Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(
          color: color,
          shape: BoxShape.circle,
          border: Border.all(
            width: 3,
            color: selected
                ? Theme.of(context).colorScheme.primary
                : Colors.transparent,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.15),
              blurRadius: 4,
              offset: const Offset(0, 1),
            ),
          ],
        ),
        child: selected
            ? const Icon(Icons.check, size: 20, color: Colors.white)
            : null,
      ),
    );
  }
}
