// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'stroke_repository.dart';

// **************************************************************************
// IsarCollectionGenerator
// **************************************************************************

// coverage:ignore-file
// ignore_for_file: duplicate_ignore, non_constant_identifier_names, constant_identifier_names, invalid_use_of_protected_member, unnecessary_cast, prefer_const_constructors, lines_longer_than_80_chars, require_trailing_commas, inference_failure_on_function_invocation, unnecessary_parenthesis, unnecessary_raw_strings, unnecessary_null_checks, join_return_with_assignment, prefer_final_locals, avoid_js_rounded_ints, avoid_positional_boolean_parameters, always_specify_types

extension GetStrokeEntityCollection on Isar {
  IsarCollection<StrokeEntity> get strokeEntitys => this.collection();
}

const StrokeEntitySchema = CollectionSchema(
  name: r'StrokeEntity',
  id: 1652844139129545802,
  properties: {
    r'colorValue': PropertySchema(
      id: 0,
      name: r'colorValue',
      type: IsarType.long,
    ),
    r'docId': PropertySchema(
      id: 1,
      name: r'docId',
      type: IsarType.string,
    ),
    r'page': PropertySchema(
      id: 2,
      name: r'page',
      type: IsarType.long,
    ),
    r'points': PropertySchema(
      id: 3,
      name: r'points',
      type: IsarType.doubleList,
    ),
    r'simulatePressure': PropertySchema(
      id: 4,
      name: r'simulatePressure',
      type: IsarType.bool,
    ),
    r'size': PropertySchema(
      id: 5,
      name: r'size',
      type: IsarType.double,
    ),
    r'smoothing': PropertySchema(
      id: 6,
      name: r'smoothing',
      type: IsarType.double,
    ),
    r'streamline': PropertySchema(
      id: 7,
      name: r'streamline',
      type: IsarType.double,
    ),
    r'thinning': PropertySchema(
      id: 8,
      name: r'thinning',
      type: IsarType.double,
    )
  },
  estimateSize: _strokeEntityEstimateSize,
  serialize: _strokeEntitySerialize,
  deserialize: _strokeEntityDeserialize,
  deserializeProp: _strokeEntityDeserializeProp,
  idName: r'id',
  indexes: {
    r'docId': IndexSchema(
      id: -9164048795576814174,
      name: r'docId',
      unique: false,
      replace: false,
      properties: [
        IndexPropertySchema(
          name: r'docId',
          type: IndexType.hash,
          caseSensitive: true,
        )
      ],
    )
  },
  links: {},
  embeddedSchemas: {},
  getId: _strokeEntityGetId,
  getLinks: _strokeEntityGetLinks,
  attach: _strokeEntityAttach,
  version: '3.1.0+1',
);

int _strokeEntityEstimateSize(
  StrokeEntity object,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  var bytesCount = offsets.last;
  bytesCount += 3 + object.docId.length * 3;
  bytesCount += 3 + object.points.length * 8;
  return bytesCount;
}

void _strokeEntitySerialize(
  StrokeEntity object,
  IsarWriter writer,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  writer.writeLong(offsets[0], object.colorValue);
  writer.writeString(offsets[1], object.docId);
  writer.writeLong(offsets[2], object.page);
  writer.writeDoubleList(offsets[3], object.points);
  writer.writeBool(offsets[4], object.simulatePressure);
  writer.writeDouble(offsets[5], object.size);
  writer.writeDouble(offsets[6], object.smoothing);
  writer.writeDouble(offsets[7], object.streamline);
  writer.writeDouble(offsets[8], object.thinning);
}

StrokeEntity _strokeEntityDeserialize(
  Id id,
  IsarReader reader,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  final object = StrokeEntity();
  object.colorValue = reader.readLong(offsets[0]);
  object.docId = reader.readString(offsets[1]);
  object.id = id;
  object.page = reader.readLong(offsets[2]);
  object.points = reader.readDoubleList(offsets[3]) ?? [];
  object.simulatePressure = reader.readBool(offsets[4]);
  object.size = reader.readDouble(offsets[5]);
  object.smoothing = reader.readDouble(offsets[6]);
  object.streamline = reader.readDouble(offsets[7]);
  object.thinning = reader.readDouble(offsets[8]);
  return object;
}

P _strokeEntityDeserializeProp<P>(
  IsarReader reader,
  int propertyId,
  int offset,
  Map<Type, List<int>> allOffsets,
) {
  switch (propertyId) {
    case 0:
      return (reader.readLong(offset)) as P;
    case 1:
      return (reader.readString(offset)) as P;
    case 2:
      return (reader.readLong(offset)) as P;
    case 3:
      return (reader.readDoubleList(offset) ?? []) as P;
    case 4:
      return (reader.readBool(offset)) as P;
    case 5:
      return (reader.readDouble(offset)) as P;
    case 6:
      return (reader.readDouble(offset)) as P;
    case 7:
      return (reader.readDouble(offset)) as P;
    case 8:
      return (reader.readDouble(offset)) as P;
    default:
      throw IsarError('Unknown property with id $propertyId');
  }
}

