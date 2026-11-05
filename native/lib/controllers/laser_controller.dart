import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// Laser pointer with the two web modes:
///  • tail — each trail point fades out after [tailMs] (default 600ms)
///  • collective — the whole trail persists while held, then fades together
///   over [collectiveMs] after release.
class LaserController extends ChangeNotifier {
  final List<Offset> _docPoints = [];
  final List<int> _times = [];
  bool tailMode = true;
  int tailMs = 600, collectiveMs = 1400;
  bool _active = false;
  bool _fading = false;
  Timer? _tick;

  bool get isPainting => _docPoints.isNotEmpty;
  bool get active => _active;

  void begin(Offset docPos, {required bool tail}) {
    tailMode = tail;
    _active = true;
    _fading = false;
    _docPoints.clear();
    _times.clear();
    _docPoints.add(docPos);
    _times.add(nowMs);
    _startTick();
    notifyListeners();
  }

  void extend(Offset docPos) {
    if (!_active) return;
    final last = _docPoints.isEmpty ? null : _docPoints.last;
    if (last != null && (last - docPos).distance < 1.5) return;
    _docPoints.add(docPos);
    _times.add(nowMs);
    if (!tailMode) {
      notifyListeners();
    }
  }

  void end() {
    _active = false;
    _fading = !tailMode;
    if (tailMode) {
      _prune();
      if (_docPoints.isEmpty) _stopTick();
    }
    notifyListeners();
  }

  void clear() {
    _docPoints.clear();
    _times.clear();
    _fading = false;
    _stopTick();
    notifyListeners();
  }

  void _startTick() {
    _tick?.cancel();
    _tick = Timer.periodic(const Duration(milliseconds: 33), (_) => _onTick());
  }

  void _stopTick() {
    _tick?.cancel();
    _tick = null;
    notifyListeners();
  }

  void _onTick() {
    if (tailMode) {
      _prune();
      if (!_active && _docPoints.isEmpty) {
        _stopTick();
        return;
      }
    } else if (_fading) {
      final elapsed = nowMs - (_times.isEmpty ? nowMs : _times.last);
      if (elapsed > collectiveMs) {
        clear();
        return;
      }
    }
    notifyListeners();
  }

  void _prune() {
    final cutoff = nowMs - tailMs;
    while (_times.isNotEmpty && _times.first < cutoff) {
      _times.removeAt(0);
      _docPoints.removeAt(0);
    }
  }

  /// Renders (docPos, alpha) pairs for the painter — alpha already aged.
  List<(Offset, double)> render() {
    final t = nowMs;
    final out = <(Offset, double)>[];
    if (tailMode) {
      for (var i = 0; i < _docPoints.length; i++) {
        final age = (t - _times[i]) / tailMs;
        out.add((_docPoints[i], (1 - age).clamp(0.0, 1.0)));
      }
    } else {
      double a = 1.0;
      if (_fading && _times.isNotEmpty) {
        a = (1 - (t - _times.last) / collectiveMs).clamp(0.0, 1.0);
      }
      for (final p in _docPoints) {
        out.add((p, a));
      }
    }
    return out;
  }

  static int get nowMs => DateTime.now().millisecondsSinceEpoch;

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }
}
