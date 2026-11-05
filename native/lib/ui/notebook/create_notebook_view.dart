import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../i18n/strings.dart';
import '../../models/library_models.dart';
import '../../models/paper.dart';
import '../../persistence/library_repository.dart';
import '../../theme/nanote_theme.dart';

/// Opens the "New notebook" modal sheet: name → cover → paper template →
/// paper size → create. Returns the freshly created [NotebookRow], or
/// null when the sheet is dismissed without creating.
Future<NotebookRow?> showCreateNotebookSheet(
    BuildContext context, LibraryRepository repo) {
  return showModalBottomSheet<NotebookRow>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _CreateNotebookSheet(repo: repo),
  );
}

class _CreateNotebookSheet extends StatefulWidget {
  final LibraryRepository repo;

  const _CreateNotebookSheet({required this.repo});

  @override
  State<_CreateNotebookSheet> createState() => _CreateNotebookSheetState();
}

class _CreateNotebookSheetState extends State<_CreateNotebookSheet> {
  final TextEditingController _nameCtrl = TextEditingController();

  /// One index drives BOTH `coverIdx` (art) and `colorIdx` (tint) — the
  /// picker couples palette slot and art slot, like the web build.
  int _coverIdx = 0;
  PaperTemplate _template = PaperTemplate.ruled;
  int _sizeIdx = 0;

  @override
  void dispose() {
    _nameCtrl.dispose();
    super.dispose();
  }

  void _create() {
    final i18n = I18n.of(context);
    final typed = _nameCtrl.text.trim();
    final nb = widget.repo.createNotebook(
      title: typed.isEmpty ? i18n.t('new_notebook') : typed,
      coverIdx: _coverIdx,
      colorIdx: _coverIdx,
      template: _template,
      sizeIdx: _sizeIdx,
    );
    Navigator.of(context).pop(nb);
  }

  @override
  Widget build(BuildContext context) {
    final c = NanoteColors.of(context);
    final i18n = I18n.of(context);

    return ConstrainedBox(
      // Cap the sheet at ~80% of the screen; content scrolls inside.
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.8,
      ),
      child: Padding(
        // Lift content above the keyboard (name field is autofocused).
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom,
        ),
        child: SingleChildScrollView(
          padding: const EdgeInsetsDirectional.fromSTEB(20, 4, 20, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                i18n.t('new_notebook'),
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  color: c.text,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _nameCtrl,
                autofocus: true,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _create(),
                style: TextStyle(color: c.text),
                decoration: InputDecoration(
                  hintText: i18n.t('new_notebook'),
                ),
              ),
              _sheetLabel(context, i18n.t('choose_cover')),
              _buildCoverRow(context),
              _sheetLabel(context, i18n.t('choose_paper')),
              _buildTemplateGrid(context),
              _sheetLabel(context, i18n.t('paper_size')),
              SegmentedButton<int>(
                segments: [
                  for (var i = 0; i < kPaperSizes.length; i++)
                    ButtonSegment(
                      value: i,
                      label: Text(i18n.t(kPaperSizes[i].labelKey)),
                    ),
                ],
                selected: {_sizeIdx},
                onSelectionChanged: (sel) =>
                    setState(() => _sizeIdx = sel.first),
              ),
              const SizedBox(height: 18),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _create,
                  icon: const Icon(Icons.add),
                  label: Text(i18n.t('create')),
                ),
              ),
              TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: Text(i18n.t('cancel')),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ── section label ─────────────────────────────────────────────────────

