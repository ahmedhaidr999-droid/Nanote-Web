import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import '../controllers/stroke_engine.dart';
import '../controllers/tool_controller.dart';
import '../controllers/viewport_controller.dart';
import '../models/tool.dart';
import 'doc_geometry.dart';

enum _InputMode { idle, ink, gesture }

/// موجّه كل أحداث المؤشرات الخام — بلا GestureArena إطلاقاً، لذا السلوك
/// حتمي 100% على الجوال والديسكتوب والويب:
///
///   قلم Stylus / Apple Pencil → يرسم دائماً (أو يمسح في وضع الممحاة)
///   القلم المقلوب             → ممحاة تلقائياً (زر Apple Pencil الخلفي)
///   إصبع واحد                 → يرسم إذا كان "الرسم بالإصبع" مفعّلاً، وإلا يمرّر
///   إصبعان                    → تكبير + تحريك (دائماً، بلا ترحيل للخطوط)
///   إصبع ثانٍ أثناء رسم إصبع   → إلغاء الخط وتحويل الحركة إلى بنش فوري
///   لمس أثناء كتابة القلم      → يُتجاهل كلياً (Palm Rejection حقيقي)
///   عجلة ماوس / Trackpad       → تكبير + تحريك
class GestureRouter {
  GestureRouter({
    required this.viewport,
    required this.engine,
    required this.tools,
    required this.geometry,
  });

  final ViewportController viewport;
  final StrokeEngine engine;
  final ToolController tools;
  final ValueGetter<DocGeometry> geometry;

  /// pointerId → موضع محلي بفضاء الشاشة.
  final Map<int, Offset> _pointers = {};
  final Set<int> _gesturePointers = {};

  /// لمسات "راحة اليد" المتجاهَلة أثناء الكتابة بالقلم.
  final Set<int> _palmPointers = {};

  _InputMode _mode = _InputMode.idle;
  int? _inkPointer;
  int? _inkPage;
  PointerDeviceKind? _inkKind;
  bool _erasing = false;

  Offset? _gAnchor;
  double? _gDist;
  int _prevGestureCount = 0;
  double _trackpadScale = 1;

  // ─────────────────────── توجيه الأحداث ───────────────────────

  void onDown(PointerDownEvent e) {
    _pointers[e.pointer] = e.localPosition;

    switch (_mode) {
      case _InputMode.idle:
        final tool = _effectiveTool(e);
        if (_wantsInk(e, tool)) {
          _beginInk(e, tool);
        } else {
          _mode = _InputMode.gesture;
          _gesturePointers.add(e.pointer);
          _updateGesture();
        }

      case _InputMode.ink:
        // Palm Rejection: أي إصبع أثناء الكتابة بالقلم يُتجاهل كلياً —
        // لا يتحول إلى تحريك (ما يسبب قفزات الشاشة في التطبيقات الأخرى).
        if (e.kind == PointerDeviceKind.touch &&
            _inkKind != PointerDeviceKind.touch) {
          _palmPointers.add(e.pointer);
          return;
        }
        // مؤشر ثانٍ انضم أثناء الرسم → أوقف الحبر وحوّل الحركة إلى بنش.
        final previousInk = _inkPointer;
        _endInk(commit: false);
        _mode = _InputMode.gesture;
        if (previousInk != null) _gesturePointers.add(previousInk);
        _gesturePointers.add(e.pointer);
        _updateGesture();

      case _InputMode.gesture:
        _gesturePointers.add(e.pointer);
        _updateGesture();
    }
  }

  void onMove(PointerMoveEvent e) {
    _pointers[e.pointer] = e.localPosition;

    if (_mode == _InputMode.ink && e.pointer == _inkPointer) {
      _extendInk(e);
    } else if (_mode == _InputMode.gesture &&
        _gesturePointers.contains(e.pointer)) {
      _updateGesture();
    }
  }

  void onUp(PointerUpEvent e) => _finish(e.pointer, commit: true);

  void onCancel(PointerCancelEvent e) => _finish(e.pointer, commit: false);

  void _finish(int pointerId, {required bool commit}) {
    _pointers.remove(pointerId);
    _palmPointers.remove(pointerId);

    if (_mode == _InputMode.ink && pointerId == _inkPointer) {
      _endInk(commit: commit);
      final rest =
          _pointers.keys.where((k) => !_palmPointers.contains(k)).toList();
      if (rest.isEmpty) {
        _mode = _InputMode.idle;
        _resetGesture();
      } else {
        // مؤشر حقيقي آخر ما زال مضغوطاً → تكمل الحركة كإيماءة سلسة.
        _mode = _InputMode.gesture;
        _gesturePointers.addAll(rest);
        _prevGestureCount = 0;
        _updateGesture();
      }
    } else if (_mode == _InputMode.gesture) {
      _gesturePointers.remove(pointerId);
      if (_gesturePointers.isEmpty) {
        _mode = _InputMode.idle;
        _resetGesture();
      } else {
        _updateGesture();
      }
    }
  }

  void _endInk({required bool commit}) {
    if (_erasing) {
      engine.closeEraseGroup();
      engine.clearEraserCursor();
    } else if (commit) {
      engine.commitStroke();
    } else {
      engine.cancelStroke();
    }
    _inkPointer = null;
    _inkPage = null;
    _inkKind = null;
    _erasing = false;
  }

  // ─────────── حساب الإيماءة: إصبعان = بنش، إصبع = تمرير ───────────
  // تحويل تزايدي: النقطة تحت منتصف الإصبعين تبقى تحتهما بالضبط،
  // وتنتقل بسلاسة إلى تمرير بإصبع واحد عند رفع الإصبع الثاني.

