import isNumber from 'lodash/isNumber';
import isString from 'lodash/isString';
import isPlainObject from 'lodash/isPlainObject';
import isObject from 'lodash/isObject';
import { QueryError } from 'kinvey-errors';

const PROTECTED_FIELDS = ['_id', '_acl'];
const UNSUPPORTED_CONDITIONS = ['$nearSphere'];

export class Query {
  constructor(query) {
    const config = Object.assign({}, {
      fields: [],
      filter: {},
      sort: {},
      limit: Infinity,
      skip: 0
    }, query);

    this.fields = config.fields;
    this.filter = config.filter;
    this.sort = config.sort;
    this.limit = config.limit;
    this.skip = config.skip;
  }

  get fields() {
    if (this._fields.length > 0) {
      return [].concat(this._fields, PROTECTED_FIELDS);
    }

    return [];
  }

  set fields(fields) {
    if (!Array.isArray(fields)) {
      throw new QueryError('fields must be an Array');
    }

    if (this._parent) {
      this._parent.fields = fields;
    } else {
      this._fields = fields;
    }
  }

  get sort() {
    return this._sort;
  }

  set sort(sort) {
    if (sort && !isPlainObject(sort)) {
      throw new QueryError('sort must an Object');
    }

    if (this._parent) {
      this._parent.sort = sort;
    } else {
      this._sort = sort;
    }
  }

  get limit() {
    return this._limit;
  }

  set limit(limit) {
    let _limit = limit;

    if (isString(_limit)) {
      _limit = parseFloat(_limit);
    }

    if (limit && !isNumber(_limit)) {
      throw new QueryError('limit must be a number');
    }

    if (this._parent) {
      this._parent.limit = _limit;
    } else {
      this._limit = _limit;
    }
  }

  get skip() {
    return this._skip;
  }

  set skip(skip) {
    let _skip = skip;

    if (isString(_skip)) {
      _skip = parseFloat(_skip);
    }

    if (!isNumber(_skip)) {
      throw new QueryError('skip must be a number');
    }

    if (this._parent) {
      this._parent.skip = _skip;
    } else {
      this._skip = _skip;
    }
  }

  /**
   * Returns true or false depending on if the query is able to be processed offline.
   *
   * @returns {boolean} True if the query is supported offline otherwise false.
   */
  isSupportedOffline() {
    return Object.keys(this.filter).reduce((supported, key) => {
      if (supported) {
        const value = this.filter[key];
        return UNSUPPORTED_CONDITIONS.some((unsupportedConditions) => {
          if (!value) {
            return true;
          }

          if (!isObject(value)) {
            return true;
          }

          return !Object.keys(value).some((condition) => {
            return condition === unsupportedConditions;
          });
        });
      }

      return supported;
    }, true);
  }

  /**
   * Adds an equal to filter to the query. Requires field to equal value.
   * Any existing filters on field will be discarded.
   * @see https://docs.mongodb.com/manual/reference/operator/query/#comparison
   *
   * @param {string} field Field
   * @param {*} value Value
   * @returns {Query} Query
   */
  equalTo(field, value) {
    return this.addFilter(field, value);
  }

  /**
   * Adds a not equal to filter to the query. Requires field not to equal
   * value.
   * @see https://docs.mongodb.com/manual/reference/operator/query/ne
   *
   * @param {string} field Field
   * @param {*} value Value
   * @returns {Query} Query
   */
  notEqualTo(field, value) {
    return this.addFilter(field, '$ne', value);
  }

  /**
   * Adds a contains filter to the query. Requires field to contain at least
   * one of the members of list.
   * @see https://docs.mongodb.com/manual/reference/operator/query/in
   *
   * @param {string} field Field
   * @param {Array} values List of values.
   * @throws {Error} A value is required.
   * @returns {Query} Query
   */
  contains(field, values) {
    if (!values) {
      throw new QueryError('You must supply a value.');
    }

    if (!Array.isArray(values)) {
      return this.addFilter(field, '$in', [values]);
    }

    return this.addFilter(field, '$in', values);
  }

  /**
   * Adds a not contained in filter to the query. Requires `field` not to
   * contain any of the members of `list`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/nin
   *
   * @param {string} field Field
   * @param {Array} values List of values.
   * @throws {Error} A value is required.
   * @returns {Query} Query
   */
  notContainedIn(field, values) {
    if (!values) {
      throw new QueryError('You must supply a value.');
    }

    if (!Array.isArray(values)) {
      return this.addFilter(field, '$nin', [values]);
    }

    return this.addFilter(field, '$nin', values);
  }

