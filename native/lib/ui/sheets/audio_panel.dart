import 'dart:async';

import 'package:flutter/material.dart';

import '../../controllers/audio_controller.dart';
import '../../i18n/strings.dart';
import '../../models/library_models.dart';
import '../../theme/nanote_theme.dart';

/// Audio notes panel for one page: record (with live waveform + elapsed
/// time), list the page's recordings with play/pause + delete, and toggle
/// ink-replay sync during playback.
class AudioPanelSheet extends StatefulWidget {
  final AudioController audio;
  final String pageId;

  const AudioPanelSheet({
    super.key,
    required this.audio,
    required this.pageId,
  });

  @override
  State<AudioPanelSheet> createState() => _AudioPanelSheetState();
}

class _AudioPanelSheetState extends State<AudioPanelSheet> {
  DateTime? _started; // recording start (audio exposes no elapsed getter)
  Timer? _tick;
  bool _pulse = false;

  @override
  void initState() {
    super.initState();
    if (widget.audio.isRecording) _startTicker();
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  void _startTicker() {
    _started ??= DateTime.now();
    _tick?.cancel();
    _tick = Timer.periodic(const Duration(milliseconds: 700), (_) {
      if (!mounted) return;
      setState(() => _pulse = !_pulse);
    });
  }

  void _stopTicker() {
    _tick?.cancel();
    _tick = null;
    _started = null;
    _pulse = false;
  }

  /// mm:ss
  String _fmt(int ms) =>
      '${(ms / 60000).floor()}:${((ms / 1000) % 60).floor().toString().padLeft(2, '0')}';

  int get _elapsedMs =>
      _started == null ? 0 : DateTime.now().difference(_started!).inMilliseconds;

  Future<void> _toggleRecord() async {
    final audio = widget.audio;
    if (audio.isRecording) {
      await audio.stopRecording();
      if (mounted) setState(() => _stopTicker());
    } else {
      final ok = await audio.startRecording(widget.pageId);
      if (!mounted) return;
      if (!ok) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(I18n.of(context).t('mic_permission'))),
        );
        return;
      }
      setState(() => _startTicker());
    }
  }

  Future<void> _confirmDelete(RecordingRow row) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        final i18n = I18n.of(dialogContext);
        return AlertDialog(
          title: Text(i18n.t('delete')),
          content:
              Text('${i18n.t('audio_note')} · ${_fmt(row.durationMs)}'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: Text(i18n.t('cancel')),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: Text(i18n.t('delete')),
            ),
          ],
        );
      },
    );
    if (ok != true) return;
    await widget.audio.deleteRecording(row);
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final colors = NanoteColors.of(context);
    final i18n = I18n.of(context);
    final audio = widget.audio;
    return SafeArea(
      top: false,
      child: SingleChildScrollView(
        padding: const EdgeInsetsDirectional.fromSTLB(20, 0, 20, 20),
        child: ListenableBuilder(
          listenable: audio,
          builder: (context, _) {
            final rows = audio.repo.recordingsOf(widget.pageId);
            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  i18n.t('tool_audio'),
                  style: TextStyle(
                    color: colors.text,
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 12),
                // ── record section ──
                Row(children: [
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 650),
                    decoration: BoxDecoration(
                      color: audio.isRecording
                          ? colors.danger
                              .withValues(alpha: _pulse ? 0.30 : 0.10)
                          : colors.surfaceAlt,
                      borderRadius:
                          BorderRadius.circular(kNanoteRadius + 4),
                    ),
                    padding: const EdgeInsets.all(4),
                    child: FilledButton.tonalIcon(
                      onPressed: _toggleRecord,
                      icon: Icon(
                        audio.isRecording
                            ? Icons.stop_rounded
                            : Icons.mic_rounded,
                        color: audio.isRecording ? colors.danger : null,
                      ),
                      label: Text(
                        i18n.t(audio.isRecording
                            ? 'record_stop'
                            : 'record_start'),
                      ),
                    ),
                  ),
                  if (audio.isRecording) ...[
                    const SizedBox(width: 14),
                    Text(
                      _fmt(_elapsedMs),
                      style: TextStyle(
                        color: colors.danger,
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ]),
                if (audio.isRecording) ...[
                  const SizedBox(height: 14),
                  _waveform(colors, audio),
                ],
                const SizedBox(height: 8),
                // ── ink replay sync ──
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(i18n.t('replay_ink')),
                  value: audio.replayInk,
                  onChanged: (v) => setState(() => audio.replayInk = v),
                ),
                // ── recordings list ──
                if (rows.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    child: Text(
                      i18n.t('empty'),
                      style: TextStyle(color: colors.textMuted),
                    ),
                  )
                else
                  for (final row in rows)
                    _recordingTile(context, colors, i18n, row),
              ],
            );
          },
        ),
      ),
    );
  }

  /// Row of ~40 thin bars from the live amplitude history (last 40 samples).
  Widget _waveform(NanoteColors colors, AudioController audio) {
    final bars = audio.waveBars.length > 40
        ? audio.waveBars.sublist(audio.waveBars.length - 40)
        : audio.waveBars;
    return SizedBox(
      height: 40,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          for (var i = 0; i < 40; i++)
            Expanded(
              child: Align(
                alignment: AlignmentDirectional.bottomCenter,
                child: Container(
                  width: 3,
                  margin: const EdgeInsets.symmetric(horizontal: 1),
                  height: i < bars.length
                      ? (4 + bars[i] * 32).clamp(4.0, 36.0)
                      : 4.0,
                  decoration: BoxDecoration(
                    color: colors.danger,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _recordingTile(
    BuildContext context,
    NanoteColors colors,
    I18n i18n,
    RecordingRow row,
  ) {
    final audio = widget.audio;
    final active = audio.playingRow?.id == row.id;
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Container(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: active ? colors.primarySoft : Colors.transparent,
        ),
        child: IconButton(
          onPressed: () => audio.togglePlay(row),
          icon: Icon(
            active && audio.isPlaying
                ? Icons.pause_rounded
                : Icons.play_arrow_rounded,
            color: active ? colors.primary : colors.text,
          ),
        ),
      ),
      title: Text(
        i18n.t('audio_note'),
        style: TextStyle(
          fontWeight: FontWeight.w600,
          color: active ? colors.primary : colors.text,
        ),
      ),
      subtitle: Text(
        _fmt(row.durationMs),
        style: TextStyle(color: colors.textMuted, fontSize: 12),
      ),
      trailing: IconButton(
        tooltip: i18n.t('delete'),
        icon: const Icon(Icons.delete_outline_rounded),
        color: colors.danger,
        onPressed: () => _confirmDelete(row),
      ),
    );
  }
}
