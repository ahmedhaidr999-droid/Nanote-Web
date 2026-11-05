import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../models/paper.dart';
import '../models/settings.dart';
import '../models/stroke.dart';
import '../models/tool.dart';

/// Host callbacks for shortcut actions the workspace owns (undo, ruler…).
abstract class ToolActionHost {
  void undoAction();
  void redoAction();
  void toggleRulerAction();
  void selectAllAction();
  void clearSelectionAction();
  void newPageAction();
}

/// All per-tool UI state: active tool, per-tool color/size memory, shape
/// config, laser config, text defaults. Also resolves pen shortcuts.
class ToolController extends ChangeNotifier {
  Tool tool = Tool.pen;

  // pen
  PenKind penKind = PenKind.pen;
  int penColorIdx = 0;
  double penSize = 2.6;
  // highlighter
  int hlColorIdx = 0;
  double hlSize = 18;
  // eraser
  bool areaEraser = false;
  double eraserRadius = 14;
  // shape
  ShapeType shape = ShapeType.rect;
  bool shapeFilled = false;
  int shapeStrokeIdx = 9; // default blue
  int shapeFillIdx = 5;
  double shapeStrokeWidth = 2.5;
  // laser
  int laserColorIdx = 0;
  double laserWidth = 5;
  // text
  double fontSize = 18;
  int textColorIdx = 0;
  bool textBold = false;

  static const penSizes = [1.4, 2.0, 2.6, 3.5, 5.0, 8.0];
  static const hlSizes = [12.0, 18.0, 26.0, 36.0];

  // per-pen-kind memory of color+size (switching kinds restores state)
  final Map<PenKind, (int, double)> _penMemory = {};

  void setTool(Tool t) {
    if (tool == t) return;
    // remember pen state when leaving
    if (tool == Tool.pen) {
      _penMemory[penKind] = (penColorIdx, penSize);
    }
    tool = t;
    notifyListeners();
  }

  void setPenKind(PenKind k) {
    if (penKind != k) {
      _penMemory[penKind] = (penColorIdx, penSize);
    }
    penKind = k;
    final m = _penMemory[k];
    if (m != null) {
      penColorIdx = m.$1;
      penSize = m.$2;
    }
    setTool(Tool.pen);
    notifyListeners();
  }

  bool get isHighlighterTool => tool == Tool.highlighter;

  // ── resolved stroke descriptor for the current ink tool ──

  Color get activeColor {
    if (tool == Tool.highlighter) {
      return kHighlighterPalette[hlColorIdx.clamp(0, kHighlighterPalette.length - 1)];
    }
    return kInkPalette[penColorIdx.clamp(0, kInkPalette.length - 1)];
  }

  int get activeColorValue => activeColor.toARGB32();

  double get activeSize =>
      tool == Tool.highlighter ? hlSize : penSize;

  PenKind get activePenKind =>
      tool == Tool.highlighter ? PenKind.highlighter : penKind;

  // ── cycling (barrel shortcut + taps) ──

  void cycleColor() {
    if (tool == Tool.highlighter) {
      hlColorIdx = (hlColorIdx + 1) % kHighlighterPalette.length;
    } else {
      penColorIdx = (penColorIdx + 1) % kInkPalette.length;
      _penMemory[penKind] = (penColorIdx, penSize);
    }
    notifyListeners();
  }

  void cycleSize() {
    if (tool == Tool.highlighter) {
      final i = hlSizes.indexOf(hlSize);
      hlSize = hlSizes[(i < 0 ? 0 : i + 1) % hlSizes.length];
    } else {
      final i = _nearestIdx(penSizes, penSize);
      penSize = penSizes[(i + 1) % penSizes.length];
      _penMemory[penKind] = (penColorIdx, penSize);
    }
    notifyListeners();
  }

  static int _nearestIdx(List<double> xs, double v) {
    var best = 0;
    for (var i = 0; i < xs.length; i++) {
      if ((xs[i] - v).abs() < (xs[best] - v).abs()) best = i;
    }
    return best;
  }

  // ── per-tool setters (popovers) ──

  void setPenColorIdx(int idx) {
    penColorIdx = idx;
    _penMemory[penKind] = (penColorIdx, penSize);
    notifyListeners();
  }

  void setPenSize(double v) {
    penSize = v;
    _penMemory[penKind] = (penColorIdx, penSize);
    notifyListeners();
  }

  void setHlColorIdx(int idx) {
    hlColorIdx = idx;
    notifyListeners();
  }

  void setHlSize(double v) {
    hlSize = v;
    notifyListeners();
  }

  void setShape(ShapeType s) {
    shape = s;
    setTool(Tool.shape);
    notifyListeners();
  }

  void setShapeFilled(bool f) {
    shapeFilled = f;
    notifyListeners();
  }

  void setShapeStrokeIdx(int i) {
    shapeStrokeIdx = i;
    notifyListeners();
  }

  void setShapeFillIdx(int i) {
    shapeFillIdx = i;
    notifyListeners();
  }

  void setShapeStrokeWidth(double v) {
    shapeStrokeWidth = v;
    notifyListeners();
  }

  Color get shapeStrokeColor =>
      kInkPalette[shapeStrokeIdx.clamp(0, kInkPalette.length - 1)];
  Color get shapeFillColor =>
      kInkPalette[shapeFillIdx.clamp(0, kInkPalette.length - 1)];
  Color get textColor =>
      kInkPalette[textColorIdx.clamp(0, kInkPalette.length - 1)];

  // ── shortcut dispatch ──

  /// Runs a pen-shortcut action. Returns true if it switched tools.
  bool applyAction(PenAction a, ToolActionHost host) {
    final t = a.tool;
    if (t != null) {
      setTool(t);
      return true;
    }
    switch (a) {
      case PenAction.undo: host.undoAction();
      case PenAction.redo: host.redoAction();
      case PenAction.toggleRuler: host.toggleRulerAction();
      case PenAction.selectAll: host.selectAllAction();
      case PenAction.clearSelection: host.clearSelectionAction();
      case PenAction.newPage: host.newPageAction();
      case PenAction.cycleColor: cycleColor();
      case PenAction.cycleSize: cycleSize();
      case PenAction.none: break;
      default: break;
    }
    return false;
  }

  /// Barrel-button bitmask → bound action (bit 1 = primary, bit 2+ = secondary).
  PenAction actionForButtons(int buttons, PenShortcuts sc) {
    if (buttons & 2 != 0) return sc.barrelPrimary;
    if (buttons & 4 != 0 || buttons & 8 != 0 || buttons & 16 != 0) {
      return sc.barrelSecondary;
    }
    return PenAction.none;
  }
}
