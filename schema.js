const _ = require('lodash')
const co = require('co').wrap
const stableStringify = require('json-stable-stringify')
const {
  GraphQLSchema,
  GraphQLNonNull,
  GraphQLBoolean,
  GraphQLInt,
  GraphQLFloat,
  GraphQLObjectType,
  GraphQLEnumType,
  GraphQLString,
  GraphQLList,
  GraphQLInterfaceType,
  GraphQLInputObjectType
} = require('graphql/type')

const GraphQLRelay = require('graphql-relay')
const GraphQLJSON = require('graphql-type-json')
const graphqlFields = require('graphql-fields')
// const { createBatchResolver } = require('graphql-resolve-batch')
const allSettled = require('settle-promise').settle
const {
  isInlinedProperty,
  isInstantiable,
  isEnum,
  parseStub,
  getPrimaryKeys
} = require('@tradle/validate-resource').utils

const {
  getBacklinkProperties
} = require('@tradle/validate-model').utils
const buildResource = require('@tradle/build-resource')
const { isProbablyResourceStub } = buildResource
const OPERATORS = require('./operators')
const {
  normalizeModels,
  getTypeName,
  isNullableProperty,
  isScalarProperty,
  isGoodEnumModel,
  getInstantiableModels,
  // getOnCreateProperties,
  getProperties,
  getRequiredProperties,
  getRef,
  normalizeNestedProps,
  memoizeByModel,
  memoizeByModelAndInput,
  // memoizeByModelAndBacklink,
  memoizeByModelAndOperator,
  getOperatorType,
  // toNonNull,
  debug,
  defineGetter
} = require('./utils')

const { connectionArgs } = GraphQLRelay
const USE_INTERFACES = false
const TYPE = '_t'
const linkProps = ['_link', '_permalink']
const { TimestampType, BytesType, ResourceStubType, EnumType } = require('./types')
const { NESTED_PROP_SEPARATOR } = require('./constants')
const wrappers = {
  String: { type: GraphQLString },
  StringList: { type: new GraphQLList(GraphQLString) },
  Boolean: { type: GraphQLBoolean },
  Int: { type: GraphQLInt },
  Float: { type: GraphQLFloat },
  Bytes: { type: BytesType },
  JSON: { type: GraphQLJSON },
  Timestamp: { type: TimestampType },
  ResourceStubInput: { type: ResourceStubType.input },
  ResourceStubOutput: { type: ResourceStubType.output },
}

wrappers.string = wrappers.String
wrappers.boolean = wrappers.Boolean
wrappers.enum = wrappers.String
wrappers.bytes = wrappers.Bytes
wrappers.number = wrappers.Float
wrappers.date = wrappers.Timestamp

// TODO: use getFields for this

const OPERATOR_NAMES = Object.keys(OPERATORS)
// const SCALAR_OPERATORS = Object.keys(OPERATORS)
//   .filter(name => OPERATORS[name].scalar)

const CURSOR_PREFIX = ''// new Buffer('cursor:').toString('base64')
const getGetterFieldName = type => `r_${getTypeName({ type })}`
// const getListerFieldName = type => `rl_${getTypeName({ type })}`
const getConnectionFieldName = type => `rl_${getTypeName({ type })}`
// const getCreaterFieldName = type => `c_${getTypeName({ type })}`
// const getUpdaterFieldName = type => `u_${getTypeName({ type })}`
// const getDeleterFieldName = type => `d_${getTypeName({ type })}`
const BaseObjectModel = require('./object-model')
const IDENTITY_FN = value => value
const modelsVersionIdField = {
  name: 'modelsVersionId',
  field: {
    type: GraphQLString
  }
}