  void _updateGesture() {
    final pts = <Offset>[
      for (final id in _gesturePointers)
        if (_pointers[id] != null) _pointers[id]!,
    ];
    final count = pts.length;
    if (count == 0) return;

    if (count == 1) {
      final p = pts.first;
      if (_prevGestureCount == 1 && _gAnchor != null) {
        viewport.panBy(p - _gAnchor!);
      }
      _gAnchor = p;
      _gDist = null;
    } else {
      final dist = (pts[0] - pts[1]).distance;
      final mid = (pts[0] + pts[1]) / 2;
      if (_prevGestureCount >= 2 && _gDist != null && _gDist! > 1) {
        viewport.zoomBy(dist / _gDist!, mid);
        viewport.panBy(mid - _gAnchor!);
      }
      _gAnchor = mid;
      _gDist = dist;
    }
    _prevGestureCount = count;
  }

  void _resetGesture() {
    _gesturePointers.clear();
    _gAnchor = null;
    _gDist = null;
    _prevGestureCount = 0;
  }

  // ───────── Trackpad + عجلة الماوس (ويب/ديسكتوب) ─────────

  void onPanZoomStart(PointerPanZoomStartEvent e) => _trackpadScale = 1;

  void onPanZoomUpdate(PointerPanZoomUpdateEvent e) {
    viewport.panBy(e.panDelta);
    if (e.scale > 0 && (e.scale - _trackpadScale).abs() > 1e-6) {
      viewport.zoomBy(e.scale / _trackpadScale, e.localPosition);
      _trackpadScale = e.scale;
    }
  }

  void onPanZoomEnd(PointerPanZoomEndEvent e) => _trackpadScale = 1;

  void onSignal(PointerSignalEvent e) {
    if (e is PointerScrollEvent) {
      viewport.zoomBy(math.exp(-e.scrollDelta.dy * 0.0012), e.localPosition);
    }
  }

  // ─────────────────── منطق الرسم والمسح ───────────────────

  Tool _effectiveTool(PointerEvent e) =>
      e.kind == PointerDeviceKind.invertedStylus ? Tool.eraser : tools.tool;

  bool _wantsInk(PointerEvent e, Tool tool) {
    switch (tool) {
      case Tool.hand:
        return false;
      case Tool.eraser:
        return true; // الممحاة تعمل بأي مؤشر
      case Tool.pen:
      case Tool.highlighter:
        return switch (e.kind) {
          PointerDeviceKind.stylus || PointerDeviceKind.invertedStylus => true,
          PointerDeviceKind.mouse => (e.buttons & kPrimaryButton) != 0,
          PointerDeviceKind.touch => tools.fingerDrawEnabled,
          _ => false,
        };
    }
  }

  void _beginInk(PointerDownEvent e, Tool tool) {
    final g = geometry();
    if (g.pageCount == 0) return;

    final page = g.pageAt(viewport.toDoc(e.localPosition));
    if (page < 0) {
      // اللمس وقع على الفجوة/الخلفية → تمرير بدلاً من الرسم
      _mode = _InputMode.gesture;
      _gesturePointers.add(e.pointer);
      _updateGesture();
      return;
    }

    _mode = _InputMode.ink;
    _inkPointer = e.pointer;
    _inkPage = page;
    _inkKind = e.kind;
    _erasing = tool == Tool.eraser;

    final p = _pointAt(g, page, e.localPosition);

    if (_erasing) {
      engine.openEraseGroup();
      _erase(page, p);
    } else {
      engine.beginStroke(
        page,
        tools.activeStyle(
          simulatedPressure: e.kind != PointerDeviceKind.stylus,
        ),
        p,
        _pressure(e),
      );
    }
  }

  void _extendInk(PointerMoveEvent e) {
    final page = _inkPage;
    if (page == null) return;
    final g = geometry();
    final p = _pointAt(g, page, e.localPosition);
    if (_erasing) {
      _erase(page, p);
    } else {
      engine.extendStroke(p, _pressure(e));
    }
  }

  void _erase(int page, Offset pointPts) {
    final g = geometry();
    // نصف قطر الممحاة ثابت "بصرياً" على الشاشة → نحوّله لفضاء النقاط.
    final radiusPts =
        (tools.eraserSize / 2) / viewport.scale / g.pointScale(page);
    engine.eraseAt(page, pointPts, radiusPts);
    engine.setEraserCursor(page, pointPts, radiusPts);
  }

  /// شاشة → نقاط صفحة، مع تقييد داخل حدود الصفحة كي لا يضيع الحبر
  /// في الفواصل (الخط يلتصق بحافة الصفحة إذا خرج القلم عنها).
  Offset _pointAt(DocGeometry g, int page, Offset screenPos) {
    final docPos = viewport.toDoc(screenPos);
    final top = g.pageTop(page);
    final h = g.logical(page).height;
    final dx = docPos.dx.clamp(0.0, g.docWidth).toDouble();
    final dy = docPos.dy.clamp(top, top + h).toDouble();
    return g.docToPoints(page, Offset(dx, dy));
  }

  /// ضغط حقيقي لأقلام Stylus، وإلا قيمة محايدة (perfect_freehand يستخدم
  /// السرعة بدلاً منها عند تفعيل simulatePressure).
  double _pressure(PointerEvent e) =>
      e.kind == PointerDeviceKind.stylus && e.pressure > 0
          ? e.pressure.clamp(0.05, 1.0).toDouble()
          : 0.5;
}
