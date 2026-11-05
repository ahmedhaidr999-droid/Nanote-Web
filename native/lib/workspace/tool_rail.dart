import 'package:flutter/material.dart';

import '../controllers/stroke_engine.dart';
import '../controllers/tool_controller.dart';
import '../i18n/strings.dart';
import '../models/paper.dart';
import '../models/tool.dart';
import '../theme/nanote_theme.dart';
import '../ui/sheets/color_popover.dart';
import 'ruler_overlay.dart';

/// Bottom tool rail: horizontally scrollable tool buttons + contextual
/// color/size controls. Panel tools (image/sticker/audio/translate) fire
/// [onPanelTool] instead of switching the active canvas tool.
class ToolRail extends StatelessWidget {
  final ToolController tools;
  final StrokeEngine engine;
  final RulerModel ruler;
  final void Function(Tool tool) onPanelTool;
  final VoidCallback? onRenameNotebook;

  const ToolRail({
    super.key,
    required this.tools,
    required this.engine,
    required this.ruler,
    required this.onPanelTool,
    this.onRenameNotebook,
  });

  @override
  Widget build(BuildContext context) {
    final colors = NanoteColors.of(context);
    final i18n = I18n.of(context);
    return ListenableBuilder(
      listenable: Listenable.merge([tools, engine]),
      builder: (_, __) => SafeArea(
        top: false,
        child: Container(
          decoration: BoxDecoration(
            color: colors.surface,
            border: Border(top: BorderSide(color: colors.border)),
          ),
          padding: const EdgeInsets.fromLTRB(8, 6, 8, 8),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            _selectionBar(context, colors, i18n),
            SizedBox(
              height: 58,
              child: Row(children: [
                Expanded(
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    children: [
                      _ToolBtn(
                        icon: Icons.edit_rounded,
                        label: i18n.t('tool_pen'),
                        selected: tools.tool == Tool.pen,
                        colorDot: tools.tool == Tool.highlighter
                            ? null : tools.activeColor,
                        onTap: () => tools.setTool(Tool.pen),
                        onLongPress: () => showPenPopover(context, tools),
                      ),
                      _ToolBtn(
                        icon: Icons.highlight_rounded,
                        label: i18n.t('tool_highlighter'),
                        selected: tools.tool == Tool.highlighter,
                        colorDot: tools.tool == Tool.highlighter
                            ? tools.activeColor : null,
                        onTap: () => tools.setTool(Tool.highlighter),
                      ),
                      _ToolBtn(
                        icon: Icons.auto_fix_normal_rounded,
                        label: i18n.t('tool_eraser'),
                        selected: tools.tool == Tool.eraser,
                        onTap: () => tools.setTool(Tool.eraser),
                        onLongPress: () => showEraserPopover(context, tools),
                      ),
                      _ToolBtn(
                        icon: Icons.category_rounded,
                        label: i18n.t('tool_shape'),
                        selected: tools.tool == Tool.shape,
                        onTap: () => tools.setTool(Tool.shape),
                        onLongPress: () => showShapePopover(context, tools),
                      ),
                      _ToolBtn(
                        icon: Icons.text_fields_rounded,
                        label: i18n.t('tool_text'),
                        selected: tools.tool == Tool.text,
                        onTap: () => tools.setTool(Tool.text),
                      ),
                      _ToolBtn(
                        icon: Icons.crop_square_rounded,
                        label: i18n.t('tool_selector'),
                        selected: tools.tool == Tool.selector,
                        onTap: () => tools.setTool(Tool.selector),
                      ),
                      _ToolBtn(
                        icon: Icons.flashlight_on_rounded,
                        label: i18n.t('tool_laser'),
                        selected: tools.tool == Tool.laser,
                        onTap: () => tools.setTool(Tool.laser),
                        onLongPress: () => showLaserPopover(context, tools),
                      ),
                      _ToolBtn(
                        icon: Icons.straighten_rounded,
                        label: i18n.t('tool_ruler'),
                        selected: ruler.active,
                        onTap: ruler.toggle,
                      ),
                      _ToolBtn(
                        icon: Icons.image_rounded,
                        label: i18n.t('tool_image'),
                        selected: false,
                        onTap: () => onPanelTool(Tool.image),
                      ),
                      _ToolBtn(
                        icon: Icons.emoji_emotions_rounded,
                        label: i18n.t('tool_sticker'),
                        selected: false,
                        onTap: () => onPanelTool(Tool.sticker),
                      ),
                      _ToolBtn(
                        icon: Icons.mic_rounded,
                        label: i18n.t('tool_audio'),
                        selected: false,
                        onTap: () => onPanelTool(Tool.audio),
                      ),
                      _ToolBtn(
                        icon: Icons.translate_rounded,
                        label: i18n.t('tool_translate'),
                        selected: false,
                        onTap: () => onPanelTool(Tool.translate),
                      ),
                      _ToolBtn(
                        icon: Icons.pan_tool_rounded,
                        label: i18n.t('tool_pan'),
                        selected: tools.tool == Tool.pan,
                        onTap: () => tools.setTool(Tool.pan),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 6),
                // contextual color + size
                _ColorButton(tools: tools),
                const SizedBox(width: 6),
                _SizeButton(tools: tools),
              ]),
            ),
          ]),
        ),
      ),
    );
  }