Id _strokeEntityGetId(StrokeEntity object) {
  return object.id;
}

List<IsarLinkBase<dynamic>> _strokeEntityGetLinks(StrokeEntity object) {
  return [];
}

void _strokeEntityAttach(
    IsarCollection<dynamic> col, Id id, StrokeEntity object) {
  object.id = id;
}

extension StrokeEntityQueryWhereSort
    on QueryBuilder<StrokeEntity, StrokeEntity, QWhere> {
  QueryBuilder<StrokeEntity, StrokeEntity, QAfterWhere> anyId() {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(const IdWhereClause.any());
    });
  }
}

extension StrokeEntityQueryWhere
    on QueryBuilder<StrokeEntity, StrokeEntity, QWhereClause> {
  QueryBuilder<StrokeEntity, StrokeEntity, QAfterWhereClause> idEqualTo(Id id) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IdWhereClause.between(
        lower: id,
        upper: id,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterWhereClause> idNotEqualTo(
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

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterWhereClause> idGreaterThan(
      Id id,
      {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        IdWhereClause.greaterThan(lower: id, includeLower: include),
      );
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterWhereClause> idLessThan(Id id,
      {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        IdWhereClause.lessThan(upper: id, includeUpper: include),
      );
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterWhereClause> idBetween(
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

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterWhereClause> docIdEqualTo(
      String docId) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.equalTo(
        indexName: r'docId',
        value: [docId],
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterWhereClause> docIdNotEqualTo(
      String docId) {
    return QueryBuilder.apply(this, (query) {
      if (query.whereSort == Sort.asc) {
        return query
            .addWhereClause(IndexWhereClause.between(
              indexName: r'docId',
              lower: [],
              upper: [docId],
              includeUpper: false,
            ))
            .addWhereClause(IndexWhereClause.between(
              indexName: r'docId',
              lower: [docId],
              includeLower: false,
              upper: [],
            ));
      } else {
        return query
            .addWhereClause(IndexWhereClause.between(
              indexName: r'docId',
              lower: [docId],
              includeLower: false,
              upper: [],
            ))
            .addWhereClause(IndexWhereClause.between(
              indexName: r'docId',
              lower: [],
              upper: [docId],
              includeUpper: false,
            ));
      }
    });
  }
}

extension StrokeEntityQueryFilter
    on QueryBuilder<StrokeEntity, StrokeEntity, QFilterCondition> {
  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      colorValueEqualTo(int value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'colorValue',
        value: value,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      colorValueGreaterThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'colorValue',
        value: value,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      colorValueLessThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'colorValue',
        value: value,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      colorValueBetween(
    int lower,
    int upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'colorValue',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition> docIdEqualTo(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'docId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      docIdGreaterThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'docId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition> docIdLessThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'docId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition> docIdBetween(
    String lower,
    String upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'docId',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      docIdStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'docId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition> docIdEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'docId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition> docIdContains(
      String value,
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'docId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition> docIdMatches(
      String pattern,
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'docId',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      docIdIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'docId',
        value: '',
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      docIdIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'docId',
        value: '',
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition> idEqualTo(
      Id value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'id',
        value: value,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition> idGreaterThan(
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

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition> idLessThan(
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

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition> idBetween(
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

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition> pageEqualTo(
      int value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'page',
        value: value,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      pageGreaterThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'page',
        value: value,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition> pageLessThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'page',
        value: value,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition> pageBetween(
    int lower,
    int upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'page',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      pointsElementEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'points',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      pointsElementGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'points',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      pointsElementLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'points',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      pointsElementBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'points',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      pointsLengthEqualTo(int length) {
    return QueryBuilder.apply(this, (query) {
      return query.listLength(
        r'points',
        length,
        true,
        length,
        true,
      );
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      pointsIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.listLength(
        r'points',
        0,
        true,
        0,
        true,
      );
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      pointsIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.listLength(
        r'points',
        0,
        false,
        999999,
        true,
      );
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      pointsLengthLessThan(
    int length, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.listLength(
        r'points',
        0,
        true,
        length,
        include,
      );
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      pointsLengthGreaterThan(
    int length, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.listLength(
        r'points',
        length,
        include,
        999999,
        true,
      );
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      pointsLengthBetween(
    int lower,
    int upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.listLength(
        r'points',
        lower,
        includeLower,
        upper,
        includeUpper,
      );
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      simulatePressureEqualTo(bool value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'simulatePressure',
        value: value,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition> sizeEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'size',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      sizeGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'size',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition> sizeLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'size',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition> sizeBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'size',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      smoothingEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'smoothing',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      smoothingGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'smoothing',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      smoothingLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'smoothing',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      smoothingBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'smoothing',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      streamlineEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'streamline',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      streamlineGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'streamline',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      streamlineLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'streamline',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      streamlineBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'streamline',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      thinningEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'thinning',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      thinningGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'thinning',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      thinningLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'thinning',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterFilterCondition>
      thinningBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'thinning',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }
}

extension StrokeEntityQueryObject
    on QueryBuilder<StrokeEntity, StrokeEntity, QFilterCondition> {}

extension StrokeEntityQueryLinks
    on QueryBuilder<StrokeEntity, StrokeEntity, QFilterCondition> {}

extension StrokeEntityQuerySortBy
    on QueryBuilder<StrokeEntity, StrokeEntity, QSortBy> {
  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> sortByColorValue() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'colorValue', Sort.asc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy>
      sortByColorValueDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'colorValue', Sort.desc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> sortByDocId() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'docId', Sort.asc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> sortByDocIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'docId', Sort.desc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> sortByPage() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'page', Sort.asc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> sortByPageDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'page', Sort.desc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy>
      sortBySimulatePressure() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'simulatePressure', Sort.asc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy>
      sortBySimulatePressureDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'simulatePressure', Sort.desc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> sortBySize() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'size', Sort.asc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> sortBySizeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'size', Sort.desc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> sortBySmoothing() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'smoothing', Sort.asc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> sortBySmoothingDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'smoothing', Sort.desc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> sortByStreamline() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'streamline', Sort.asc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy>
      sortByStreamlineDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'streamline', Sort.desc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> sortByThinning() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'thinning', Sort.asc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> sortByThinningDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'thinning', Sort.desc);
    });
  }
}

extension StrokeEntityQuerySortThenBy
    on QueryBuilder<StrokeEntity, StrokeEntity, QSortThenBy> {
  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> thenByColorValue() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'colorValue', Sort.asc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy>
      thenByColorValueDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'colorValue', Sort.desc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> thenByDocId() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'docId', Sort.asc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> thenByDocIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'docId', Sort.desc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> thenById() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'id', Sort.asc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> thenByIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'id', Sort.desc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> thenByPage() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'page', Sort.asc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> thenByPageDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'page', Sort.desc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy>
      thenBySimulatePressure() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'simulatePressure', Sort.asc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy>
      thenBySimulatePressureDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'simulatePressure', Sort.desc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> thenBySize() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'size', Sort.asc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> thenBySizeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'size', Sort.desc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> thenBySmoothing() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'smoothing', Sort.asc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> thenBySmoothingDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'smoothing', Sort.desc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> thenByStreamline() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'streamline', Sort.asc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy>
      thenByStreamlineDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'streamline', Sort.desc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> thenByThinning() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'thinning', Sort.asc);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QAfterSortBy> thenByThinningDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'thinning', Sort.desc);
    });
  }
}

extension StrokeEntityQueryWhereDistinct
    on QueryBuilder<StrokeEntity, StrokeEntity, QDistinct> {
  QueryBuilder<StrokeEntity, StrokeEntity, QDistinct> distinctByColorValue() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'colorValue');
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QDistinct> distinctByDocId(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'docId', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QDistinct> distinctByPage() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'page');
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QDistinct> distinctByPoints() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'points');
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QDistinct>
      distinctBySimulatePressure() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'simulatePressure');
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QDistinct> distinctBySize() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'size');
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QDistinct> distinctBySmoothing() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'smoothing');
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QDistinct> distinctByStreamline() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'streamline');
    });
  }

  QueryBuilder<StrokeEntity, StrokeEntity, QDistinct> distinctByThinning() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'thinning');
    });
  }
}

extension StrokeEntityQueryProperty
    on QueryBuilder<StrokeEntity, StrokeEntity, QQueryProperty> {
  QueryBuilder<StrokeEntity, int, QQueryOperations> idProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'id');
    });
  }

  QueryBuilder<StrokeEntity, int, QQueryOperations> colorValueProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'colorValue');
    });
  }

  QueryBuilder<StrokeEntity, String, QQueryOperations> docIdProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'docId');
    });
  }

  QueryBuilder<StrokeEntity, int, QQueryOperations> pageProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'page');
    });
  }

  QueryBuilder<StrokeEntity, List<double>, QQueryOperations> pointsProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'points');
    });
  }

  QueryBuilder<StrokeEntity, bool, QQueryOperations>
      simulatePressureProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'simulatePressure');
    });
  }

  QueryBuilder<StrokeEntity, double, QQueryOperations> sizeProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'size');
    });
  }

  QueryBuilder<StrokeEntity, double, QQueryOperations> smoothingProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'smoothing');
    });
  }

  QueryBuilder<StrokeEntity, double, QQueryOperations> streamlineProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'streamline');
    });
  }

  QueryBuilder<StrokeEntity, double, QQueryOperations> thinningProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'thinning');
    });
  }
}
