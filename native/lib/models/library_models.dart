import 'paper.dart';

/// Library rows — plain JSON-serializable value objects.
/// IDs are time-based unique strings (millis + counter).

enum LibrarySort { updated, created, title }
enum LibraryViewMode { grid, list }

class NotebookRow {
  String id, title;
  String? parentId; // folder id or null
  int coverIdx, colorIdx;
  bool favorite;
  DateTime createdAt, updatedAt, lastOpenedAt;
  DateTime? trashedAt;
  int sortIndex;
  NotebookRow({
    required this.id, required this.title, this.parentId,
    this.coverIdx = 0, this.colorIdx = 0, this.favorite = false,
    required this.createdAt, required this.updatedAt,
    required this.lastOpenedAt, this.trashedAt, this.sortIndex = 0,
  });

  bool get trashed => trashedAt != null;

  Map<String, dynamic> toJson() => {
    'id': id, 'title': title, if (parentId != null) 'p': parentId,
    'cv': coverIdx, 'ci': colorIdx, 'fav': favorite,
    'ca': createdAt.millisecondsSinceEpoch,
    'ua': updatedAt.millisecondsSinceEpoch,
    'lo': lastOpenedAt.millisecondsSinceEpoch,
    if (trashedAt != null) 'tr': trashedAt!.millisecondsSinceEpoch,
    'si': sortIndex,
  };

  factory NotebookRow.fromJson(Map<String, dynamic> j) => NotebookRow(
    id: j['id'], title: j['title'] ?? '', parentId: j['p'],
    coverIdx: (j['cv'] as num?)?.toInt() ?? 0,
    colorIdx: (j['ci'] as num?)?.toInt() ?? 0,
    favorite: j['fav'] == true,
    createdAt: DateTime.fromMillisecondsSinceEpoch((j['ca'] as num?)?.toInt() ?? 0),
    updatedAt: DateTime.fromMillisecondsSinceEpoch((j['ua'] as num?)?.toInt() ?? 0),
    lastOpenedAt: DateTime.fromMillisecondsSinceEpoch((j['lo'] as num?)?.toInt() ?? 0),
    trashedAt: j['tr'] == null ? null
        : DateTime.fromMillisecondsSinceEpoch((j['tr'] as num).toInt()),
    sortIndex: (j['si'] as num?)?.toInt() ?? 0,
  );
}

class FolderRow {
  String id, name;
  String? parentId;
  DateTime createdAt;
  DateTime? trashedAt;
  int sortIndex;
  FolderRow({
    required this.id, required this.name, this.parentId,
    required this.createdAt, this.trashedAt, this.sortIndex = 0,
  });

  Map<String, dynamic> toJson() => {
    'id': id, 'name': name, if (parentId != null) 'p': parentId,
    'ca': createdAt.millisecondsSinceEpoch,
    if (trashedAt != null) 'tr': trashedAt!.millisecondsSinceEpoch,
    'si': sortIndex,
  };

  factory FolderRow.fromJson(Map<String, dynamic> j) => FolderRow(
    id: j['id'], name: j['name'] ?? '', parentId: j['p'],
    createdAt: DateTime.fromMillisecondsSinceEpoch((j['ca'] as num?)?.toInt() ?? 0),
    trashedAt: j['tr'] == null ? null
        : DateTime.fromMillisecondsSinceEpoch((j['tr'] as num).toInt()),
    sortIndex: (j['si'] as num?)?.toInt() ?? 0,
  );
}

/// One page of a notebook. `id` doubles as the ink slot key — pages keep
/// their ink when reordered because ink lives under `pages/<id>.json`.
class PageRow {
  String id, notebookId;
  int sortIndex;
  PaperTemplate template;
  int sizeIdx;
  String? pdfFileId; // PDF-backed page?
  int? pdfIndex;
  DateTime createdAt, updatedAt;
  PageRow({
    required this.id, required this.notebookId, this.sortIndex = 0,
    this.template = PaperTemplate.ruled, this.sizeIdx = 0,
    this.pdfFileId, this.pdfIndex,
    required this.createdAt, required this.updatedAt,
  });

  bool get isPdf => pdfFileId != null;

  Map<String, dynamic> toJson() => {
    'id': id, 'nb': notebookId, 'si': sortIndex,
    'tpl': template.name, 'sz': sizeIdx,
    if (pdfFileId != null) 'pf': pdfFileId,
    if (pdfIndex != null) 'pi': pdfIndex,
    'ca': createdAt.millisecondsSinceEpoch,
    'ua': updatedAt.millisecondsSinceEpoch,
  };