  /**
   * Adds a contains all filter to the query. Requires `field` to contain all
   * members of `list`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/all
   *
   * @param {string} field Field
   * @param {object|Array} values List of values.
   * @throws {Error} A value is required.
   * @returns {Query} Query
   */
  containsAll(field, values) {
    if (!values) {
      throw new QueryError('You must supply a value.');
    }

    if (!Array.isArray(values)) {
      return this.addFilter(field, '$all', [values]);
    }

    return this.addFilter(field, '$all', values);
  }

  /**
   * Adds a greater than filter to the query. Requires `field` to be greater
   * than `value`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/gt
   *
   * @param {string} field Field
   * @param {number|string} value Value
   * @throws {Error} The value must be a number or string.
   * @returns {Query} Query
   */
  greaterThan(field, value) {
    if (!isNumber(value) && !isString(value)) {
      throw new QueryError('You must supply a number or string.');
    }

    return this.addFilter(field, '$gt', value);
  }

  /**
   * Adds a greater than or equal to filter to the query. Requires `field` to
   * be greater than or equal to `value`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/gte
   *
   * @param {string} field Field.
   * @param {number|string} value Value.
   * @throws {Error} The value must be a number or string.
   * @returns {Query} Query
   */
  greaterThanOrEqualTo(field, value) {
    if (!isNumber(value) && !isString(value)) {
      throw new QueryError('You must supply a number or string.');
    }

    return this.addFilter(field, '$gte', value);
  }

  /**
   * Adds a less than filter to the query. Requires `field` to be less than
   * `value`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/lt
   *
   * @param {string} field Field
   * @param {number|string} value Value
   * @throws {Error} The value must be a number or string.
   * @returns {Query} Query
   */
  lessThan(field, value) {
    if (!isNumber(value) && !isString(value)) {
      throw new QueryError('You must supply a number or string.');
    }

    return this.addFilter(field, '$lt', value);
  }

  /**
   * Adds a less than or equal to filter to the query. Requires `field` to be
   * less than or equal to `value`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/lte
   *
   * @param {string} field Field
   * @param {number|string} value Value
   * @throws {Error} The value must be a number or string.
   * @returns {Query} Query
   */
  lessThanOrEqualTo(field, value) {
    if (!isNumber(value) && !isString(value)) {
      throw new QueryError('You must supply a number or string.');
    }

    return this.addFilter(field, '$lte', value);
  }

  /**
   * Adds an exists filter to the query. Requires `field` to exist if `flag` is
   * `true`, or not to exist if `flag` is `false`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/exists
   *
   * @param {string} field Field
   * @param {boolean} [flag=true] The exists flag.
   * @returns {Query} Query
   */
  exists(field, flag = true) {
    return this.addFilter(field, '$exists', flag === true);
  }

  /**
   * Adds a modulus filter to the query. Requires `field` modulo `divisor` to
   * have remainder `remainder`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/mod
   *
   * @param {string} field Field
   * @param {number} divisor Divisor
   * @param {number} [remainder=0] Remainder
   * @throws {Error} The divisor must be a number.
   * @throws {Error} The remainder must be a number.
   * @returns {Query} Query
   */
  mod(field, divisor, remainder = 0) {
    if (!isNumber(divisor)) {
      throw new QueryError('divisor must be a number');
    }

    if (!isNumber(remainder)) {
      throw new QueryError('remainder must be a number');
    }

    return this.addFilter(field, '$mod', [divisor, remainder]);
  }

  /**
   * Adds a match filter to the query. Requires `field` to match `regExp`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/regex
   *
   * @param {string} field Field
   * @param {RegExp|string} regExp Regular expression.
   * @param {Object} [options] Options
   * @param {boolean} [options.ignoreCase=inherit] Toggles case-insensitivity.
   * @param {boolean} [options.multiline=inherit] Toggles multiline matching.
   * @param {boolean} [options.extended=false] Toggles extended capability.
   * @param {boolean} [options.dotMatchesAll=false] Toggles dot matches all.
   * @throws {Error} The regExp must have '^' at the beginning of the expression to make it an anchored expression.
   * @throws {Error} The ignoreCase flag is not supported.
   * @returns {Query} Query
   */
  matches(field, expression, options = {}) {
    const flags = [];
    let regExp = expression;

    if (!(regExp instanceof RegExp)) {
      regExp = new RegExp(regExp);
    }

    if (regExp.source.indexOf('^') !== 0) {
      throw new QueryError('regExp must have \'^\' at the beginning of the expression to make it an anchored expression.');
    }

    if ((regExp.ignoreCase || options.ignoreCase) && options.ignoreCase !== false) {
      throw new QueryError('ignoreCase flag is not supported');
    }

    if ((regExp.multiline || options.multiline) && options.multiline !== false) {
      flags.push('m');
    }

    if (options.extended === true) {
      flags.push('x');
    }

    if (options.dotMatchesAll === true) {
      flags.push('s');
    }

    if (flags.length > 0) {
      this.addFilter(field, '$options', flags.join(''));
    }

    return this.addFilter(field, '$regex', regExp.source);
  }

