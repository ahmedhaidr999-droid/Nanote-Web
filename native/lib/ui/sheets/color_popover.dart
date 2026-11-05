import 'package:flutter/material.dart';

import '../../controllers/tool_controller.dart';
import '../../i18n/strings.dart';
import '../../models/paper.dart';
import '../../models/stroke.dart';
import '../../models/tool.dart';
import '../../theme/nanote_theme.dart';
import '../../workspace/shape_path.dart';

// ───────────────────────── shared plumbing ─────────────────────────

/// Opens the standard compact modal bottom sheet used by every tool popover.
Future<T?> _sheet<T>(BuildContext context, WidgetBuilder builder) =>
    showModalBottomSheet<T>(
      context: context,
      showDragHandle: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: builder,
    );

/// ToolController exposes eraser radius/mode and laser color/width as plain
/// mutable fields with no dedicated setters. Mutate them directly, then force
/// a notify through a no-change setter call — `setTool(sameTool)` returns
/// early and never notifies, but the scalar setters always do.
void _poke(ToolController tools) =>
    tools.setShapeStrokeWidth(tools.shapeStrokeWidth);

String _trimNum(double v) =>
    v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(1);

/// Maps a stroke size to a visual dot diameter (preset circles whose
/// diameter represents the size).
double _presetDiameter(double s, bool highlighter) => highlighter
    ? (10 + s * 0.62).clamp(12.0, 34.0)
    : (8 + s * 3.2).clamp(12.0, 30.0);

TextStyle _labelStyle(NanoteColors colors) => TextStyle(
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: FontWeight.w600,
    );

Widget _valueChip(NanoteColors colors, String text) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: colors.primarySoft,
        borderRadius: BorderRadius.circular(kNanoteRadius),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: colors.primary,
          fontWeight: FontWeight.w700,
          fontSize: 13,
        ),
      ),
    );

// ───────────────────────── color grid ─────────────────────────

/// Color grid for the active ink tool — the 16-color ink palette for the
/// pen, the 5 translucent highlighter colors for the highlighter.
void showColorPopover(BuildContext context, ToolController tools) {
  _sheet<void>(
    context,
    (_) {
      final highlighter = tools.tool == Tool.highlighter;
      final palette = highlighter ? kHighlighterPalette : kInkPalette;
      return SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsetsDirectional.fromSTLB(20, 0, 20, 20),
          child: ListenableBuilder(
            listenable: tools,
            builder: (context, _) {
              final idx = highlighter ? tools.hlColorIdx : tools.penColorIdx;
              return Wrap(
                spacing: 10,
                runSpacing: 12,
                children: [
                  for (var i = 0; i < palette.length; i++)
                    _ColorSwatch(
                      color: palette[i],
                      selected: i == idx.clamp(0, palette.length - 1),
                      onTap: () {
                        if (highlighter) {
                          tools.setHlColorIdx(i);
                        } else {
                          tools.setPenColorIdx(i);
                        }
                        Navigator.of(context).pop();
                      },
                    ),
                ],
              );
            },
          ),
        ),
      );
    },
  );
}

// ───────────────────────── size ─────────────────────────

/// Size presets (circles whose diameter represents the size) + a fine
/// slider, for the active ink tool.
void showSizePopover(BuildContext context, ToolController tools) {
  _sheet<void>(
    context,
    (_) {
      final colors = NanoteColors.of(context);
      final i18n = I18n.of(context);
      return SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsetsDirectional.fromSTLB(20, 0, 20, 24),
          child: ListenableBuilder(
            listenable: tools,
            builder: (context, _) {
              final highlighter = tools.tool == Tool.highlighter;
              final presets =
                  highlighter ? ToolController.hlSizes : ToolController.penSizes;
              final value = tools.activeSize;
              return Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final s in presets)
                        _SizeDot(
                          diameter: _presetDiameter(s, highlighter),
                          selected: (value - s).abs() < 0.05,
                          onTap: () => highlighter
                              ? tools.setHlSize(s)
                              : tools.setPenSize(s),
                        ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  Row(children: [
                    Text(i18n.t('size'), style: _labelStyle(colors)),
                    const Spacer(),
                    _valueChip(colors, _trimNum(value)),
                  ]),
                  Slider(
                    value: value.clamp(1.0, 40.0),
                    min: 1,
                    max: 40,
                    divisions: 39,
                    label: _trimNum(value),
                    onChanged: (v) =>
                        highlighter ? tools.setHlSize(v) : tools.setPenSize(v),
                  ),
                ],
              );
            },
          ),
        ),
      );
    },
  );
}

// ───────────────────────── pen (kinds) ─────────────────────────