function createSchema (opts={}) {
  const { resolvers, objects } = opts
  const models = {}
  const schemas = {}
  const { nodeInterface, nodeField } = GraphQLRelay.nodeDefinitions(
    globalId => {
      const { type, id } = GraphQLRelay.fromGlobalId(globalId)
      const model = getModel(type)
      const key = idToGlobalId(id)
      return getByKey({ model, key })
    },
    obj => {
      const model = getModel(obj[TYPE])
      return getType({ model })
    }
  )

  const getModel = type => {
    const model = models[type]
    if (!model) throw new Error(`model not found: ${type}`)
    return model
  }

  // function createMutationType ({ model }) {
  //   const required = getRequiredProperties({ model })
  //   const { properties } = model
  //   const propertyNames = getOnCreateProperties({ model, models })
  //   const { id } = model
  //   const type = getType({ model })
  //   const args = {}
  //   propertyNames.forEach(propertyName => {
  //     const property = properties[propertyName]
  //     args[propertyName] = createMutationProperty({
  //       propertyName,
  //       property,
  //       model,
  //       required
  //     })

  //     return args
  //   })

  //   return {
  //     type,
  //     description: `Add a ${id}`,
  //     args,
  //     resolve: getMutater({ model })
  //   }
  // }

  // function createMutationProperty ({ propertyName, property, model, required }) {
  //   const { type } = getFieldType({
  //     propertyName,
  //     property,
  //     model,
  //     operator,
  //     isRequired: required.indexOf(propertyName) !== -1
  //   })

  //   return {
  //     name: getTypeName(propertyName),
  //     description: property.description,
  //     type,
  //     // resolve: getMutater({ model })
  //     // resolve: function () {
  //     //   throw new Error('implement me')
  //     // }
  //   }
  // }

  // function validateMutation ({ model, props }) {
  //   // TODO: strip metadata props, then validate
  //   // return validateResource({
  //   //   models,
  //   //   resource: props
  //   // })
  // }

  // const getMutater = memoizeByModel(function ({ model }) {
  //   return co(function* (root, props) {
  //     validateMutation({ model, props })
  //     return resolvers.update({ model, props })
  //   })
  // })

  const getGetter = memoizeByModel(function ({ model }) {
    const blProps = getBacklinkProperties(model)
    return co(function* (root, props, context, info) {
      const fields = graphqlFields(info)
      const select = _.difference(Object.keys(fields), blProps)
      if (select.every(prop => prop in props)) {
        return props
      }

      if (isProbablyResourceStub(props)) {
        return getByStub({ model, stub: props })
      }

      if (props._link) {
        return resolvers.getByLink(props._link)
      }

      return getByKey({ model, key: props })
    })
  })

  function getByStub ({ model, stub }) {
    return resolvers.getByLink(parseStub(stub).link)
  }

  const getByKey = co(function* ({ model, key }) {
    // TODO: add ProjectionExpression with attributes to fetch
    key[TYPE] = model.id
    return resolvers.get({ model, key })
  })

  const getBacklinkResolver = function ({ sourceModel, targetModel, linkProp, backlinkProp }) {
    // return createBatchResolver(co(function* (target, args, context, info) {
    return co(function* (target, args, context, info) {
      normalizeNestedProps({ model: sourceModel, args })
      return fetchList({
        backlink: {
          target,
          forward: {
            model: sourceModel,
            propertyName: linkProp
          },
          back: {
            model: targetModel,
            propertyName: backlinkProp
          }
        },
        model: sourceModel,
        // graphql "source" (not backlink source)
        source: target,
        args: _.merge(args, {
          filter: {
            EQ: {
              [`${linkProp}._permalink`]: target._permalink
            }
          }
        }),
        info
      })
    })
  }

  const fetchList = (opts) => {
    const { args, info, model } = opts
    const { first, last, limit, checkpoint, orderBy, filter } = args
    if (checkpoint) {
      opts.checkpoint = positionFromCursor(checkpoint)
    }

    const fields = graphqlFields(info)
    opts.select = Object.keys(fields.edges.node).filter(prop => prop !== 'id')
    opts.limit = limit || first || last
    opts.orderBy = orderBy
    opts.filter = filter
    return resolvers.list(opts).then(result => {
      debug(`fetched ${result.items.length} for ${info.fieldName}`)
      return connectionToArray(result, args)
    })
  }

  const itemToEdge = ({ item, args, itemToPosition }) => {
    const edge = { node: item }
    if (itemToPosition) {
      edge.cursor = positionToCursor(itemToPosition(item))
    }

    return edge
  }

  const connectionToArray = (result, args) => {
    const { items, startPosition, endPosition, itemToPosition } = result
    const limit = args.limit || args.first || args.last
    const checkpoint = args.checkpoint || args.before || args.after
    const { orderBy={} } = args
    const edges = items.map(item => itemToEdge({ item, args, itemToPosition }))
    const hasNextPage = !orderBy.desc && typeof limit === 'number' ? edges.length === limit : false
    const hasPreviousPage = orderBy.desc && typeof limit === 'number' ? edges.length === limit : false
    let startCursor = null
    let endCursor = null
    if (edges.length) {
      if (startPosition) startCursor = positionToCursor(startPosition)
      if (endPosition) endCursor = positionToCursor(endPosition)
    }

    return {
      edges,
      pageInfo: {
        startCursor,
        endCursor,
        // hasPreviousPage: typeof last === 'number' ? !!after : false,
        hasPreviousPage,
        hasNextPage
      }
    }
  }

  // const getLinkResolver = memoizeByModel(function ({ model }) {
  //   return function (source, args, context, info) {
  //     const { fieldName } = info
  //     const stub = source[fieldName]
  //     return getByStub({ model, stub })
  //   }
  // })

  const listByLinks = co(function* (source, args, context, info) {
    const { links=[], typed=[] } = args
    // const all = links.map(link => ({ link })).concat(typed)
    // const results = yield Promise.all(({ type, link })
      // .map(link => resolvers.getByLink(link)))

    const results = yield allSettled(links.map(link => resolvers.getByLink(link)))
    return {
      objects: results.map(({ value }) => value)
    }
  })

  const getLister = memoizeByModel(function ({ model }) {
    return (source, args, context, info) => {
      args = _.cloneDeep(args)
      normalizeNestedProps({ model, args })
      return fetchList({ model, source, args, context, info })
    }
  })

  // function getPrimaryKeyProps (props) {
  //   return _.pick(props, PRIMARY_KEY_PROPS)
  // }

  // function sanitizeEnumValueName (id) {
  //   return id.replace(/[^_a-zA-Z0-9]/g, '_')
  // }

  const getEnumType = memoizeByModelAndInput(function ({ model, operator }) {
    if (isGoodEnumModel(model)) {
      return operator ? EnumType.input : EnumType.output
    }

    return GraphQLJSON
  })

  const getType = _.memoize(function ({ model, operator, inlined, backlink }) {
    if (isEnum(model)) {
      return getEnumType({ model, operator })
    }

    let ctor
    if (operator) {
      ctor = GraphQLInputObjectType
    } else if (backlink || isInstantiable(model)) {
      ctor = GraphQLObjectType
    } else {
      return operator ? ResourceStubType.input : ResourceStubType.output
      // wrapInterfaceConstructor({ model })
    }

    return new ctor({
      name: getTypeName({
        model,
        operatorType: operator && getOperatorType(operator),
        inlined
      }),
      description: model.description,
      interfaces: getInterfaces({ model, operator }),
      fields: () => getFields({ model, operator, inlined })
    })
  }, opts => {
    return [opts.model.id, getOperatorType(opts.operator) || '', getInlinedMarker(opts.inlined), getBacklinkMarker(opts.inlined)].join('~')
  })

  const getConnectionType = ({ model, backlink }) =>
    getConnectionDefinition({ model, backlink }).connectionType

  // const getEdgeType = ({ model }) =>
  //   getConnectionDefinition({ model }).edgeType

  const getConnectionDefinition = memoizeByModel(opts => {
    const nodeType = getType(opts)
    return GraphQLRelay.connectionDefinitions({
      name: nodeType.name,
      nodeType
      // fields: {
      //   edges: getEdge({ model }),
      //   pageInfo: new GraphQLNonNull(PageInfoType)
      // }
    })
  })

  function wrapInterfaceConstructor ({ model }) {
    return function (opts) {
      opts.resolveType = data => {
        return getType({ model: models[data[TYPE]] })
      }

      return new GraphQLInterfaceType(opts)
    }
  }

  function getInterfaces ({ model, operator }) {
    const { interfaces=[] } = model
    const myInterfaces = interfaces.filter(isGoodInterface).map(type => {
      return getType({ model: models[type], operator })
    })

    if (isNodeModel(model)) {
      myInterfaces.push(nodeInterface)
    }

    return myInterfaces
  }

  const getOperatorFields = memoizeByModel(({ model }) => {
    return {
      filter: {
        type: getFilterField({ model })
      },
      orderBy: {
        type: getOrderByField({ model })
      },
      [modelsVersionIdField.name]: modelsVersionIdField.field
      // limit: {
      //   type: GraphQLInt
      // }
    }
  })

  const getArgs = getOperatorFields
  const getFilterField = memoizeByModel(({ model }) => {
    const typeName = getTypeName({ model })
    return new GraphQLInputObjectType({
      name: `filter_${typeName}`,
      fields: () => {
        const selector = getSelectorOperatorField({ model, operator: 'IN' })
        const fields = {
          IN: {
            type: selector
          },
          NOT_IN: {
            type: selector
          },
          BETWEEN: {
            type: selector
          }
        }

        const NULL = getNullOperatorField({ model })
        if (NULL) {
          fields.NULL = {
            type: NULL
          }
        }

        const SUBCLASS_OF = getSubclassOfField({ model })
        if (SUBCLASS_OF) {
          fields.SUBCLASS_OF = {
            type: SUBCLASS_OF
          }
        }

        OPERATOR_NAMES.forEach(operator => {
          if (!fields[operator]) {
            fields[operator] = {
              type: getType({ model, operator })
            }
          }
        })

        return fields
      }
    })
  })

  const getSubclassOfField = memoizeByModel(({ model, operator='SUBCLASS_OF' }) => {
    const { properties } = model
    const propertyNames = getProperties(model)
      .filter(propertyName => {
        const { range } = properties[propertyName]
        if (range !== 'model') return

        if (!propertyName.includes('.')) return true

        const parent = properties[propertyName.split('.')[0]]
        const ref = getRef(parent)
        const model = models[ref]
        if (model) {
          return model.abstract || model.isInterface
        }
      })

    if (!propertyNames.length) return

    return new GraphQLInputObjectType({
      name: `${operator}_${getTypeName({ model })}`,
      fields: () => {
        const fields = {}
        propertyNames.forEach(propertyName => {
          fields[getFieldName(propertyName)] = wrappers.StringList
        })

        return fields
      }
    })
  })

  const getNullOperatorField = memoizeByModelAndOperator(({ model, operator='NULL' }) => {
    const { properties } = model
    const required = getRequiredProperties({ model })
    // exclude "required" as they are required to be not null
    const propertyNames = getProperties(model)
      .filter(propertyName => !required.includes(propertyName))

    if (!propertyNames.length) return

    return new GraphQLInputObjectType({
      name: `${operator}_${getTypeName({ model })}`,
      fields: () => {
        const fields = {}
        propertyNames.forEach(propertyName => {
          fields[getFieldName(propertyName)] = wrappers.Boolean
        })

        return fields
      }
    })
  })

  const getSelectorOperatorField = memoizeByModel(({ model, operator }) => {
    const { properties } = model
    const propertyNames = getProperties(model)
    return new GraphQLInputObjectType({
      name: `selector_${getTypeName({ model })}`,
      fields: () => {
        const fields = {}
        propertyNames.forEach(propertyName => {
          const property = properties[propertyName]
          if (property.type === 'array') return

          if (isScalarProperty(property)) {
            const fieldName = getFieldName(propertyName)
            fields[fieldName] = createField({
              propertyName,
              property: _.extend({}, property, {
                type: 'array',
                items: {
                  type: property.type
                }
              }),
              model,
              operator
            })

            return
          }
        })

        return fields
      }
    })
  })

  const getOrderByField = ({ model }) => {
    return new GraphQLInputObjectType({
      name: `orderby_${getTypeName({ model })}`,
      fields: {
        property: {
          type: getPropertiesEnumType({ model })
        },
        desc: wrappers.Boolean
      }
    })
  }

  const getPropertiesEnumType = memoizeByModel(({ model }) => {
    const values = {}
    const { properties } = model
    for (let propertyName in properties) {
      let property = properties[propertyName]
      let fieldName = getFieldName(propertyName)
      values[fieldName] = { value: fieldName }
    }

    const typeName = getTypeName({ model })
    return new GraphQLEnumType({
      name: `properties_${typeName}`,
      values
    })
  })

  const isNodeModel = model => !model.inlined
  const isNestedProperty = propertyName => propertyName.indexOf('.') !== -1

  // doesn't benefit from memoization
  const getFields = ({ model, operator, inlined }) => {
    const required = operator ? [] : getRequiredProperties({ model, inlined })
    const { properties } = model
    const fields = {}
    const isInput = !!operator
    const propertyNames = getProperties(model)
      .filter(propertyName => {
        // only allow nested on input types
        if (!isInput && isNestedProperty(propertyName)) {
          return
        }

        return !isInput ||
          // operators with type 'any' can compare both objects and scalars
          OPERATORS[operator].type === 'any' ||
          isScalarProperty(properties[propertyName])
      })

    propertyNames.forEach(propertyName => {
      const property = properties[propertyName]
      fields[getFieldName(propertyName)] = createField({
        propertyName,
        property,
        model,
        required,
        operator
      })
    })

    if (!isInput && isNodeModel(model)) {
      fields.id = getGlobalIdField(model)
    }

    return fields
  }

  const getGlobalId = ({ model, resource }) => {
    return new Buffer(stableStringify(getPrimaryKeys({ model, resource }))).toString('base64')
  }

  const idToGlobalId = (id) => {
    return JSON.parse(new Buffer(id, 'base64').toString())
  }

  const getGlobalIdField = _.memoize(
    model => GraphQLRelay.globalIdField(model.id, resource => getGlobalId({ model, resource })),
    model => model.id
  )

  const getFieldName = _.memoize(propertyName => propertyName.split('.').join(NESTED_PROP_SEPARATOR))
  const createField = _.memoize(function ({
    propertyName,
    property,
    model,
    required=[],
    operator
  }) {
    const field = getFieldType({
      propertyName,
      property,
      model,
      isRequired: required.indexOf(propertyName) !== -1,
      operator
    })

    return _.extend({}, field, _.pick(property, 'description'))
  }, opts => `${opts.operator ? 'i' : 'o'}~${opts.model.id}~${opts.propertyName}~${opts.operator||''}`)

  const getNonNull = _.memoize(type => new GraphQLNonNull(type))

  function getFieldType (propertyInfo) {
    const { property, isRequired } = propertyInfo
    const fType = _.clone(_getFieldType(propertyInfo))
    if (isRequired || !isNullableProperty(property)) {
      fType.type = getNonNull(fType.type)
    }

    return fType
  }

  function _getFieldType ({ propertyName, property, model, isRequired, operator }) {
    const { type, range } = property
    if (range === 'json') {
      return wrappers.JSON
    }

    const scalar = wrappers[type]
    if (scalar) return scalar

    if (type === 'object') {
      return getObjectValueType({
        model,
        propertyName,
        property,
        operator
      })
    }

    if (type === 'array') {
      return getArrayValueType({
        model,
        propertyName,
        property,
        operator
      })
    }

    throw new Error(`${model.id} property ${propertyName} has unexpected type: ${type}`)
  }

  function getObjectValueType (opts) {
    return getRefType(opts)
  }

  function getArrayValueType (opts) {
    const { model, propertyName, property, operator } = opts
    if (getRef(property)) {
      // backlink or array of forward links
      return getRefType(opts)
    }

    if (property.items.properties) {
      // inlined type unique to this model
      return {
        type: toListType(getType({
          model: {
            id: model.id + '_' + propertyName,
            properties: property.items.properties
          },
          operator
        }))
      }
    }

    // array of a primitive type
    return {
      type: toListType(getFieldType({
        model,
        propertyName,
        property: property.items,
        operator
      }).type)
    }
  }

  const PageInfoType = new GraphQLObjectType({
    name: 'PageInfo',
    fields: {
      hasNextPage: GraphQLBoolean,
      hasPreviousPage: GraphQLBoolean,
      startCursor: GraphQLString,
      endCursor: GraphQLString
    }
  })


  const getConnectionArgs = memoizeByModel(({ model }) => {
    const cArgs = _.extend({}, getArgs({ model }), connectionArgs)
    cArgs.limit = connectionArgs.first
    cArgs.checkpoint = connectionArgs.after
    return cArgs
  })

  // const createWrappedMutationType = function createWrappedMutationType ({ model }) {
  //   return new GraphQLInputObjectType({
  //     name: getTypeName({ model }),
  //     description: model.description,
  //     fields: _.extend({
  //       object: createMutationType({ model }),
  //     }, metadataTypes),
  //     // args: () => _.extend({
  //     //   object: createMutationType({ model }),
  //     // }, basePropsArgs)
  //   })
  // }

  // const MutationType = new GraphQLObjectType({
  //   name: 'Mutation',
  //   fields: () => {
  //     const fields = {}
  //     Object.keys(models).forEach(id => {
  //       const model = models[id]
  //       fields[getCreaterFieldName(id)] = createWrappedMutationType({ model })
  //       return fields
  //     })

  //     return fields
  //   }
  // })

  function getRefType ({ propertyName, property, model, operator }) {
    const ref = getRef(property)
    const range = models[ref]
    if (!range) {
      return wrappers.JSON
    }

    const maybeToList = property.type === 'array' ? toListType : IDENTITY_FN
    if (range.subClassOf === 'tradle.Enum') {
      return {
        type: maybeToList(getEnumType({ model: range, operator }))
      }
    }

    if (isInlinedProperty({ models, property })) {
      if (isInstantiable(range)) {
        return {
          type: maybeToList(getType({ model: range, operator, inlined: true }))
        }
      }

      // ideally we would want to return a json with _t required
      // and an arbitrary set of other props
      return wrappers.JSON
    }

    // input
    if (operator) {
      return wrappers.ResourceStubInput
    }

    // output
    // e.g. interface or abstract class
    if (!isInstantiable(range) && !isBacklink(property)) {
      debug(`not sure how to handle property ${model.id}.${propertyName} with range ${ref}`)
      return {
        type: maybeToList(ResourceStubType.output)
      }
    }

    const ret = {}
    if (property.type === 'array') {
      if (property.items.backlink) {
        ret.type = getConnectionType({ model: range, backlink: true })
        ret.resolve = getBacklinkResolver({
          sourceModel: range,
          targetModel: model,
          linkProp: property.items.backlink,
          backlinkProp: propertyName
        })

        ret.args = getConnectionArgs({ model: range })
      } else {
        ret.type = toListType(ResourceStubType.output)
      }
    } else {
      ret.type = ResourceStubType.output
      // ret.resolve = getLinkResolver({ model: range })
    }

    return ret
  }


  const basePropsTypes = getFields({ model: BaseObjectModel })
  // const basePropsArgs = toNonNull(basePropsTypes)
  const linkPropsArgs = _.pick(basePropsTypes, linkProps)
  const addModels = newBatch => {
    newBatch = normalizeModels(newBatch, models)
    const ids = Object.keys(newBatch)
    for (const id of ids) {
      if (id in models) {
        if (_.isEqual(models[id], newBatch)) {
          delete newBatch[id]
        }
      } else {
        // lazy
        defineGetter(schemas, id, () => getType({ model: models[id] }))
      }
    }

    getInstantiableModels(newBatch).forEach(id => {
      const model = newBatch[id]
      const type = getType({ model })
      queryTypeFields[getGetterFieldName(id)] = {
        type,
        args: linkPropsArgs,
        resolve: getGetter({ model })
      }

      queryTypeFields[getConnectionFieldName(id)] = {
        type: getConnectionType({ model }),
        args: getConnectionArgs({ model }),
        resolve: getLister({ model })
      }
    })

    _.extend(models, newBatch)
    return api
  }

  const objectListType = new GraphQLObjectType({
    name: 'rl_objects',
    fields: {
      objects: wrappers.JSON
    }
  })

  const rl_objects = {
    type: objectListType,
    args: {
      links: wrappers.StringList,
      // typed: new GraphQLInputObjectType({
      //   name: 'rl_objects_args_typed',
      //   fields: {
      //     type: GraphQLString,
      //     link: GraphQLString
      //   }
      // })
    },
    resolve: listByLinks
  }

  const queryTypeFields = {
    node: nodeField,
    [modelsVersionIdField.name]: modelsVersionIdField.field,
    rl_objects
  }

  /**
   * This is the type that will be the root of our query,
   * and the entry point into our schema.
   */
  const QueryType = new GraphQLObjectType({
    name: 'Query',
    fields: () => queryTypeFields
  })

  const api = {
    get schema() {
      return new GraphQLSchema({
        query: QueryType,
        // mutation: MutationType,
        // types: _.values(TYPES)
      })
    },
    schemas,
    addModels
  }

  if (opts.models) {
    addModels(opts.models)
  }

  return api
}

function getInlinedMarker (inlined) {
  return inlined ? 'in' : 'out'
}

function getBacklinkMarker (backlink) {
  return backlink ? 'b' : ''
}

function alwaysTrue () {
  return true
}

function isGoodInterface (id) {
  return USE_INTERFACES &&
    id !== 'tradle.ChatItem' &&
    id !== 'tradle.Document'
}

function positionToCursor (position) {
  return CURSOR_PREFIX + new Buffer(JSON.stringify(position)).toString('base64')
}

function positionFromCursor (cursor) {
  const pos = cursor.slice(CURSOR_PREFIX.length)
  return JSON.parse(new Buffer(pos, 'base64'))
  // return GraphQLRelay.fromGlobalId(globalId).id
}

function firstPropertyValue (obj) {
  for (let key in obj) return obj[key]
}

function toListType (type) {
  return new GraphQLList(type)
}

function isBacklink (property) {
  return property.items && property.items.backlink
}

module.exports = createSchema

