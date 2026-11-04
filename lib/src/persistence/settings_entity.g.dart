// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'settings_entity.dart';

// **************************************************************************
// IsarCollectionGenerator
// **************************************************************************

// coverage:ignore-file
// ignore_for_file: duplicate_ignore, non_constant_identifier_names, constant_identifier_names, invalid_use_of_protected_member, unnecessary_cast, prefer_const_constructors, lines_longer_than_80_chars, require_trailing_commas, inference_failure_on_function_invocation, unnecessary_parenthesis, unnecessary_raw_strings, unnecessary_null_checks, join_return_with_assignment, prefer_final_locals, avoid_js_rounded_ints, avoid_positional_boolean_parameters, always_specify_types

extension GetSettingsEntityCollection on Isar {
  IsarCollection<SettingsEntity> get settingsEntitys => this.collection();
}

const SettingsEntitySchema = CollectionSchema(
  name: r'SettingsEntity',
  id: -7271317039764597112,
  properties: {
    r'defaultPageCount': PropertySchema(
      id: 0,
      name: r'defaultPageCount',
      type: IsarType.long,
    ),
    r'librarySort': PropertySchema(
      id: 1,
      name: r'librarySort',
      type: IsarType.long,
    ),
    r'libraryView': PropertySchema(
      id: 2,
      name: r'libraryView',
      type: IsarType.long,
    ),
    r'penColorValue': PropertySchema(
      id: 3,
      name: r'penColorValue',
      type: IsarType.long,
    ),
    r'penSize': PropertySchema(
      id: 4,
      name: r'penSize',
      type: IsarType.double,
    ),
    r'themeMode': PropertySchema(
      id: 5,
      name: r'themeMode',
      type: IsarType.long,
    )
  },
  estimateSize: _settingsEntityEstimateSize,
  serialize: _settingsEntitySerialize,
  deserialize: _settingsEntityDeserialize,
  deserializeProp: _settingsEntityDeserializeProp,
  idName: r'id',
  indexes: {},
  links: {},
  embeddedSchemas: {},
  getId: _settingsEntityGetId,
  getLinks: _settingsEntityGetLinks,
  attach: _settingsEntityAttach,
  version: '3.1.0+1',
);

int _settingsEntityEstimateSize(
  SettingsEntity object,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  var bytesCount = offsets.last;
  return bytesCount;
}

void _settingsEntitySerialize(
  SettingsEntity object,
  IsarWriter writer,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  writer.writeLong(offsets[0], object.defaultPageCount);
  writer.writeLong(offsets[1], object.librarySort);
  writer.writeLong(offsets[2], object.libraryView);
  writer.writeLong(offsets[3], object.penColorValue);
  writer.writeDouble(offsets[4], object.penSize);
  writer.writeLong(offsets[5], object.themeMode);
}

SettingsEntity _settingsEntityDeserialize(
  Id id,
  IsarReader reader,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  final object = SettingsEntity();
  object.defaultPageCount = reader.readLong(offsets[0]);
  object.id = id;
  object.librarySort = reader.readLong(offsets[1]);
  object.libraryView = reader.readLong(offsets[2]);
  object.penColorValue = reader.readLong(offsets[3]);
  object.penSize = reader.readDouble(offsets[4]);
  object.themeMode = reader.readLong(offsets[5]);
  return object;
}

P _settingsEntityDeserializeProp<P>(
  IsarReader reader,
  int propertyId,
  int offset,
  Map<Type, List<int>> allOffsets,
) {
  switch (propertyId) {
    case 0:
      return (reader.readLong(offset)) as P;
    case 1:
      return (reader.readLong(offset)) as P;
    case 2:
      return (reader.readLong(offset)) as P;
    case 3:
      return (reader.readLong(offset)) as P;
    case 4:
      return (reader.readDouble(offset)) as P;
    case 5:
      return (reader.readLong(offset)) as P;
    default:
      throw IsarError('Unknown property with id $propertyId');
  }
}

Id _settingsEntityGetId(SettingsEntity object) {
  return object.id;
}

