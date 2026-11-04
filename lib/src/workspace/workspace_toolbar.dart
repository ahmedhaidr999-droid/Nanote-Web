import 'package:flutter/material.dart';

import '../controllers/pdf_document_controller.dart';
import '../controllers/stroke_engine.dart';
import '../controllers/tool_controller.dart';
import '../controllers/viewport_controller.dart';
import '../models/tool.dart';
import 'doc_geometry.dart';

/// شريط الأدوات: تبديل القلم/التظليل/الممحاة/اليد + الألوان + الأحجام
/// + تراجع/إعادة + مؤشر الصفحة والتكبير.
///
/// أزرار فقط (بلا Sliders) → لا صراع إيماءات داخل القائمة الأفقية،
/// وكل هدف لمس ≥ 44px.
class WorkspaceToolbar extends StatelessWidget {
  const WorkspaceToolbar({
    super.key,
    required this.tools,
    required this.engine,
    required this.viewport,
    required this.pdf,
    required this.geometry,
  });

  final ToolController tools;
  final StrokeEngine engine;
  final ViewportController viewport;
  final PdfDocumentController pdf;
  final ValueGetter<DocGeometry> geometry;

  /// (حجم الفرشاة، القطر البصري للزر) — أحجام جاهزة بدل Slider.
  static const _penPresets = [(2.0, 5.0), (3.5, 9.0), (6.0, 14.0)];
  static const _eraserPresets = [(16.0, 7.0), (32.0, 12.0), (56.0, 17.0)];

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([tools, engine, viewport, pdf]),
      builder: (context, _) {
        final scheme = Theme.of(context).colorScheme;
        final tool = tools.tool;
        final isPen = tool.isInk;

        return Material(
          color: scheme.surface,
          elevation: 3,
          child: SafeArea(
            top: false,
            child: SizedBox(
              height: 64,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                children: [
                  SegmentedButton<Tool>(
                    showSelectedIcon: false,
                    segments: const [
                      ButtonSegment(
                        value: Tool.pen,
                        icon: Icon(Icons.edit_outlined),
                        label: Text('قلم'),
                      ),
                      ButtonSegment(
                        value: Tool.highlighter,
                        icon: Icon(Icons.highlight),
                        label: Text('تظليل'),
                      ),
                      ButtonSegment(
                        value: Tool.eraser,
                        icon: Icon(Icons.auto_fix_normal),
                        label: Text('ممحاة'),
                      ),
                      ButtonSegment(
                        value: Tool.hand,
                        icon: Icon(Icons.pan_tool_outlined),
                        label: Text('يد'),
                      ),
                    ],
                    selected: {tool},
                    onSelectionChanged: (s) => tools.setTool(s.first),
                  ),
                  const SizedBox(width: 10),
                  if (isPen) ...[
                    for (final c in ToolController.palette)
                      _ColorDot(
                        color: c,
                        selected: tools.color == c,
                        onTap: () => tools.setColor(c),
                      ),
                    const SizedBox(width: 6),
                    for (final (size, visual) in _penPresets)
                      _SizeDot(
                        visual: visual,
                        selected: tools.size == size,
                        onTap: () => tools.setSize(size),
                      ),
                  ],
                  if (tool == Tool.eraser)
                    for (final (size, visual) in _eraserPresets)
                      _SizeDot(
                        visual: visual,
                        selected: tools.eraserSize == size,
                        onTap: () => tools.setEraserSize(size),
                      ),
                  const SizedBox(width: 4),
                  IconButton(
                    tooltip: 'الرسم بالإصبع',
                    isSelected: tools.fingerDrawEnabled,
                    icon: const Icon(Icons.touch_app_outlined),
                    selectedIcon: const Icon(Icons.touch_app),
                    onPressed: tools.toggleFingerDraw,
                  ),
                  IconButton(
                    tooltip: 'تراجع',
                    icon: const Icon(Icons.undo),
                    onPressed: engine.canUndo ? engine.undo : null,
                  ),
                  IconButton(
                    tooltip: 'إعادة',
                    icon: const Icon(Icons.redo),
                    onPressed: engine.canRedo ? engine.redo : null,
                  ),
                  const SizedBox(width: 8),
                  _ZoomChip(
                    scale: viewport.scale,
                    pageLabel: _pageLabel(),
                    onFit: viewport.reset,
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  String _pageLabel() {
    final g = geometry();
    if (g.pageCount == 0) return '—';
    final p = g.pageAt(viewport.visibleDocRect.center);
    return p < 0 ? '—' : '${p + 1}/${g.pageCount}';
  }
}

class _ColorDot extends StatelessWidget {
  const _ColorDot({required this.color, required this.selected, this.onTap});

  final Color color;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: Center(
          child: Container(
            width: 26,
            height: 26,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
              border: Border.all(
                color: selected
                    ? Theme.of(context).colorScheme.primary
                    : Colors.black26,
                width: selected ? 2.5 : 1,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SizeDot extends StatelessWidget {
  const _SizeDot({required this.visual, required this.selected, this.onTap});

  final double visual;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: Center(
          child: Container(
            width: visual,
            height: visual,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: selected ? scheme.primary : scheme.onSurfaceVariant,
            ),
          ),
        ),
      ),
    );
  }
}

class _ZoomChip extends StatelessWidget {
  const _ZoomChip({required this.scale, required this.pageLabel, this.onFit});

  final double scale;
  final String pageLabel;
  final VoidCallback? onFit;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(pageLabel, style: Theme.of(context).textTheme.labelSmall),
            const SizedBox(width: 6),
            Text('${(scale * 100).round()}%',
                style: Theme.of(context).textTheme.labelSmall),
            const SizedBox(width: 4),
            InkWell(
              onTap: onFit,
              borderRadius: BorderRadius.circular(14),
              child: Padding(
                padding: const EdgeInsets.all(4),
                child: Icon(Icons.fit_screen, size: 18, color: scheme.primary),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