  factory PageRow.fromJson(Map<String, dynamic> j) => PageRow(
    id: j['id'], notebookId: j['nb'],
    sortIndex: (j['si'] as num?)?.toInt() ?? 0,
    template: PaperTemplate.values.firstWhere(
        (t) => t.name == j['tpl'], orElse: () => PaperTemplate.ruled),
    sizeIdx: (j['sz'] as num?)?.toInt() ?? 0,
    pdfFileId: j['pf'] as String?, pdfIndex: (j['pi'] as num?)?.toInt(),
    createdAt: DateTime.fromMillisecondsSinceEpoch((j['ca'] as num?)?.toInt() ?? 0),
    updatedAt: DateTime.fromMillisecondsSinceEpoch((j['ua'] as num?)?.toInt() ?? 0),
  );
}

class PdfFileRow {
  String id, name;
  int pageCount, sizeBytes;
  DateTime addedAt;
  PdfFileRow({
    required this.id, required this.name,
    required this.pageCount, required this.sizeBytes, required this.addedAt,
  });

  Map<String, dynamic> toJson() => {
    'id': id, 'name': name, 'n': pageCount, 'b': sizeBytes,
    'ca': addedAt.millisecondsSinceEpoch,
  };

  factory PdfFileRow.fromJson(Map<String, dynamic> j) => PdfFileRow(
    id: j['id'], name: j['name'] ?? 'PDF',
    pageCount: (j['n'] as num?)?.toInt() ?? 0,
    sizeBytes: (j['b'] as num?)?.toInt() ?? 0,
    addedAt: DateTime.fromMillisecondsSinceEpoch((j['ca'] as num?)?.toInt() ?? 0),
  );
}

class StickerRow {
  String id;
  String? fileKey; // user PNG in store
  String? emoji;    // built-in emoji sticker
  DateTime addedAt;
  StickerRow({required this.id, this.fileKey, this.emoji, required this.addedAt});

  Map<String, dynamic> toJson() => {
    'id': id,
    if (fileKey != null) 'fk': fileKey,
    if (emoji != null) 'e': emoji,
    'ca': addedAt.millisecondsSinceEpoch,
  };

  factory StickerRow.fromJson(Map<String, dynamic> j) => StickerRow(
    id: j['id'], fileKey: j['fk'] as String?, emoji: j['e'] as String?,
    addedAt: DateTime.fromMillisecondsSinceEpoch((j['ca'] as num?)?.toInt() ?? 0),
  );
}

class RecordingRow {
  String id, pageId, fileKey;
  int durationMs;
  String title;
  DateTime createdAt;
  DateTime? trashedAt;
  RecordingRow({
    required this.id, required this.pageId, required this.fileKey,
    required this.durationMs, this.title = '',
    required this.createdAt, this.trashedAt,
  });

  Map<String, dynamic> toJson() => {
    'id': id, 'pg': pageId, 'fk': fileKey, 'ms': durationMs, 't': title,
    'ca': createdAt.millisecondsSinceEpoch,
    if (trashedAt != null) 'tr': trashedAt!.millisecondsSinceEpoch,
  };

  factory RecordingRow.fromJson(Map<String, dynamic> j) => RecordingRow(
    id: j['id'], pageId: j['pg'], fileKey: j['fk'],
    durationMs: (j['ms'] as num?)?.toInt() ?? 0,
    title: j['t'] ?? '',
    createdAt: DateTime.fromMillisecondsSinceEpoch((j['ca'] as num?)?.toInt() ?? 0),
    trashedAt: j['tr'] == null ? null
        : DateTime.fromMillisecondsSinceEpoch((j['tr'] as num).toInt()),
  );
}

/// Immutable snapshot the library UI renders.
class LibrarySnapshot {
  final List<NotebookRow> notebooks; // visible (search + sort applied)
  final List<FolderRow> folders;
  final List<NotebookRow> favorites;
  final List<NotebookRow> trashNotebooks;
  final Map<String, int> pageCountByNotebook; // visible pages only
  final Map<String, DateTime> notebookLastActivity;
  final int totalNotebooks;
  final String query;
  final LibrarySort sort;
  final bool sortAsc;

  const LibrarySnapshot({
    this.notebooks = const [], this.folders = const [],
    this.favorites = const [], this.trashNotebooks = const [],
    this.pageCountByNotebook = const {},
    this.notebookLastActivity = const {},
    this.totalNotebooks = 0, this.query = '',
    this.sort = LibrarySort.updated, this.sortAsc = false,
  });

  static const empty = LibrarySnapshot();
}