  Widget _selectionBar(BuildContext context, NanoteColors colors, I18n i18n) {
    if (!engine.hasSelection) return const SizedBox.shrink();
    final btnStyle = IconButton.styleFrom(
      visualDensity: VisualDensity.compact,
      foregroundColor: colors.text,
    );
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: colors.primarySoft,
        borderRadius: BorderRadius.circular(kNanoteRadius),
      ),
      child: SizedBox(
        height: 44,
        child: ListView(
          scrollDirection: Axis.horizontal,
          children: [
            IconButton(
              style: btnStyle,
              tooltip: i18n.t('copy'),
              onPressed: () => engine.copySelection(),
              icon: const Icon(Icons.copy_rounded, size: 20),
            ),
            IconButton(
              style: btnStyle,
              tooltip: i18n.t('cut'),
              onPressed: () => engine.cutSelection(),
              icon: const Icon(Icons.content_cut_rounded, size: 20),
            ),
            IconButton(
              style: btnStyle,
              tooltip: i18n.t('paste'),
              onPressed: engine.hasClipboard
                  ? () => engine.pasteAt()
                  : null,
              icon: const Icon(Icons.paste_rounded, size: 20),
            ),
            IconButton(
              style: btnStyle,
              tooltip: i18n.t('group'),
              onPressed: () => engine.groupSelection(),
              icon: const Icon(Icons.workspaces_rounded, size: 20),
            ),
            IconButton(
              style: btnStyle,
              tooltip: i18n.t('ungroup'),
              onPressed: () => engine.ungroupSelection(),
              icon: const Icon(Icons.format_color_reset_rounded, size: 20),
            ),
            IconButton(
              style: btnStyle,
              tooltip: i18n.t('bring_front'),
              onPressed: () => engine.bringSelectionToFront(),
              icon: const Icon(Icons.flip_to_front_rounded, size: 20),
            ),
            IconButton(
              style: btnStyle,
              tooltip: i18n.t('send_back'),
              onPressed: () => engine.sendSelectionToBack(),
              icon: const Icon(Icons.flip_to_back_rounded, size: 20),
            ),
            IconButton(
              style: btnStyle,
              tooltip: i18n.t('delete_selection'),
              onPressed: () => engine.deleteSelection(),
              icon: Icon(Icons.delete_rounded,
                  size: 20, color: colors.danger),
            ),
            IconButton(
              style: btnStyle,
              tooltip: i18n.t('clear_selection'),
              onPressed: () => engine.clearSelection(),
              icon: const Icon(Icons.close_rounded, size: 20),
            ),
          ],
        ),
      ),
    );
  }
}

class _ToolBtn extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;
  final Color? colorDot;

  const _ToolBtn({
    required this.icon, required this.label, required this.selected,
    required this.onTap, this.onLongPress, this.colorDot,
  });

  @override
  Widget build(BuildContext context) {
    final colors = NanoteColors.of(context);
    return Padding(
      padding: const EdgeInsetsDirectional.only(end: 4),
      child: InkWell(
        borderRadius: BorderRadius.circular(kNanoteRadius),
        onTap: onTap,
        onLongPress: onLongPress,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 120),
          width: 62,
          decoration: BoxDecoration(
            color: selected ? colors.primarySoft : Colors.transparent,
            borderRadius: BorderRadius.circular(kNanoteRadius),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Stack(clipBehavior: Clip.none, children: [
                Icon(icon,
                    size: 22,
                    color: selected ? colors.primary : colors.textMuted),
                if (colorDot != null)
                  PositionedDirectional(
                    end: -2, top: -2,
                    child: Container(
                      width: 11, height: 11,
                      decoration: BoxDecoration(
                        color: colorDot,
                        shape: BoxShape.circle,
                        border: Border.all(
                            color: colors.surface, width: 1.6),
                      ),
                    ),
                  ),
              ]),
              const SizedBox(height: 2),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: selected ? colors.primary : colors.textMuted,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ColorButton extends StatelessWidget {
  final ToolController tools;
  const _ColorButton({required this.tools});

  @override
  Widget build(BuildContext context) {
    final colors = NanoteColors.of(context);
    final relevant = tools.tool == Tool.highlighter
        ? kHighlighterPalette : kInkPalette;
    final idx = tools.tool == Tool.highlighter
        ? tools.hlColorIdx : tools.penColorIdx;
    final current = relevant[idx.clamp(0, relevant.length - 1)];
    return InkWell(
      borderRadius: BorderRadius.circular(kNanoteRadius),
      onTap: () => showColorPopover(context, tools),
      child: Container(
        width: 46, height: 46,
        decoration: BoxDecoration(
          color: colors.surfaceAlt,
          borderRadius: BorderRadius.circular(kNanoteRadius),
        ),
        child: Center(
          child: Container(
            width: 24, height: 24,
            decoration: BoxDecoration(
              color: current,
              shape: BoxShape.circle,
              border: Border.all(color: colors.border),
            ),
          ),
        ),
      ),
    );
  }
}

class _SizeButton extends StatelessWidget {
  final ToolController tools;
  const _SizeButton({required this.tools});

  @override
  Widget build(BuildContext context) {
    final colors = NanoteColors.of(context);
    final size = tools.activeSize;
    final dot = (size * 1.6).clamp(4.0, 26.0);
    return InkWell(
      borderRadius: BorderRadius.circular(kNanoteRadius),
      onTap: () => showSizePopover(context, tools),
      child: Container(
        width: 46, height: 46,
        decoration: BoxDecoration(
          color: colors.surfaceAlt,
          borderRadius: BorderRadius.circular(kNanoteRadius),
        ),
        child: Center(
          child: Container(
            width: dot, height: dot,
            decoration: BoxDecoration(
              color: colors.text,
              shape: BoxShape.circle,
            ),
          ),
        ),
      ),
    );
  }
}
