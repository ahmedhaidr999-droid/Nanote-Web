import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// Pan + zoom over the document space. Zoom settles are announced on a
/// separate listenable ([settleChanges]) 240ms after the gesture stops —
/// PDF tiles re-render to the new resolution only then.
class ViewportController extends ChangeNotifier {
  Offset _focalDoc = Offset.zero; // doc point shown at viewport center
  double _scale = 1;
  Size _viewportSize = Size.zero;

  static const minScale = 0.25, maxScale = 8;

  final ChangeNotifier settleChanges = ChangeNotifier();
  Timer? _settleTimer;

  double get scale => _scale;
  Offset get focalDoc => _focalDoc;
  Size get viewportSize => _viewportSize;
  bool get isSettled => _settleTimer == null;

  /// Screen-space transform: doc → screen.
  Offset docToScreen(Offset docPos) =>
      Offset((docPos.dx - _focalDoc.dx) * _scale + _viewportSize.width / 2,
          (docPos.dy - _focalDoc.dy) * _scale + _viewportSize.height / 2);

  Offset screenToDoc(Offset screenPos) =>
      Offset((screenPos.dx - _viewportSize.width / 2) / _scale + _focalDoc.dx,
          (screenPos.dy - _viewportSize.height / 2) / _scale + _focalDoc.dy);

  double docLengthToScreen(double l) => l * _scale;
  double screenLengthToDoc(double l) => l / _scale;

  void resize(Size size) {
    if (size == _viewportSize) return;
    _viewportSize = size;
    notifyListeners();
  }

  void panByScreen(Offset screenDelta) {
    _focalDoc -= screenDelta / _scale;
    _clamp();
    notifyListeners();
  }

  /// Zoom keeping [focalScreen] anchored.
  void zoomAt(Offset focalScreen, double factor) {
    final before = screenToDoc(focalScreen);
    var next = (_scale * factor).clamp(minScale, maxScale);
    final applied = next / _scale;
    if ((applied - 1).abs() < 1e-6) return;
    _scale = next;
    // keep `before` under the focal point:
    final after = Offset(
      (focalScreen.dx - _viewportSize.width / 2) / _scale + _focalDoc.dx,
      (focalScreen.dy - _viewportSize.height / 2) / _scale + _focalDoc.dy,
    );
    _focalDoc += before - after;
    _clamp();
    _settleTimer?.cancel();
    _settleTimer = Timer(const Duration(milliseconds: 240), () {
      _settleTimer = null;
      settleChanges.notifyListeners();
    });
    notifyListeners();
  }

  void fitWidth(double docWidth) {
    if (_viewportSize.width <= 0) return;
    _scale = (_viewportSize.width / docWidth).clamp(minScale, maxScale);
    notifyListeners();
    settleChanges.notifyListeners();
  }

  void centerOn(Offset docPos, [double? newScale]) {
    _focalDoc = docPos;
    if (newScale != null) {
      _scale = newScale.clamp(minScale, maxScale);
    }
    _clamp();
    notifyListeners();
  }

  void _clamp() {
    // Keep a sane margin so the document never fully leaves the screen.
    // (Free panning is allowed — infinite canvas feel — but the focal point
    // is bounded to doc extents ± 2 screens.)
    // Bounding is handled by the workspace via docBoundsFor().
  }

  Rect visibleDocRect() {
    final tl = screenToDoc(Offset.zero);
    final br = screenToDoc(
        Offset(_viewportSize.width, _viewportSize.height));
    return Rect.fromPoints(tl, br);
  }

  @override
  void dispose() {
    _settleTimer?.cancel();
    settleChanges.dispose();
    super.dispose();
  }
}