  /**
   * Adds a near filter to the query. Requires `field` to be a coordinate
   * within `maxDistance` of `coord`. Sorts documents from nearest to farthest.
   * @see https://docs.mongodb.com/manual/reference/operator/query/near
   *
   * @param {string} field The field.
   * @param {Array<number, number>} coord The coordinate (longitude, latitude).
   * @param {number} [maxDistance] The maximum distance (miles).
   * @throws {Error} The coord must be a [number, number].
   * @returns {Query} Query
   */
  near(field, coord, maxDistance) {
    if (!Array.isArray(coord) || !isNumber(coord[0]) || !isNumber(coord[1])) {
      throw new QueryError('coord must be a [number, number]');
    }

    const result = this.addFilter(field, '$nearSphere', [coord[0], coord[1]]);

    if (isNumber(maxDistance)) {
      this.addFilter(field, '$maxDistance', maxDistance);
    }

    return result;
  }

  /**
   * Adds a within box filter to the query. Requires `field` to be a coordinate
   * within the bounds of the rectangle defined by `bottomLeftCoord`,
   * `bottomRightCoord`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/box
   *
   * @param {string} field The field.
   * @param {Array<number, number>} bottomLeftCoord The bottom left coordinate (longitude, latitude).
   * @param {Array<number, number>} upperRightCoord The bottom right coordinate (longitude, latitude).
   * @throws {Error} The bottomLeftCoord must be a [number, number].
   * @throws {Error} The upperRightCoord must be a [number, number].
   * @returns {Query} Query
   */
  withinBox(field, bottomLeftCoord, upperRightCoord) {
    if (!Array.isArray(bottomLeftCoord)
      || !isNumber(bottomLeftCoord[0])
      || !isNumber(bottomLeftCoord[1])) {
      throw new QueryError('bottomLeftCoord must be a [number, number]');
    }

    if (!Array.isArray(upperRightCoord)
      || !isNumber(upperRightCoord[0])
      || !isNumber(upperRightCoord[1])) {
      throw new QueryError('upperRightCoord must be a [number, number]');
    }

    const coords = [
      [bottomLeftCoord[0], bottomLeftCoord[1]],
      [upperRightCoord[0], upperRightCoord[1]]
    ];
    return this.addFilter(field, '$within', { $box: coords });
  }

  /**
   * Adds a within polygon filter to the query. Requires `field` to be a
   * coordinate within the bounds of the polygon defined by `coords`.
   * @see https://docs.mongodb.com/manual/reference/operator/query/polygon
   *
   * @param {string} field The field.
   * @param {Array<Array<number, number>>} coords List of coordinates.
   * @throws {Error} The coords must be a [[number, number]].
   * @returns {Query} Query
   */
  withinPolygon(field, coords) {
    if (Array.isArray(coords) === false || coords.length === 0 || coords[0].length > 3) {
      throw new QueryError('coords must be a [[number, number]]');
    }

    const withinCoords = coords.map((coord) => {
      if (!isNumber(coord[0]) || !isNumber(coord[1])) {
        throw new QueryError('coords argument must be a [number, number]');
      }

      return [coord[0], coord[1]];
    });

    return this.addFilter(field, '$within', { $polygon: withinCoords });
  }

  /**
   * Adds a size filter to the query. Requires `field` to be an `Array` with
   * exactly `size` members.
   * @see https://docs.mongodb.com/manual/reference/operator/query/size
   *
   * @param {string} field Field
   * @param {number} size Size
   * @throws {Error} The size must be a number.
   * @returns {Query} Query
   */
  size(field, size) {
    if (!isNumber(size)) {
      throw new QueryError('size must be a number');
    }

    return this.addFilter(field, '$size', size);
  }

  /**
   * Adds an ascending sort modifier to the query. Sorts by `field`, ascending.
   *
   * @param {string} field Field
   * @returns {Query} Query
   */
  ascending(field) {
    if (this._parent) {
      this._parent.ascending(field);
    } else {
      if (!this.sort) {
        this.sort = {};
      }

      this.sort[field] = 1;
    }

    return this;
  }

  /**
   * Adds an descending sort modifier to the query. Sorts by `field`,
   * descending.
   *
   * @param {string} field Field
   * @returns {Query} Query
   */
  descending(field) {
    if (this._parent) {
      this._parent.descending(field);
    } else {
      if (!this.sort) {
        this.sort = {};
      }

      this.sort[field] = -1;
    }

    return this;
  }

