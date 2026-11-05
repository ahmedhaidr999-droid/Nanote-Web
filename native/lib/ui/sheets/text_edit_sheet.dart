import 'package:flutter/material.dart';

import '../../controllers/tool_controller.dart';
import '../../i18n/strings.dart';
import '../../models/page_elements.dart';
import '../../models/paper.dart';
import '../../theme/nanote_theme.dart';

/// Bottom sheet for creating / editing a text element. Callers show it with
/// `showModalBottomSheet(isScrollControlled: true)`; the sheet pads itself
/// above the keyboard via `viewInsets`.
class TextEditSheet extends StatefulWidget {
  final TextEl? initial;
  final ToolController tools;
  final void Function(
      String text, double fontSize, int colorValue, bool bold, int align)
      onSave;

  const TextEditSheet({
    super.key,
    this.initial,
    required this.tools,
    required this.onSave,
  });

  @override
  State<TextEditSheet> createState() => _TextEditSheetState();
}

class _TextEditSheetState extends State<TextEditSheet> {
  late final TextEditingController _text =
      TextEditingController(text: widget.initial?.text);
  late double _fontSize =
      (widget.initial?.fontSize ?? widget.tools.fontSize).clamp(10.0, 48.0);
  // tracked as a raw color value so colors outside the palette still work
  late int _colorValue =
      widget.initial?.colorValue ?? widget.tools.textColor.toARGB32();
  late bool _bold = widget.initial?.bold ?? widget.tools.textBold;
  late int _align = widget.initial?.align ?? 0;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  void _save() {
    if (_text.text.trim().isEmpty) {
      // empty text → just close, no save
      Navigator.of(context).pop();
      return;
    }
    widget.onSave(_text.text, _fontSize, _colorValue, _bold, _align);
  }

  @override
  Widget build(BuildContext context) {
    final colors = NanoteColors.of(context);
    final i18n = I18n.of(context);
    final selectedIdx =
        kInkPalette.indexWhere((c) => c.toARGB32() == _colorValue);
    return Padding(
      padding:
          EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsetsDirectional.fromSTEB(20, 0, 20, 20),
        child: SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                i18n.t('edit_text'),
                style: TextStyle(
                  color: colors.text,
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _text,
                autofocus: true,
                maxLines: 5,
                minLines: 2,
                style: TextStyle(
                  fontSize: _fontSize,
                  height: 1.35,
                  color: Color(_colorValue),
                  fontWeight: _bold ? FontWeight.w700 : FontWeight.w400,
                ),
                decoration: InputDecoration(
                  hintText: i18n.t('text_placeholder'),
                ),
              ),
              const SizedBox(height: 14),
              // font size
              Row(children: [
                Text(
                  i18n.t('size'),
                  style: TextStyle(
                    color: colors.textMuted,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const Spacer(),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: colors.primarySoft,
                    borderRadius: BorderRadius.circular(kNanoteRadius),
                  ),
                  child: Text(
                    '${_fontSize.round()}',
                    style: TextStyle(
                      color: colors.primary,
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                    ),
                  ),
                ),
              ]),
              Slider(
                value: _fontSize,
                min: 10,
                max: 48,
                divisions: 38,
                label: '${_fontSize.round()}',
                onChanged: (v) => setState(() => _fontSize = v),
              ),
              // color grid
              Wrap(
                spacing: 8,
                runSpacing: 10,
                children: [
                  for (var i = 0; i < kInkPalette.length; i++)
                    _Swatch(
                      color: kInkPalette[i],
                      selected: i == selectedIdx,
                      onTap: () => setState(
                        () => _colorValue = kInkPalette[i].toARGB32(),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 12),
              // bold + align
              Row(children: [
                IconButton(
                  isSelected: _bold,
                  tooltip: 'B',
                  icon: const Icon(Icons.format_bold_rounded),
                  onPressed: () => setState(() => _bold = !_bold),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: SegmentedButton<int>(
                    showSelectedIcon: false,
                    segments: const [
                      ButtonSegment(
                        value: 0,
                        icon: Icon(Icons.format_align_left_rounded),
                      ),
                      ButtonSegment(
                        value: 1,
                        icon: Icon(Icons.format_align_center_rounded),
                      ),
                      ButtonSegment(
                        value: 2,
                        icon: Icon(Icons.format_align_right_rounded),
                      ),
                    ],
                    selected: {_align},
                    onSelectionChanged: (sel) =>
                        setState(() => _align = sel.first),
                  ),
                ),
              ]),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _save,
                  icon: const Icon(Icons.check_rounded),
                  label: Text(i18n.t('save')),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Round ink-palette swatch (selected ring + luminance-aware check mark).
class _Swatch extends StatelessWidget {
  final Color color;
  final bool selected;
  final VoidCallback onTap;

  const _Swatch({
    required this.color,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final colors = NanoteColors.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(30),
      child: Container(
        width: 30,
        height: 30,
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
                size: 17,
                color: color.computeLuminance() > 0.55
                    ? Colors.black
                    : Colors.white,
              )
            : null,
      ),
    );
  }
}
