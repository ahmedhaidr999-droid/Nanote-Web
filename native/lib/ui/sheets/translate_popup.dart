import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../controllers/settings_controller.dart';
import '../../controllers/stroke_engine.dart';
import '../../controllers/tool_controller.dart';
import '../../i18n/strings.dart';
import '../../models/page_elements.dart';
import '../../services/translate_service.dart';
import '../../theme/nanote_theme.dart';

/// Translate popup: type text (auto ar↔en detection), translate online with
/// offline dictionary fallback, then insert the result as a text element or
/// hand it off to Google Translate / an AI assistant.
class TranslateSheet extends StatefulWidget {
  final StrokeEngine engine;
  final ToolController tools;
  final SettingsController settings;

  const TranslateSheet({
    super.key,
    required this.engine,
    required this.tools,
    required this.settings,
  });

  @override
  State<TranslateSheet> createState() => _TranslateSheetState();
}

class _TranslateSheetState extends State<TranslateSheet> {
  final TextEditingController _input = TextEditingController();
  final TranslateService _svc = TranslateService();
  bool _loading = false;
  bool _failed = false;
  TranslateResult? _result;
  (String, String) _pair = ('en', 'ar');

  @override
  void initState() {
    super.initState();
    _pair = resolveLangPair('', widget.settings.s);
    _input.addListener(_onInput);
  }

  @override
  void dispose() {
    _input.removeListener(_onInput);
    _input.dispose();
    _svc.dispose();
    super.dispose();
  }

  void _onInput() {
    final text = _input.text;
    if (text.trim().isEmpty) return;
    final pair = resolveLangPair(text, widget.settings.s);
    if (pair == _pair) return;
    setState(() => _pair = pair);
  }

  Future<void> _translate() async {
    final text = _input.text.trim();
    if (text.isEmpty || _loading) return;
    final (source, target) = resolveLangPair(text, widget.settings.s);
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      final r = await _svc.translate(text, source, target);
      if (!mounted) return;
      setState(() {
        _result = r;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _failed = true;
      });
    }
  }

  void _insert() {
    final r = _result;
    if (r == null || r.text.trim().isEmpty) return;
    if (widget.engine.currentPageId == null) return;
    widget.engine.addElement(TextEl(
      id: 'e${DateTime.now().microsecondsSinceEpoch}',
      x: 60,
      y: 60,
      w: 300,
      h: 80,
      text: r.text,
      colorValue: 0xFF16233A,
      fontSize: 18,
    ));
    Navigator.of(context).pop();
  }

  Future<void> _launch(Uri uri) async {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  void _openGoogle() {
    final text = _input.text.trim();
    if (text.isEmpty) return;
    _launch(
        TranslateService.googleTranslateUrl(text, _pair.$1, _pair.$2));
  }

  void _askAi() {
    final text = _input.text.trim();
    if (text.isEmpty) return;
    _launch(TranslateService.askAiUrl(text));
  }

  @override
  Widget build(BuildContext context) {
    final colors = NanoteColors.of(context);
    final i18n = I18n.of(context);
    final result = _result;
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsetsDirectional.fromSTLB(20, 0, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              i18n.t('tool_translate'),
              style: TextStyle(
                color: colors.text,
                fontSize: 16,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _input,
              maxLines: 3,
              minLines: 1,
              decoration: InputDecoration(
                hintText: i18n.t('text_placeholder'),
              ),
            ),
            const SizedBox(height: 10),
            // auto language pair
            Row(children: [
              _langChip(colors, _pair.$1),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 6),
                child:
                    Icon(Icons.sync_alt_rounded, size: 14, color: colors.textMuted),
              ),
              _langChip(colors, _pair.$2),
            ]),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _loading ? null : _translate,
                icon: _loading
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.translate_rounded),
                label: Text(i18n.t(_loading ? 'translating' : 'translate')),
              ),
            ),
            if (result != null) ...[
              const SizedBox(height: 14),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: colors.surfaceAlt,
                  borderRadius: BorderRadius.circular(kNanoteRadius),
                  border: Border.all(color: colors.border),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SelectableText(
                      result.text,
                      style: TextStyle(
                        fontSize: 17,
                        height: 1.4,
                        fontWeight: FontWeight.w600,
                        color: colors.text,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      result.online
                          ? result.engine
                          : '${result.engine} — ${i18n.t('translate_offline')}',
                      style:
                          TextStyle(fontSize: 12, color: colors.textMuted),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton.tonalIcon(
                    onPressed: _insert,
                    icon: const Icon(Icons.post_add_rounded, size: 18),
                    label: Text(i18n.t('insert_translation')),
                  ),
                  OutlinedButton.icon(
                    onPressed: _openGoogle,
                    icon: const Icon(Icons.open_in_new_rounded, size: 18),
                    label: Text(i18n.t('open_google')),
                  ),
                  TextButton.icon(
                    onPressed: _askAi,
                    icon: const Icon(Icons.auto_awesome_rounded, size: 18),
                    label: Text(i18n.t('ask_ai')),
                  ),
                ],
              ),
            ],
            if (_failed) ...[
              const SizedBox(height: 12),
              Row(children: [
                Icon(Icons.error_outline_rounded,
                    size: 18, color: colors.danger),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    i18n.t('translate_failed'),
                    style: TextStyle(color: colors.danger),
                  ),
                ),
              ]),
            ],
          ],
        ),
      ),
    );
  }

  Widget _langChip(NanoteColors colors, String code) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
        decoration: BoxDecoration(
          color: colors.surfaceAlt,
          borderRadius: BorderRadius.circular(kNanoteRadius),
          border: Border.all(color: colors.border),
        ),
        child: Text(
          code.toUpperCase(),
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.5,
            color: colors.textMuted,
          ),
        ),
      );
}