  /**
   * Performs a logical AND operation on the query and the provided queries.
   * @see https://docs.mongodb.com/manual/reference/operator/query/and
   *
   * @param {...Query|...Object} args Queries
   * @throws {Error} Queries must be an array of Query instances or objects.
   * @returns {Query} Query
   */
  and(...args) {
    // AND has highest precedence. Therefore, even if this query is part of a
    // JOIN already, apply it on this query.
    return this.join('$and', args);
  }

  /**
   * Performs a logical NOR operation on the query and the provided queries.
   * @see https://docs.mongodb.com/manual/reference/operator/query/nor
   *
   * @param {...Query|...Object} args Queries
   * @throws {Error} Queries must be an array of Query instances or objects.
   * @returns {Query} Query
   */
  nor(...args) {
    // NOR is preceded by AND. Therefore, if this query is part of an AND-join,
    // apply the NOR onto the parent to make sure AND indeed precedes NOR.
    if (this._parent && Object.hasOwnProperty.call(this._parent.filter, '$and')) {
      return this._parent.nor(...args);
    }

    return this.join('$nor', args);
  }

  /**
   * Performs a logical OR operation on the query and the provided queries.
   * @see https://docs.mongodb.com/manual/reference/operator/query/or
   *
   * @param {...Query|...Object} args Queries.
   * @throws {Error} Queries must be an array of Query instances or objects.
   * @returns {Query} Query
   */
  or(...args) {
    // OR has lowest precedence. Therefore, if this query is part of any join,
    // apply the OR onto the parent to make sure OR has indeed the lowest
    // precedence.
    if (this._parent) {
      return this._parent.or(...args);
    }

    return this.join('$or', args);
  }

  /**
   * Returns query string representation of the query as a JavaScript object.
   *
   * @returns {Object} Query string object.
   */
  toQueryObject() {
    const queryObject = {};

    if (Object.keys(this.filter).length > 0) {
      queryObject.query = this.filter;
    }

    if (this.fields.length > 0) {
      queryObject.fields = this.fields.join(',');
    }

    if (isNumber(this.limit) && this.limit < Infinity) {
      queryObject.limit = this.limit;
    }

    if (isNumber(this.skip) && this.skip > 0) {
      queryObject.skip = this.skip;
    }

    if (this.sort && Object.keys(this.sort).length > 0) {
      queryObject.sort = this.sort;
    }

    const keys = Object.keys(queryObject);
    keys.forEach((key) => {
      queryObject[key] = isString(queryObject[key]) ? queryObject[key] : JSON.stringify(queryObject[key]);
    });

    return queryObject;
  }

  /**
   * @deprecated
   * Please use Query.prototype.toQueryObject() instead.
   */
  toQueryString() {
    return this.toQueryObject();
  }

  /**
   * Returns Object representation of the query.
   *
   * @returns {Object} Object
   */
  toPlainObject() {
    if (this._parent) {
      return this._parent.toPlainObject();
    }

    // Return set of parameters.
    const json = {
      fields: this.fields,
      filter: this.filter,
      sort: this.sort,
      skip: this.skip,
      limit: this.limit
    };

    return json;
  }

  /**
   * Returns query string representation of the query.
   *
   * @return {string} Query string string.
   */
  toString() {
    return JSON.stringify(this.toQueryString());
  }

  /**
   * @private
   * Adds a filter to the query.
   *
   * @param {string} field Field
   * @param {string} condition Condition
   * @param {*} values Values
   * @returns {Query} Query
   */
  addFilter(field, ...args) {
    const { condition, values } = args.length === 2
      ? { condition: args[0], values: args[1] }
      : { condition: undefined, values: args[0] };

    if (!this.filter) {
      this.filter = {};
    }

    if (condition) {
      if (!this.filter[field]) {
        this.filter[field] = {};
      }

      this.filter[field][condition] = values;
    } else {
      this.filter[field] = values;
    }

    return this;
  }

  /**
   * @private
   * Joins the current query with another query using an operator.
   *
   * @param {string} operator Operator
   * @param {Query[]|object[]} queries Queries
   * @throws {Error} Queries must be an array of Query instances or objects.
   * @returns {Query} Query
   */
  join(operator, queries) {
    let that = this;
    let filters = queries.map(query => query.filter);

    if (filters.length === 0) {
      that = new Query();
      filters = [that.filter];
      that._parent = this; // Required for operator precedence
    }

    const currentFilter = Object.keys(this.filter).reduce((filter, key) => {
      // eslint-disable-next-line no-param-reassign
      filter[key] = this.filter[key];
      delete this.filter[key];
      return filter;
    }, {});

    this.addFilter(operator, [currentFilter].concat(filters));
    return that;
  }
}
