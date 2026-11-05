import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../i18n/strings.dart';
import '../../models/library_models.dart';
import '../../persistence/library_repository.dart';
import '../../theme/nanote_theme.dart';

/// Built-in emoji stickers (96) — study-oriented mix of marks, faces,
/// nature, food, fun and tech glyphs.
const List<String> _emojiStickers = [
  // study & marks
  '✅', '❌', '⭐', '🔥', '💡', '📌', '🎯', '📚', '✏️', '📝', '📎', '🗓️',
  '⏰', '🔔', '💰', '🏆', '🎓', '🧠', '📏', '📐', '✂️', '🗑️', '📊', '🔬',
  // faces
  '😀', '😂', '😍', '🤔', '😎', '🥳', '😅', '😴', '🤯', '😭', '😡', '🤗',
  '🤩', '😇', '😱', '😤',
  // gestures
  '👍', '👏', '🙏', '💪', '🤝', '✌️', '👋', '👌',
  // nature
  '🌙', '☀️', '🌈', '🍀', '🌸', '🌺', '🌵', '🌊', '🌟', '❄️',
  // animals
  '🐱', '🐶', '🐼', '🦊', '🐧', '🐤', '🦋', '🐢',
  // food
  '🍎', '🍕', '☕', '🍵', '🍰', '🍫', '🥕', '🍞',
  // fun & sport
  '🎵', '🎬', '⚽', '🏀', '🏓', '🎮', '🎲', '🎧', '🎤', '🎨',
  // tech & things
  '💻', '📱', '🔋', '🔌', '🧲', '🔑', '🔒', '🖊️',
  // symbols
  '💯', '⚠️', '♻️', '🔱',
];

/// Sticker picker sheet: emoji tab (built-in set) + "my stickers" tab
/// (imported PNGs). Long-press a PNG sticker to delete it.
class StickerPickerSheet extends StatefulWidget {
  final LibraryRepository repo;
  final void Function(String? emoji, StickerRow? sticker) onPick;

  const StickerPickerSheet({
    super.key,
    required this.repo,
    required this.onPick,
  });

  @override
  State<StickerPickerSheet> createState() => _StickerPickerSheetState();
}

class _StickerPickerSheetState extends State<StickerPickerSheet> {
  List<StickerRow> get _mineStickers =>
      widget.repo.stickers.where((s) => s.fileKey != null).toList();

  Future<void> _importPng() async {
    final res = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['png'],
      withData: true,
      allowMultiple: true,
    );
    for (final f in res?.files ?? const <PlatformFile>[]) {
      final bytes = f.bytes;
      if (bytes != null) await widget.repo.addPngSticker(bytes);
    }
    if (mounted) setState(() {});
  }

  Future<void> _confirmDelete(StickerRow sticker) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        final i18n = I18n.of(dialogContext);
        return AlertDialog(
          title: Text(i18n.t('delete')),
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
    await widget.repo.deleteSticker(sticker);
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final colors = NanoteColors.of(context);
    final i18n = I18n.of(context);
    final mine = _mineStickers;
    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.6,
      child: DefaultTabController(
        length: 2,
        child: Column(children: [
          TabBar(
            tabs: [
              Tab(text: i18n.t('stickers_emoji')),
              Tab(text: i18n.t('stickers_mine')),
            ],
          ),
          Padding(
            padding: const EdgeInsetsDirectional.fromSTEB(20, 10, 20, 6),
            child: Row(children: [
              Expanded(
                child: Align(
                  alignment: AlignmentDirectional.centerEnd,
                  child: OutlinedButton.icon(
                    onPressed: _importPng,
                    icon: const Icon(Icons.add_photo_alternate_outlined,
                        size: 20),
                    label: Text(i18n.t('add_sticker_png')),
                  ),
                ),
              ),
            ]),
          ),
          Expanded(
            child: TabBarView(children: [
              // ── emoji tab ──
              GridView.builder(
                padding: const EdgeInsetsDirectional.fromSTEB(12, 4, 12, 16),
                gridDelegate:
                    const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 8,
                  mainAxisSpacing: 4,
                  crossAxisSpacing: 4,
                ),
                itemCount: _emojiStickers.length,
                itemBuilder: (context, i) => InkWell(
                  borderRadius: BorderRadius.circular(kNanoteRadius),
                  onTap: () => widget.onPick(_emojiStickers[i], null),
                  child: Center(
                    child: Text(
                      _emojiStickers[i],
                      style: const TextStyle(fontSize: 26),
                    ),
                  ),
                ),
              ),
              // ── my stickers tab ──
              mine.isEmpty
                  ? Center(
                      child: Text(
                        i18n.t('empty'),
                        style: TextStyle(color: colors.textMuted),
                      ),
                    )
                  : GridView.builder(
                      padding:
                          const EdgeInsetsDirectional.fromSTEB(12, 4, 12, 16),
                      gridDelegate:
                          const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 4,
                        mainAxisSpacing: 8,
                        crossAxisSpacing: 8,
                      ),
                      itemCount: mine.length,
                      itemBuilder: (context, i) {
                        final sticker = mine[i];
                        final file = widget.repo.fs
                            .fileOf('stickers', sticker.fileKey!);
                        return InkWell(
                          borderRadius: BorderRadius.circular(kNanoteRadius),
                          onTap: () => widget.onPick(null, sticker),
                          onLongPress: () => _confirmDelete(sticker),
                          child: Container(
                            decoration: BoxDecoration(
                              color: colors.surfaceAlt,
                              borderRadius:
                                  BorderRadius.circular(kNanoteRadius),
                              border: Border.all(color: colors.border),
                            ),
                            padding: const EdgeInsets.all(6),
                            child: Image.file(
                              file,
                              fit: BoxFit.contain,
                              errorBuilder: (_, __, ___) =>
                                  Container(color: colors.surfaceAlt),
                            ),
                          ),
                        );
                      },
                    ),
            ]),
          ),
        ]),
      ),
    );
  }
}