  Widget _sheetLabel(BuildContext context, String text) {
    final c = NanoteColors.of(context);
    return Padding(
      padding: const EdgeInsetsDirectional.only(top: 20, bottom: 8),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.5,
          color: c.textMuted,
        ),
      ),
    );
  }

  // ── cover picker ──────────────────────────────────────────────────────

  /// Horizontally scrolling row of the 8 cover swatches — each shows its
  /// art glyph on the matching palette gradient.
  Widget _buildCoverRow(BuildContext context) {
    return SizedBox(
      height: 64,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: kCoverPalette.length,
        separatorBuilder: (_, __) => const SizedBox(width: 10),
        itemBuilder: (context, i) => _buildCoverSwatch(context, i),
      ),
    );
  }

  Widget _buildCoverSwatch(BuildContext context, int i) {
    final c = NanoteColors.of(context);
    final (deep, soft) = kCoverPalette[i];
    final selected = i == _coverIdx;
    return InkWell(
      onTap: () => setState(() => _coverIdx = i),
      borderRadius: BorderRadius.circular(10),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 140),
        width: 48,
        height: 64,
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [deep, soft],
          ),
          borderRadius: BorderRadius.circular(10),
          // Selection ring (kept at constant width so tiles don't jump).
          border: Border.all(
            width: 2,
            color: selected ? c.primary : Colors.transparent,
          ),
        ),
        child: Icon(
          _coverIcon(kCoverArts[i]),
          size: 22,
          color: Colors.white.withValues(alpha: 0.92),
        ),
      ),
    );
  }

  // ── paper template picker ─────────────────────────────────────────────

  /// Flowing grid of all 12 paper templates with mini 44×56 previews.
  Widget _buildTemplateGrid(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final t in PaperTemplate.values)
          SizedBox(width: 74, child: _buildTemplateTile(context, t)),
      ],
    );
  }

  Widget _buildTemplateTile(BuildContext context, PaperTemplate t) {
    final c = NanoteColors.of(context);
    final i18n = I18n.of(context);
    final selected = t == _template;
    return InkWell(
      onTap: () => setState(() => _template = t),
      borderRadius: BorderRadius.circular(kNanoteRadius),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 140),
        padding: const EdgeInsetsDirectional.all(7),
        decoration: BoxDecoration(
          color: selected ? c.primarySoft : c.surfaceAlt,
          borderRadius: BorderRadius.circular(kNanoteRadius),
          border: Border.all(
            width: selected ? 1.8 : 1,
            color: selected ? c.primary : c.border,
          ),
        ),
        child: Column(
          children: [
            // Same preview painter for selected and unselected states —
            // selection only changes the tile chrome around it.
            CustomPaint(
              size: const Size(44, 56),
              painter: _PaperPreviewPainter(
                template: t,
                line: c.textMuted.withValues(alpha: 0.38),
                strong: c.textMuted.withValues(alpha: 0.60),
                dot: c.textMuted.withValues(alpha: 0.50),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              i18n.t(t.labelKey),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 11,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                color: selected ? c.primary : c.textMuted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Art glyph for each cover style (waves, dots, lines, arc, grid, spiral,
/// sun, triangles) — same mapping the notebook cards use.
IconData _coverIcon(CoverArt art) => switch (art) {
      CoverArt.waves => Icons.waves,
      CoverArt.dots => Icons.blur_on,
      CoverArt.lines => Icons.line_weight,
      CoverArt.arc => Icons.architecture,
      CoverArt.grid => Icons.grid_on,
      CoverArt.spiral => Icons.all_inclusive,
      CoverArt.sun => Icons.wb_sunny,
      CoverArt.triangles => Icons.change_history,
    };

/// Miniature (44×56) paper-template preview drawn with muted Nanote tones
/// passed in from the current palette. Renders all 12 templates; `plain`
/// paints nothing, `graphFine`/`dotsFine` use denser pitches, `cornell`
/// splits a cue column, `music` draws 5-line staves, `checklist` draws
/// checkbox rows.
class _PaperPreviewPainter extends CustomPainter {
  final PaperTemplate template;
  final Color line;
  final Color strong;
  final Color dot;

  const _PaperPreviewPainter({
    required this.template,
    required this.line,
    required this.strong,
    required this.dot,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    final lp = Paint()
      ..color = line
      ..strokeWidth = 1
      ..style = PaintingStyle.stroke;
    final sp = Paint()
      ..color = strong
      ..strokeWidth = 1.4
      ..style = PaintingStyle.stroke;
    final dp = Paint()
      ..color = dot
      ..style = PaintingStyle.fill;

    switch (template) {
      case PaperTemplate.plain:
        break;
      case PaperTemplate.ruled:
      case PaperTemplate.ruledMargin:
        for (var y = 9.0; y < h; y += 9) {
          canvas.drawLine(Offset(0, y), Offset(w, y), lp);
        }
        if (template == PaperTemplate.ruledMargin) {
          final mx = w * 0.2;
          canvas.drawLine(Offset(mx, 0), Offset(mx, h), sp);
        }
      case PaperTemplate.graph:
        _grid(canvas, w, h, lp, 9.5);
      case PaperTemplate.graphFine:
        _grid(canvas, w, h, lp, 5);
      case PaperTemplate.dots:
        _dots(canvas, w, h, dp, 9.5);
      case PaperTemplate.dotsFine:
        _dots(canvas, w, h, dp, 5);
      case PaperTemplate.isometric:
        // Diagonal cross-hatch (±30° iso lines).
        for (var x = -h; x < w + h; x += 11) {
          canvas.drawLine(Offset(x, 0), Offset(x + h * 0.577, h), lp);
          canvas.drawLine(Offset(x, 0), Offset(x - h * 0.577, h), lp);
        }
      case PaperTemplate.hex:
        _hexes(canvas, w, h, lp);
      case PaperTemplate.cornell:
        // Cue column on the leading edge + horizontal split.
        final cueEnd = w * 0.3;
        final splitY = h * 0.28;
        canvas.drawLine(Offset(cueEnd, splitY), Offset(cueEnd, h), sp);
        canvas.drawLine(Offset(0, splitY), Offset(w, splitY), sp);
        for (var y = splitY + 9; y < h; y += 9) {
          canvas.drawLine(Offset(0, y), Offset(w, y), lp);
        }
      case PaperTemplate.music:
        // Groups of 5 staff lines.
        const staffGap = 3.2;
        for (var y = 9.0; y < h - staffGap * 5; y += 24) {
          for (var i = 0; i < 5; i++) {
            final ly = y + i * staffGap;
            canvas.drawLine(Offset(0, ly), Offset(w, ly),
                i == 0 || i == 4 ? sp : lp);
          }
        }
      case PaperTemplate.checklist:
        for (var y = 10.0; y < h; y += 13) {
          canvas.drawLine(Offset(10, y), Offset(w, y), lp);
          canvas.drawRRect(
            RRect.fromRectAndRadius(
              Rect.fromLTWH(2, y - 4, 6, 6),
              const Radius.circular(1.5),
            ),
            sp,
          );
        }
    }
  }

  void _grid(Canvas canvas, double w, double h, Paint p, double pitch) {
    for (var x = pitch; x < w; x += pitch) {
      canvas.drawLine(Offset(x, 0), Offset(x, h), p);
    }
    for (var y = pitch; y < h; y += pitch) {
      canvas.drawLine(Offset(0, y), Offset(w, y), p);
    }
  }

  void _dots(Canvas canvas, double w, double h, Paint p, double pitch) {
    for (var x = pitch; x < w; x += pitch) {
      for (var y = pitch; y < h; y += pitch) {
        canvas.drawCircle(Offset(x, y), 0.9, p);
      }
    }
  }

  void _hexes(Canvas canvas, double w, double h, Paint p) {
    const r = 5.2;
    const hStep = r * 1.5;
    final vStep = r * math.sqrt(3);
    var row = 0;
    for (var y = 0.0; y < h + vStep; y += vStep, row++) {
      final xOff = row.isEven ? 0.0 : hStep;
      for (var x = -r * 2 + xOff; x < w + r * 2; x += hStep * 2) {
        final cy = y + vStep / 2;
        final path = Path();
        for (var i = 0; i < 6; i++) {
          final ang = math.pi / 6 + i * math.pi / 3;
          final px = x + math.cos(ang) * r;
          final py = cy + math.sin(ang) * r;
          if (i == 0) {
            path.moveTo(px, py);
          } else {
            path.lineTo(px, py);
          }
        }
        path.close();
        canvas.drawPath(path, p);
      }
    }
  }

  @override
  bool shouldRepaint(_PaperPreviewPainter old) =>
      old.template != template ||
      old.line != line ||
      old.strong != strong ||
      old.dot != dot;
}