/// Pen popover: 5 pen-kind chips → ink color grid → size presets.
void showPenPopover(BuildContext context, ToolController tools) {
  _sheet<void>(
    context,
    (_) {
      final colors = NanoteColors.of(context);
      final i18n = I18n.of(context);
      return SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsetsDirectional.fromSTLB(20, 0, 20, 24),
          child: ListenableBuilder(
            listenable: tools,
            builder: (context, _) => Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  children: [
                    for (final kind in PenKind.values)
                      ChoiceChip(
                        label: Text(_penKindLabel(kind, i18n)),
                        selected: tools.penKind == kind,
                        onSelected: (_) => tools.setPenKind(kind),
                      ),
                  ],
                ),
                const SizedBox(height: 16),
                Text(i18n.t('color'), style: _labelStyle(colors)),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 10,
                  children: [
                    for (var i = 0; i < kInkPalette.length; i++)
                      _ColorSwatch(
                        size: 28,
                        color: kInkPalette[i],
                        selected: i ==
                            tools.penColorIdx
                                .clamp(0, kInkPalette.length - 1),
                        onTap: () => tools.setPenColorIdx(i),
                      ),
                  ],
                ),
                const SizedBox(height: 16),
                Text(i18n.t('size'), style: _labelStyle(colors)),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final s in ToolController.penSizes)
                      _SizeDot(
                        diameter: _presetDiameter(s, false),
                        selected: (tools.penSize - s).abs() < 0.05,
                        onTap: () => tools.setPenSize(s),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ),
      );
    },
  );
}

String _penKindLabel(PenKind k, I18n i18n) => switch (k) {
      PenKind.pen => i18n.t('pen_ballpoint'),
      PenKind.brush => i18n.t('pen_brush'),
      PenKind.pencil => i18n.t('pen_pencil'),
      PenKind.marker => i18n.t('pen_marker'),
      PenKind.highlighter => i18n.t('tool_highlighter'),
    };

// ───────────────────────── shapes ─────────────────────────

/// Shape tool popover: the 12 shape tiles, stroke color, fill toggle +
/// fill color, and a stroke-width slider.
void showShapePopover(BuildContext context, ToolController tools) {
  _sheet<void>(
    context,
    (_) {
      final colors = NanoteColors.of(context);
      final i18n = I18n.of(context);
      return SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsetsDirectional.fromSTLB(20, 0, 20, 24),
          child: ListenableBuilder(
            listenable: tools,
            builder: (context, _) => Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // 12 shape tiles
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final type in kShapeTypes)
                      _ShapeTile(
                        type: type,
                        selected: tools.shape == type,
                        onTap: () => tools.setShape(type),
                      ),
                  ],
                ),
                const SizedBox(height: 16),
                // stroke color
                Text(i18n.t('color'), style: _labelStyle(colors)),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (var i = 0; i < kInkPalette.length; i++)
                      _ColorSwatch(
                        size: 26,
                        color: kInkPalette[i],
                        selected: i ==
                            tools.shapeStrokeIdx
                                .clamp(0, kInkPalette.length - 1),
                        onTap: () => tools.setShapeStrokeIdx(i),
                      ),
                  ],
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(i18n.t('shape_fill')),
                  value: tools.shapeFilled,
                  onChanged: tools.setShapeFilled,
                ),
                if (tools.shapeFilled) ...[
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (var i = 0; i < kInkPalette.length; i++)
                        _ColorSwatch(
                          size: 26,
                          color: kInkPalette[i],
                          selected: i ==
                              tools.shapeFillIdx
                                  .clamp(0, kInkPalette.length - 1),
                          onTap: () => tools.setShapeFillIdx(i),
                        ),
                    ],
                  ),
                  const SizedBox(height: 12),
                ],
                // stroke width
                Row(children: [
                  Text(i18n.t('shape_stroke'), style: _labelStyle(colors)),
                  const Spacer(),
                  _valueChip(colors, _trimNum(tools.shapeStrokeWidth)),
                ]),
                Slider(
                  value: tools.shapeStrokeWidth.clamp(0.5, 8.0),
                  min: 0.5,
                  max: 8,
                  divisions: 15,
                  label: _trimNum(tools.shapeStrokeWidth),
                  onChanged: tools.setShapeStrokeWidth,
                ),
              ],
            ),
          ),
        ),
      );
    },
  );
}

// ───────────────────────── eraser ─────────────────────────

/// Eraser popover: radius slider + stroke/area mode switch.
void showEraserPopover(BuildContext context, ToolController tools) {
  _sheet<void>(
    context,
    (_) {
      final colors = NanoteColors.of(context);
      final i18n = I18n.of(context);
      return SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsetsDirectional.fromSTLB(20, 0, 20, 16),
          child: ListenableBuilder(
            listenable: tools,
            builder: (context, _) => Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Text(i18n.t('size'), style: _labelStyle(colors)),
                  const Spacer(),
                  _valueChip(colors, '${tools.eraserRadius.round()}'),
                ]),
                Slider(
                  value: tools.eraserRadius.clamp(4.0, 40.0),
                  min: 4,
                  max: 40,
                  divisions: 36,
                  label: '${tools.eraserRadius.round()}',
                  onChanged: (v) {
                    tools.eraserRadius = v;
                    _poke(tools);
                  },
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(i18n.t('eraser_stroke')),
                  subtitle: Text(
                    i18n.t(tools.areaEraser ? 'eraser_area' : 'eraser_stroke'),
                  ),
                  value: tools.areaEraser,
                  onChanged: (v) {
                    tools.areaEraser = v;
                    _poke(tools);
                  },
                ),
              ],
            ),
          ),
        ),
      );
    },
  );
}

