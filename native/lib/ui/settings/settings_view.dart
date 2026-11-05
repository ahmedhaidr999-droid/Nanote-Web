import 'package:flutter/material.dart';

import '../../controllers/settings_controller.dart';
import '../../i18n/strings.dart';
import '../../models/settings.dart';
import '../../services/backup_service.dart';
import '../../theme/nanote_theme.dart';

/// App settings: appearance (language / theme mode / left-handed), stylus
/// behavior, pen-shortcut mapping, backup & restore, and about info.
///
/// All mutations go through [_set] — [AppSettings] fields are mutable, so
/// the live object is edited in place and pushed through the controller,
/// which persists the JSON and rebuilds the whole app (theme/locale).
class SettingsView extends StatelessWidget {
  final SettingsController settings;
  final BackupService backup;

  const SettingsView({super.key, required this.settings, required this.backup});

  /// Mutate-and-persist: edit the live [AppSettings], then hand it to the
  /// controller (JSON flush + notifyListeners).
  void _set(void Function(AppSettings s) mut) {
    final s = settings.s;
    mut(s);
    settings.update(s);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(I18n.of(context).t('settings'))),
      body: AnimatedBuilder(
        animation: settings,
        builder: (context, _) => _buildSections(context),
      ),
    );
  }

  Widget _buildSections(BuildContext context) {
    final c = NanoteColors.of(context);
    final i18n = I18n.of(context);
    final s = settings.s;

    return ListView(
      padding: const EdgeInsetsDirectional.only(bottom: 24),
      children: [
        // ── appearance ───────────────────────────────────────────────
        _sectionHeader(context, i18n.t('sec_appearance')),
        _subLabel(context, i18n.t('sec_language')),
        RadioListTile<String>(
          value: 'ar',
          groupValue: s.language,
          title: Text(i18n.t('lang_ar')),
          onChanged: (v) {
            if (v != null) _set((x) => x.language = v);
          },
        ),
        RadioListTile<String>(
          value: 'en',
          groupValue: s.language,
          title: Text(i18n.t('lang_en')),
          onChanged: (v) {
            if (v != null) _set((x) => x.language = v);
          },
        ),
        // Theme mode — icon-only light option (no i18n key exists for it).
        Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(16, 6, 16, 6),
          child: SizedBox(
            width: double.infinity,
            child: SegmentedButton<String>(
              segments: [
                ButtonSegment(
                  value: 'system',
                  icon: const Icon(Icons.brightness_auto),
                  label: Text(i18n.t('system_theme')),
                ),
                const ButtonSegment(
                  value: 'light',
                  icon: Icon(Icons.light_mode),
                ),
                ButtonSegment(
                  value: 'dark',
                  icon: const Icon(Icons.dark_mode),
                  label: Text(i18n.t('dark_mode')),
                ),
              ],
              selected: {s.themeMode},
              onSelectionChanged: (sel) =>
                  _set((x) => x.themeMode = sel.first),
            ),
          ),
        ),
        SwitchListTile(
          value: s.leftHanded,
          title: Text(i18n.t('left_handed')),
          onChanged: (v) => _set((x) => x.leftHanded = v),
        ),
        _sectionDivider(c.border),

        // ── stylus ───────────────────────────────────────────────────
        _sectionHeader(context, i18n.t('sec_pen')),
        SwitchListTile(
          value: s.palmRejection,
          title: Text(i18n.t('palm_rejection')),
          onChanged: (v) => _set((x) => x.palmRejection = v),
        ),
        SwitchListTile(
          value: s.shapeRecognition,
          title: Text(i18n.t('shape_recognition')),
          onChanged: (v) => _set((x) => x.shapeRecognition = v),
        ),
        SwitchListTile(
          value: s.snapShapes,
          title: Text(i18n.t('snap')),
          onChanged: (v) => _set((x) => x.snapShapes = v),
        ),
        _shortcutTile(
          context,
          icon: Icons.smart_button,
          label: i18n.t('barrel_button'),
          current: s.pen.barrelPrimary,
          onPick: (v) {
            final p = settings.s.pen;
            settings.update(settings.s..pen = p.copyWith(barrelPrimary: v));
          },
        ),
        _shortcutTile(
          context,
          icon: Icons.smart_button_outlined,
          label: '${i18n.t('barrel_button')} ${i18n.num(2)}',
          current: s.pen.barrelSecondary,
          onPick: (v) {
            final p = settings.s.pen;
            settings.update(settings.s..pen = p.copyWith(barrelSecondary: v));
          },
        ),
        _shortcutTile(
          context,
          icon: Icons.touch_app,
          label: i18n.t('double_tap'),
          current: s.pen.doubleTap,
          onPick: (v) {
            final p = settings.s.pen;
            settings.update(settings.s..pen = p.copyWith(doubleTap: v));
          },
        ),
        _shortcutTile(
          context,
          icon: Icons.timer,
          label: i18n.t('press_hold'),
          current: s.pen.pressHold,
          onPick: (v) {
            final p = settings.s.pen;
            settings.update(settings.s..pen = p.copyWith(pressHold: v));
          },
        ),
        _shortcutTile(
          context,
          icon: Icons.ads_click,
          label: i18n.t('hover_button'),
          current: s.pen.hoverButton,
          onPick: (v) {
            final p = settings.s.pen;
            settings.update(settings.s..pen = p.copyWith(hoverButton: v));
          },
        ),
        _sectionDivider(c.border),

        // ── backup ───────────────────────────────────────────────────
        _sectionHeader(context, i18n.t('sec_backup')),
        _backupCreateTile(context),
        _backupRestoreTile(context),
        _sectionDivider(c.border),

        // ── about ────────────────────────────────────────────────────
        _sectionHeader(context, i18n.t('sec_about')),
        ListTile(
          leading: const Icon(Icons.info_outline),
          title: Text(i18n.t('version')),
          trailing: Text(
            '2.0.0',
            style: TextStyle(
              color: c.textMuted,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ],
    );
  }

  // ── small building blocks ─────────────────────────────────────────────

  Widget _sectionHeader(BuildContext context, String label) {
    final c = NanoteColors.of(context);
    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(20, 22, 20, 4),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.6,
          color: c.textMuted,
        ),
      ),
    );
  }

  Widget _subLabel(BuildContext context, String label) {
    final c = NanoteColors.of(context);
    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(20, 8, 20, 0),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w700,
          color: c.text,
        ),
      ),
    );
  }

  Widget _sectionDivider(Color color) => Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(20, 14, 20, 0),
        child: Container(height: 1, color: color),
      );

  // ── pen shortcuts ─────────────────────────────────────────────────────

  /// One stylus-trigger row: label on the start, current action + chevron
  /// on the end. Tapping opens a picker dialog over all [PenAction]s.
  Widget _shortcutTile(
    BuildContext context, {
    required IconData icon,
    required String label,
    required PenAction current,
    required void Function(PenAction v) onPick,
  }) {
    final c = NanoteColors.of(context);
    final i18n = I18n.of(context);
    return ListTile(
      leading: Icon(icon),
      title: Text(label),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(
            child: Text(
              i18n.t(current.labelKey),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: c.primary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(width: 2),
          Icon(Icons.expand_more, size: 20, color: c.textMuted),
        ],
      ),
      onTap: () => _pickPenAction(context, label, current, onPick),
    );
  }

  /// Scrollable dialog listing every [PenAction]; the current one is
  /// check-marked. Returns the picked action through [onPick].
  Future<void> _pickPenAction(
    BuildContext context,
    String title,
    PenAction current,
    void Function(PenAction v) onPick,
  ) async {
    final i18n = I18n.of(context);
    final picked = await showDialog<PenAction>(
      context: context,
      builder: (dialogContext) => SimpleDialog(
        title: Text(title),
        children: [
          for (final a in PenAction.values)
            SimpleDialogOption(
              onPressed: () => Navigator.of(dialogContext).pop(a),
              child: Row(
                children: [
                  SizedBox(
                    width: 24,
                    child: a == current
                        ? Icon(
                            Icons.check,
                            size: 20,
                            color: NanoteColors.of(dialogContext).primary,
                          )
                        : null,
                  ),
                  const SizedBox(width: 10),
                  Expanded(child: Text(i18n.t(a.labelKey))),
                ],
              ),
            ),
        ],
      ),
    );
    if (picked != null) onPick(picked);
  }

  // ── backup ────────────────────────────────────────────────────────────

  /// "Create backup": runs [BackupService.createAndShare] with a spinner
  /// while working, then confirms via snackbar.
  Widget _backupCreateTile(BuildContext context) {
    final i18n = I18n.of(context);
    var busy = false;
    return StatefulBuilder(
      builder: (context, setState) => ListTile(
        leading: const Icon(Icons.ios_share),
        title: Text(i18n.t('backup_create')),
        trailing: busy
            ? const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2.2),
              )
            : null,
        enabled: !busy,
        onTap: busy
            ? null
            : () async {
                setState(() => busy = true);
                try {
                  await backup.createAndShare();
                  if (!context.mounted) return;
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(i18n.t('backup_done'))),
                  );
                } catch (e) {
                  // Sharing was cancelled or failed — nothing to report.
                  debugPrint('Nanote backup share failed: $e');
                } finally {
                  if (context.mounted) setState(() => busy = false);
                }
              },
      ),
    );
  }

  /// "Restore backup": picks a `.nanote` file and replaces all local
  /// content. On success the user is told to restart so the restored
  /// library is loaded fresh from disk.
  Widget _backupRestoreTile(BuildContext context) {
    final i18n = I18n.of(context);
    return ListTile(
      leading: const Icon(Icons.settings_backup_restore),
      title: Text(i18n.t('backup_restore')),
      onTap: () async {
        final ok = await backup.pickAndRestore();
        if (!context.mounted) return;
        if (ok) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(i18n.t('restore_done'))),
          );
          await showDialog<void>(
            context: context,
            builder: (dialogContext) => AlertDialog(
              title: Text(i18n.t('restore_done')),
              content: Text(
                i18n.isAr
                    ? 'يجب إعادة تشغيل التطبيق حتى تُحمَّل المكتبة المستعادة بالكامل.'
                    : 'Please restart the app to load the restored library.',
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  child: Text(i18n.t('ok')),
                ),
              ],
            ),
          );
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(i18n.t('restore_failed'))),
          );
        }
      },
    );
  }
}
