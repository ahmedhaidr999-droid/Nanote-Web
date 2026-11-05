import '../models/tool.dart';

/// Actions a pen shortcut can trigger (21).
enum PenAction {
  none, pen, highlighter, eraser, selector, laser, pan, shape, text,
  image, sticker, translate, audio, undo, redo, cycleColor, cycleSize,
  toggleRuler, selectAll, clearSelection, newPage,
}

extension PenActionX on PenAction {
  String get labelKey => switch (this) {
    PenAction.none => 'action_none',
    PenAction.pen || PenAction.highlighter || PenAction.eraser ||
    PenAction.selector || PenAction.laser || PenAction.pan ||
    PenAction.shape || PenAction.text => 'tool_${name}',
    PenAction.image || PenAction.sticker || PenAction.translate ||
    PenAction.audio => 'tool_${name}',
    PenAction.undo => 'undo',
    PenAction.redo => 'redo',
    PenAction.cycleColor => 'action_cycle_color',
    PenAction.cycleSize => 'action_cycle_size',
    PenAction.toggleRuler => 'action_toggle_ruler',
    PenAction.selectAll => 'select_all',
    PenAction.clearSelection => 'clear_selection',
    PenAction.newPage => 'add_page',
  };

  Tool? get tool => switch (this) {
    PenAction.pen => Tool.pen,
    PenAction.highlighter => Tool.highlighter,
    PenAction.eraser => Tool.eraser,
    PenAction.selector => Tool.selector,
    PenAction.laser => Tool.laser,
    PenAction.pan => Tool.pan,
    PenAction.shape => Tool.shape,
    PenAction.text => Tool.text,
    PenAction.image => Tool.image,
    PenAction.sticker => Tool.sticker,
    PenAction.translate => Tool.translate,
    PenAction.audio => Tool.audio,
    _ => null,
  };
}

/// Stylus trigger → action binding. Barrel buttons arrive as a bitmask on
/// pointer events (bit 1 = primary barrel, bit 2 = secondary on S-Pen etc.).
class PenShortcuts {
  final PenAction barrelPrimary;
  final PenAction barrelSecondary;
  final PenAction doubleTap;
  final PenAction pressHold;
  final PenAction hoverButton;
  const PenShortcuts({
    this.barrelPrimary = PenAction.eraser,
    this.barrelSecondary = PenAction.undo,
    this.doubleTap = PenAction.selector,
    this.pressHold = PenAction.laser,
    this.hoverButton = PenAction.none,
  });

  PenShortcuts copyWith({
    PenAction? barrelPrimary, PenAction? barrelSecondary,
    PenAction? doubleTap, PenAction? pressHold, PenAction? hoverButton,
  }) => PenShortcuts(
    barrelPrimary: barrelPrimary ?? this.barrelPrimary,
    barrelSecondary: barrelSecondary ?? this.barrelSecondary,
    doubleTap: doubleTap ?? this.doubleTap,
    pressHold: pressHold ?? this.pressHold,
    hoverButton: hoverButton ?? this.hoverButton,
  );

  Map<String, dynamic> toJson() => {
    'bp': barrelPrimary.name, 'bs': barrelSecondary.name,
    'dt': doubleTap.name, 'ph': pressHold.name, 'hb': hoverButton.name,
  };

  factory PenShortcuts.fromJson(Map<String, dynamic> j) {
    PenAction a(String k, PenAction d) => PenAction.values.firstWhere(
        (v) => v.name == j[k], orElse: () => d);
    return PenShortcuts(
      barrelPrimary: a('bp', PenAction.eraser),
      barrelSecondary: a('bs', PenAction.undo),
      doubleTap: a('dt', PenAction.selector),
      pressHold: a('ph', PenAction.laser),
      hoverButton: a('hb', PenAction.none),
    );
  }
}

class AppSettings {
  String language; // 'system' | 'ar' | 'en'
  String themeMode; // 'system' | 'light' | 'dark'
  bool leftHanded;
  bool palmRejection;
  bool shapeRecognition;
  bool snapShapes;
  bool laserTailMode; // true = fading tail, false = collective
  int laserColorIdx;
  double laserWidth;
  double exportScale; // 1..3
  PenShortcuts pen;

  AppSettings({
    this.language = 'ar',
    this.themeMode = 'system',
    this.leftHanded = false,
    this.palmRejection = true,
    this.shapeRecognition = true,
    this.snapShapes = true,
    this.laserTailMode = true,
    this.laserColorIdx = 0,
    this.laserWidth = 5,
    this.exportScale = 2,
    this.pen = const PenShortcuts(),
  });

  Map<String, dynamic> toJson() => {
    'lang': language, 'theme': themeMode,
    'left': leftHanded, 'palm': palmRejection,
    'shapeRec': shapeRecognition, 'snap': snapShapes,
    'laserTail': laserTailMode, 'laserColor': laserColorIdx,
    'laserWidth': laserWidth, 'exportScale': exportScale,
    'pen': pen.toJson(),
  };

  factory AppSettings.fromJson(Map<String, dynamic> j) => AppSettings(
    language: j['lang'] as String? ?? 'ar',
    themeMode: j['theme'] as String? ?? 'system',
    leftHanded: j['left'] == true,
    palmRejection: j['palm'] != false,
    shapeRecognition: j['shapeRec'] != false,
    snapShapes: j['snap'] != false,
    laserTailMode: j['laserTail'] != false,
    laserColorIdx: (j['laserColor'] as num?)?.toInt() ?? 0,
    laserWidth: (j['laserWidth'] as num?)?.toDouble() ?? 5,
    exportScale: (j['exportScale'] as num?)?.toDouble() ?? 2,
    pen: j['pen'] == null ? PenShortcuts()
        : PenShortcuts.fromJson(j['pen'] as Map<String, dynamic>),
  );
}