// ───────────────────────── laser ─────────────────────────

/// Laser pointer popover: 5 trail colors + width slider.
/// (Matches `kLaserPalette` in ruler_overlay.dart.)
const _laserColors = [
  Color(0xFFE5484D),
  Color(0xFF30A46C),
  Color(0xFF1E6FF2),
  Color(0xFFF5A623),
  Color(0xFFD6409F),
];

void showLaserPopover(BuildContext context, ToolController tools) {
  _sheet<void>(
    context,
    (_) {
      final colors = NanoteColors.of(context);
      final i18n = I18n.of(context);
      return SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsetsDirectional.fromSTLB(20, 0, 20, 16),
          child: ListenableBuilder(
            listenable: tools,
            builder: (context, _) => Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(i18n.t('color'), style: _labelStyle(colors)),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    for (var i = 0; i < _laserColors.length; i++)
                      _ColorSwatch(
                        color: _laserColors[i],
                        selected: i ==
                            tools.laserColorIdx
                                .clamp(0, _laserColors.length - 1),
                        onTap: () {
                          tools.laserColorIdx = i;
                          _poke(tools);
                        },
                      ),
                  ],
                ),
                const SizedBox(height: 16),
                Row(children: [
                  Text(i18n.t('size'), style: _labelStyle(colors)),
                  const Spacer(),
                  _valueChip(colors, _trimNum(tools.laserWidth)),
                ]),
                Slider(
                  value: tools.laserWidth.clamp(2.0, 14.0),
                  min: 2,
                  max: 14,
                  divisions: 12,
                  label: _trimNum(tools.laserWidth),
                  onChanged: (v) {
                    tools.laserWidth = v;
                    _poke(tools);
                  },
                ),
              ],
            ),
          ),
        ),
      );
    },
  );
}

// ───────────────────────── pieces ─────────────────────────

/// Round color swatch with a selected ring + luminance-aware check mark.
class _ColorSwatch extends StatelessWidget {
  final Color color;
  final bool selected;
  final VoidCallback onTap;
  final double size;

  const _ColorSwatch({
    required this.color,
    required this.selected,
    required this.onTap,
    this.size = 32,
  });

  @override
  Widget build(BuildContext context) {
    final colors = NanoteColors.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(40),
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: color,
          border: Border.all(
            color: selected ? colors.primary : colors.border,
            width: selected ? 3 : 1,
          ),
        ),
        child: selected
            ? Icon(
                Icons.check_rounded,
                size: size * 0.55,
                color: color.computeLuminance() > 0.55
                    ? Colors.black
                    : Colors.white,
              )
            : null,
      ),
    );
  }
}

/// Preset-size circle: the inner dot's diameter represents the stroke size.
class _SizeDot extends StatelessWidget {
  final double diameter;
  final bool selected;
  final VoidCallback onTap;

  const _SizeDot({
    required this.diameter,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final colors = NanoteColors.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(24),
      child: Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: colors.surfaceAlt,
          border: Border.all(
            color: selected ? colors.primary : colors.border,
            width: selected ? 2 : 1,
          ),
        ),
        child: Center(
          child: Container(
            width: diameter,
            height: diameter,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: colors.text,
            ),
          ),
        ),
      ),
    );
  }
}

/// One of the 12 vector shape tiles, drawn via a tiny inline painter that
/// reuses the workspace `shapePath` geometry.
class _ShapeTile extends StatelessWidget {
  final ShapeType type;
  final bool selected;
  final ValueChanged<ShapeType> onTap;

  const _ShapeTile({
    required this.type,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final colors = NanoteColors.of(context);
    return InkWell(
      onTap: () => onTap(type),
      borderRadius: BorderRadius.circular(kNanoteRadius),
      child: Container(
        width: 62,
        height: 62,
        decoration: BoxDecoration(
          color: selected ? colors.primarySoft : colors.surfaceAlt,
          borderRadius: BorderRadius.circular(kNanoteRadius),
          border:
              Border.all(color: selected ? colors.primary : colors.border),
        ),
        child: Center(
          child: CustomPaint(
            size: const Size(42, 42),
            painter: _ShapeIconPainter(
              type,
              selected ? colors.primary : colors.text,
            ),
          ),
        ),
      ),
    );
  }
}

class _ShapeIconPainter extends CustomPainter {
  final ShapeType type;
  final Color color;

  const _ShapeIconPainter(this.type, this.color);

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Rect.fromLTWH(3, 3, size.width - 6, size.height - 6);
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.8
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..color = color;
    canvas.drawPath(shapePath(type, rect), paint);
  }

  @override
  bool shouldRepaint(_ShapeIconPainter oldDelegate) =>
      oldDelegate.type != type || oldDelegate.color != color;
}