List<IsarLinkBase<dynamic>> _settingsEntityGetLinks(SettingsEntity object) {
  return [];
}

void _settingsEntityAttach(
    IsarCollection<dynamic> col, Id id, SettingsEntity object) {
  object.id = id;
}

extension SettingsEntityQueryWhereSort
    on QueryBuilder<SettingsEntity, SettingsEntity, QWhere> {
  QueryBuilder<SettingsEntity, SettingsEntity, QAfterWhere> anyId() {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(const IdWhereClause.any());
    });
  }
}

extension SettingsEntityQueryWhere
    on QueryBuilder<SettingsEntity, SettingsEntity, QWhereClause> {
  QueryBuilder<SettingsEntity, SettingsEntity, QAfterWhereClause> idEqualTo(
      Id id) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IdWhereClause.between(
        lower: id,
        upper: id,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterWhereClause> idNotEqualTo(
      Id id) {
    return QueryBuilder.apply(this, (query) {
      if (query.whereSort == Sort.asc) {
        return query
            .addWhereClause(
              IdWhereClause.lessThan(upper: id, includeUpper: false),
            )
            .addWhereClause(
              IdWhereClause.greaterThan(lower: id, includeLower: false),
            );
      } else {
        return query
            .addWhereClause(
              IdWhereClause.greaterThan(lower: id, includeLower: false),
            )
            .addWhereClause(
              IdWhereClause.lessThan(upper: id, includeUpper: false),
            );
      }
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterWhereClause> idGreaterThan(
      Id id,
      {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        IdWhereClause.greaterThan(lower: id, includeLower: include),
      );
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterWhereClause> idLessThan(
      Id id,
      {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        IdWhereClause.lessThan(upper: id, includeUpper: include),
      );
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterWhereClause> idBetween(
    Id lowerId,
    Id upperId, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IdWhereClause.between(
        lower: lowerId,
        includeLower: includeLower,
        upper: upperId,
        includeUpper: includeUpper,
      ));
    });
  }
}

extension SettingsEntityQueryFilter
    on QueryBuilder<SettingsEntity, SettingsEntity, QFilterCondition> {
  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      defaultPageCountEqualTo(int value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'defaultPageCount',
        value: value,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      defaultPageCountGreaterThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'defaultPageCount',
        value: value,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      defaultPageCountLessThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'defaultPageCount',
        value: value,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      defaultPageCountBetween(
    int lower,
    int upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'defaultPageCount',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition> idEqualTo(
      Id value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'id',
        value: value,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      idGreaterThan(
    Id value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'id',
        value: value,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      idLessThan(
    Id value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'id',
        value: value,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition> idBetween(
    Id lower,
    Id upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'id',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      librarySortEqualTo(int value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'librarySort',
        value: value,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      librarySortGreaterThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'librarySort',
        value: value,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      librarySortLessThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'librarySort',
        value: value,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      librarySortBetween(
    int lower,
    int upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'librarySort',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      libraryViewEqualTo(int value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'libraryView',
        value: value,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      libraryViewGreaterThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'libraryView',
        value: value,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      libraryViewLessThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'libraryView',
        value: value,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      libraryViewBetween(
    int lower,
    int upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'libraryView',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      penColorValueEqualTo(int value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'penColorValue',
        value: value,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      penColorValueGreaterThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'penColorValue',
        value: value,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      penColorValueLessThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'penColorValue',
        value: value,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      penColorValueBetween(
    int lower,
    int upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'penColorValue',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      penSizeEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'penSize',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      penSizeGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'penSize',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      penSizeLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'penSize',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      penSizeBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'penSize',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      themeModeEqualTo(int value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'themeMode',
        value: value,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      themeModeGreaterThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'themeMode',
        value: value,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      themeModeLessThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'themeMode',
        value: value,
      ));
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterFilterCondition>
      themeModeBetween(
    int lower,
    int upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'themeMode',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }
}

extension SettingsEntityQueryObject
    on QueryBuilder<SettingsEntity, SettingsEntity, QFilterCondition> {}

extension SettingsEntityQueryLinks
    on QueryBuilder<SettingsEntity, SettingsEntity, QFilterCondition> {}

extension SettingsEntityQuerySortBy
    on QueryBuilder<SettingsEntity, SettingsEntity, QSortBy> {
  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy>
      sortByDefaultPageCount() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'defaultPageCount', Sort.asc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy>
      sortByDefaultPageCountDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'defaultPageCount', Sort.desc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy>
      sortByLibrarySort() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'librarySort', Sort.asc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy>
      sortByLibrarySortDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'librarySort', Sort.desc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy>
      sortByLibraryView() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'libraryView', Sort.asc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy>
      sortByLibraryViewDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'libraryView', Sort.desc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy>
      sortByPenColorValue() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'penColorValue', Sort.asc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy>
      sortByPenColorValueDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'penColorValue', Sort.desc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy> sortByPenSize() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'penSize', Sort.asc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy>
      sortByPenSizeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'penSize', Sort.desc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy> sortByThemeMode() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'themeMode', Sort.asc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy>
      sortByThemeModeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'themeMode', Sort.desc);
    });
  }
}

extension SettingsEntityQuerySortThenBy
    on QueryBuilder<SettingsEntity, SettingsEntity, QSortThenBy> {
  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy>
      thenByDefaultPageCount() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'defaultPageCount', Sort.asc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy>
      thenByDefaultPageCountDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'defaultPageCount', Sort.desc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy> thenById() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'id', Sort.asc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy> thenByIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'id', Sort.desc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy>
      thenByLibrarySort() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'librarySort', Sort.asc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy>
      thenByLibrarySortDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'librarySort', Sort.desc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy>
      thenByLibraryView() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'libraryView', Sort.asc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy>
      thenByLibraryViewDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'libraryView', Sort.desc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy>
      thenByPenColorValue() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'penColorValue', Sort.asc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy>
      thenByPenColorValueDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'penColorValue', Sort.desc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy> thenByPenSize() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'penSize', Sort.asc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy>
      thenByPenSizeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'penSize', Sort.desc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy> thenByThemeMode() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'themeMode', Sort.asc);
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QAfterSortBy>
      thenByThemeModeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'themeMode', Sort.desc);
    });
  }
}

extension SettingsEntityQueryWhereDistinct
    on QueryBuilder<SettingsEntity, SettingsEntity, QDistinct> {
  QueryBuilder<SettingsEntity, SettingsEntity, QDistinct>
      distinctByDefaultPageCount() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'defaultPageCount');
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QDistinct>
      distinctByLibrarySort() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'librarySort');
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QDistinct>
      distinctByLibraryView() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'libraryView');
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QDistinct>
      distinctByPenColorValue() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'penColorValue');
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QDistinct> distinctByPenSize() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'penSize');
    });
  }

  QueryBuilder<SettingsEntity, SettingsEntity, QDistinct>
      distinctByThemeMode() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'themeMode');
    });
  }
}

extension SettingsEntityQueryProperty
    on QueryBuilder<SettingsEntity, SettingsEntity, QQueryProperty> {
  QueryBuilder<SettingsEntity, int, QQueryOperations> idProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'id');
    });
  }

  QueryBuilder<SettingsEntity, int, QQueryOperations>
      defaultPageCountProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'defaultPageCount');
    });
  }

  QueryBuilder<SettingsEntity, int, QQueryOperations> librarySortProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'librarySort');
    });
  }

  QueryBuilder<SettingsEntity, int, QQueryOperations> libraryViewProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'libraryView');
    });
  }

  QueryBuilder<SettingsEntity, int, QQueryOperations> penColorValueProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'penColorValue');
    });
  }

  QueryBuilder<SettingsEntity, double, QQueryOperations> penSizeProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'penSize');
    });
  }

  QueryBuilder<SettingsEntity, int, QQueryOperations> themeModeProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'themeMode');
    });
  }
}
