import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:record/record.dart';

import '../models/library_models.dart';
import 'package:flutter/foundation.dart';

import '../persistence/file_store.dart';
import '../persistence/library_repository.dart';
import 'stroke_engine.dart';

/// Audio notes: record (aac) per page, playback, and ink-sync replay.
/// While recording, the stroke engine stamps new strokes with
/// tStart/tEnd offsets so the page can be replayed with the audio.
class AudioController extends ChangeNotifier {
  final LibraryRepository repo;
  final FileStore fs;
  final StrokeEngine engine;

  AudioController(this.repo, this.fs, this.engine);

  final _recorder = AudioRecorder();
  final _player = AudioPlayer();

  bool get isRecording => _recording;
  bool _recording = false;
  String? _recPageId, _recFileKey;
  DateTime? _recStart;
  double level = 0; // 0..1 waveform level for the UI
  final List<double> waveBars = []; // history for waveform display

  RecordingRow? playingRow;
  bool get isPlaying => playingRow != null && _playing;
  bool _playing = false;
  bool replayInk = true; // highlight strokes with the audio timeline

  StreamSubscription? _ampSub, _posSub, _doneSub;

  // ───────────────────────── recording ─────────────────────────

  Future<bool> startRecording(String pageId) async {
    if (_recording) return false;
    try {
      if (!await _recorder.hasPermission()) return false;
    } catch (_) {
      return false;
    }
    final key = '${DateTime.now().microsecondsSinceEpoch}.m4a';
    final path = fs.fileOf('recordings', key).path;
    await fs.fileOf('recordings', key).create(recursive: true);
    try {
      await _recorder.start(
        const RecordConfig(encoder: AudioEncoder.aacLc, numChannels: 1),
        path: path,
      );
    } catch (e) {
      debugPrint('Nanote record start failed: $e');
      return false;
    }
    _recording = true;
    _recPageId = pageId;
    _recFileKey = key;
    _recStart = DateTime.now();
    waveBars.clear();
    engine.beginRecordingSync();
    _ampSub?.cancel();
    _ampSub = _recorder
        .onAmplitudeChanged(const Duration(milliseconds: 100))
        .listen((amp) {
      // amp.current is dBFS (−60..0) → normalize to 0..1
      final v = ((amp.current + 50) / 50).clamp(0.0, 1.0);
      level = v;
      if (waveBars.length > 120) waveBars.removeAt(0);
      waveBars.add(v);
      notifyListeners();
    });
    notifyListeners();
    return true;
  }

  Future<RecordingRow?> stopRecording() async {
    if (!_recording) return null;
    final path = await _recorder.stop();
    _ampSub?.cancel();
    _recording = false;
    level = 0;
    final dur = _recStart == null
        ? 0 : DateTime.now().difference(_recStart!).inMilliseconds;
    engine.endRecordingSync();
    final pageId = _recPageId, key = _recFileKey;
    _recPageId = null;
    _recFileKey = null;
    notifyListeners();
    if (pageId == null || key == null || path == null || dur < 400) {
      // too short → discard
      await fs.deleteFile('recordings', key ?? '');
      return null;
    }
    final row = repo.addRecording(
        pageId: pageId, fileKey: key, durationMs: dur);
    return row;
  }

  bool get recordingActive => _recording;

  // ───────────────────────── playback ─────────────────────────

  Future<void> play(RecordingRow row) async {
    await stopPlayback();
    final f = fs.fileOf('recordings', row.fileKey);
    if (!f.existsSync()) return;
    playingRow = row;
    _playing = true;
    _posSub?.cancel();
    _posSub = _player.onPositionChanged.listen((pos) {
      if (replayInk) engine.setReplayCursor(pos.inMilliseconds);
      notifyListeners();
    });
    _doneSub?.cancel();
    _doneSub = _player.onPlayerComplete.listen((_) {
      _playing = false;
      playingRow = null;
      engine.setReplayCursor(null);
      notifyListeners();
    });
    await _player.play(DeviceFileSource(f.path));
    notifyListeners();
  }

  Future<void> togglePlay(RecordingRow row) async {
    if (playingRow?.id == row.id && _playing) {
      await _player.pause();
      _playing = false;
      engine.setReplayCursor(null);
    } else if (playingRow?.id == row.id && !_playing) {
      await _player.resume();
      _playing = true;
    } else {
      await play(row);
    }
    notifyListeners();
  }

  Future<void> stopPlayback() async {
    _posSub?.cancel();
    _doneSub?.cancel();
    await _player.stop();
    _playing = false;
    playingRow = null;
    engine.setReplayCursor(null);
    notifyListeners();
  }

  Future<void> deleteRecording(RecordingRow row) async {
    if (playingRow?.id == row.id) await stopPlayback();
    await repo.deleteRecording(row);
  }

  @override
  void dispose() {
    _ampSub?.cancel();
    _posSub?.cancel();
    _doneSub?.cancel();
    _recorder.dispose();
    _player.dispose();
    super.dispose();
  }
}
