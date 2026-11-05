import 'package:flutter/material.dart';

import '../i18n/strings.dart';
import '../models/library_models.dart';
import '../theme/nanote_theme.dart';

/// Vertical page rail: numbered chips (PDF badge for pdf-backed pages),
/// tap to jump, "+" adds a page after the current one.
class Filmstrip extends StatelessWidget {
  final List<PageRow> pages;
  final int current;
  final void Function(int index) onSelect;
  final VoidCallback onAdd;

  const Filmstrip({
    super.key,
    required this.pages,
    required this.current,
    required this.onSelect,
    required this.onAdd,
  });

  @override
  Widget build(BuildContext context) {
    final colors = NanoteColors.of(context);
    final i18n = I18n.of(context);
    return Container(
      width: 56,
      decoration: BoxDecoration(
        color: colors.surface,
        border: BorderDirectional(
          end: BorderSide(color: colors.border),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Column(children: [
          Expanded(
            child: ListView.builder(
              itemCount: pages.length,
              padding: const EdgeInsets.symmetric(vertical: 8),
              itemBuilder: (context, i) {
                final p = pages[i];
                final sel = i == current;
                return Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(10),
                    onTap: () => onSelect(i),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 120),
                      height: 44,
                      decoration: BoxDecoration(
                        color: sel ? colors.primary : colors.surfaceAlt,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            i18n.num(i + 1),
                            style: Theme.of(context)
                                .textTheme
                                .labelMedium
                                ?.copyWith(
                                  color: sel
                                      ? colors.primaryFg
                                      : colors.text,
                                  fontWeight: FontWeight.w700,
                                ),
                          ),
                          if (p.isPdf)
                            Icon(Icons.picture_as_pdf_rounded,
                                size: 11,
                                color: sel
                                    ? colors.primaryFg
                                    : colors.textMuted),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(8),
            child: IconButton.filledTonal(
              tooltip: i18n.t('add_page'),
              onPressed: onAdd,
              icon: const Icon(Icons.add_rounded),
            ),
          ),
        ]),
      ),
    );
  }
}
