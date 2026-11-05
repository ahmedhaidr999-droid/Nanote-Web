import 'package:flutter/material.dart';

/// Grid pitch in page-points for graph/dots templates.
const double kGridPitch = 24;

/// Paper background templates (12) — v1.9.1 set.
enum PaperTemplate {
  plain, ruled, ruledMargin, graph, graphFine, dots, dotsFine,
  isometric, hex, cornell, music, checklist,
}

extension PaperTemplateX on PaperTemplate {
  /// Nearest i18n key (fine variants share the coarse label).
  String get labelKey => switch (this) {
    PaperTemplate.plain => 'template_plain',
    PaperTemplate.ruled || PaperTemplate.ruledMargin => 'template_ruled',
    PaperTemplate.graph || PaperTemplate.graphFine => 'template_graph',
    PaperTemplate.dots || PaperTemplate.dotsFine => 'template_dots',
    PaperTemplate.isometric => 'template_isometric',
    PaperTemplate.hex => 'template_hex',
    PaperTemplate.cornell => 'template_cornell',
    PaperTemplate.music => 'template_music',
    PaperTemplate.checklist => 'template_checklist',
  };
  bool get isDots => this == PaperTemplate.dots || this == PaperTemplate.dotsFine;
}

/// Page sizes in "page points" (CSS px at 96dpi — same space the web app used).
class PaperSize {
  final String id, labelKey;
  final double w, h;
  const PaperSize(this.id, this.labelKey, this.w, this.h);
  Size get size => Size(w, h);
}

const kPaperSizes = [
  PaperSize('a4p', 'size_a4p', 794, 1123),
  PaperSize('a4l', 'size_a4l', 1123, 794),
  PaperSize('letter', 'size_letter', 816, 1056),
];

/// 16 ink colors (v1.9.1 palette).
const kInkPalette = [
  Color(0xFF16233A), Color(0xFF5A6B85), Color(0xFFE5484D), Color(0xFFF76B15),
  Color(0xFFF5A623), Color(0xFFFFD23F), Color(0xFF30A46C), Color(0xFF12A594),
  Color(0xFF0091FF), Color(0xFF1E6FF2), Color(0xFF6BA6FF), Color(0xFF8E4EC6),
  Color(0xFFD6409F), Color(0xFF7A5C3E), Color(0xFFC8CEDA), Color(0xFFFFFFFF),
];

/// 5 highlighter colors (drawn translucent, group-blended).
const kHighlighterPalette = [
  Color(0xFFFFE24D), Color(0xFF7EE787), Color(0xFF6FB7FF),
  Color(0xFFFF9ECF), Color(0xFFFFB86B),
];

/// Vector shape types (12) — same set as the web Shape Tool.
enum ShapeType {
  rect, ellipse, line, arrow, triangle, diamond,
  star5, polygon, cloud, callout, heart, cylinder,
}

const kShapeTypes = ShapeType.values;

extension ShapeTypeX on ShapeType {
  String get label => name[0].toUpperCase() + name.substring(1);
  bool get isLinear => this == ShapeType.line || this == ShapeType.arrow;
}
