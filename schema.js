const co = require('co').wrap
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
const {
  isInlinedProperty,
  isInstantiable,
  isEnum
} = require('@tradle/validate-resource').utils
const buildResource = require('@tradle/build-resource')
const OPERATORS = require('./operators')
const {
  normalizeModels,
  getTypeName,
  isResourceStub,
  isNullableProperty,
  isScalarProperty,
  isGoodEnumModel,
  isBadEnumModel,
  fromResourceStub,
  getInstantiableModels,
  getOnCreateProperties,
  getProperties,
  getRequiredProperties,
  getRef,
  normalizeNestedProps,
  cachify,
  toNonNull,
  getValues,
  shallowClone,
  extend,
  pick,
  omit,
  clone,
  debug
} = require('./utils')

const USE_INTERFACES = false
const TYPE = '_t'
const primaryKeys = ['_link']
const { TimestampType, BytesType, ResourceStubType } = require('./types')
const { NESTED_PROP_SEPARATOR, RESOURCE_STUB_PROPS } = require('./constants')
const StringWrapper = { type: GraphQLString }
// TODO: use getFields for this

const OPERATOR_NAMES = Object.keys(OPERATORS)
// const SCALAR_OPERATORS = Object.keys(OPERATORS)
//   .filter(name => OPERATORS[name].scalar)

const CURSOR_PREFIX = ''// new Buffer('cursor:').toString('base64')
const getGetterFieldName = type => `r_${getTypeName({ type })}`
// const getListerFieldName = type => `rl_${getTypeName({ type })}`
const getConnectionFieldName = type => `rl_${getTypeName({ type })}`
const getCreaterFieldName = type => `c_${getTypeName({ type })}`
const getUpdaterFieldName = type => `u_${getTypeName({ type })}`
const getDeleterFieldName = type => `d_${getTypeName({ type })}`
const BaseObjectModel = require('./object-model')
const IDENTITY_FN = value => value

function createSchema ({ resolvers, objects, models }) {
  const TYPES = {}
  models = normalizeModels(models)

  const { nodeInterface, nodeField } = GraphQLRelay.nodeDefinitions(
    globalId => {
      const { type, id } = GraphQLRelay.fromGlobalId(globalId)
      const model = getModel(type)
      const key = idToPrimaryKey(id)
      return resolvers.get({ model, key })
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
  //   const required = getRequiredProperties(model)
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

  // const getMutater = cachifyByModel(function ({ model }) {
  //   return co(function* (root, props) {
  //     validateMutation({ model, props })
  //     return resolvers.update({ model, props })
  //   })
  // })

  const getGetter = cachifyByModel(function ({ model }) {
    return co(function* (root, props) {
      if (isResourceStub(props)) {
        return getByStub({ model, stub: props })
      }

      return getByPrimaryKey({ model, props })
    })
  }, TYPES)

  function getByStub ({ model, stub }) {
    return getByPrimaryKey({
      model,
      props: fromResourceStub(stub)
    })
  }

  const getByPrimaryKey = co(function* ({ model, key, props }) {
    if (!key) key = pick(props, primaryKeys)

    if (typeof key === 'object' && primaryKeys.length === 1) {
      key = firstPropertyValue(key)
    }

    // TODO: add ProjectionExpression with attributes to fetch
    return resolvers.get({ model, key })
  })

  const getBacklinkResolver = cachifyByModel(function ({ model }) {
    return co(function* (source, args, context, info) {
      const type = source[TYPE]
      const model = models[type]
      const { fieldName } = info
      const backlinkProp = model.properties[fieldName]
      const ref = getRef(backlinkProp)
      const backlinkModel = models[ref]
      if (!(backlinkModel && isInstantiable(backlinkModel))) {
        debug(`unable to resolve backlink: ${model.id}.${fieldName}`)
        return []
      }

      const { backlink } = backlinkProp.items
      const backlinkDotId = `${backlink}.id`
      return fetchList({
        model: backlinkModel,
        source,
        args: {
          filter: {
            EQ: {
              [backlinkDotId]: buildResource.id({
                model,
                resource: source
              })
            }
          }
        },
        info
      })
    })
  })

  const fetchList = (opts) => {
    const { args, info } = opts
    const { first, after, orderBy, filter } = args
    if (after) {
      opts.after = positionFromCursor(after)
    }

    const fields = graphqlFields(info)
    opts.select = omit(fields.edges.node, ['id'])
    opts.limit = first
    opts.orderBy = orderBy
    opts.filter = filter
    return resolvers.list(opts).then(result => {
      debug(`fetched ${result.items.length} for ${info.fieldName}`)
      return connectionToArray(result, args)
    })
  }

  const itemToEdge = ({ item, args, itemToPosition }) => {
    const position = itemToPosition(item)
    return {
      cursor: positionToCursor(position),
      node: item
    }
  }

  const connectionToArray = (result, args) => {
    const { items, startPosition, endPosition, itemToPosition } = result
    const { first, last, after } = args
    const edges = items.map(item => itemToEdge({ item, args, itemToPosition }))
    return {
      edges,
      pageInfo: {
        startCursor: edges.length ? positionToCursor(startPosition) : null,
        endCursor: edges.length ? positionToCursor(endPosition) : null,
        hasPreviousPage: typeof last === 'number' ? !!after : false,
        hasNextPage: typeof first === 'number' ? edges.length === first : false
      }
    }
  }

  const getLinkResolver = cachifyByModel(function ({ model }) {
    return function (source, args, context, info) {
      const { fieldName } = info
      const stub = source[fieldName]
      return getByStub({ model, stub })
    }
  })

  const getLister = cachifyByModel(function ({ model }) {
    return (source, args, context, info) => {
      args = clone(args)
      normalizeNestedProps({ model, args })
      return fetchList({ model, source, args, context, info })
    }
  })

  // function getPrimaryKeyProps (props) {
  //   return pick(props, PRIMARY_KEY_PROPS)
  // }

  // function sanitizeEnumValueName (id) {
  //   return id.replace(/[^_a-zA-Z0-9]/g, '_')
  // }

  const getEnumType = cachifyByModelAndInput(function ({ model, operator }) {
    if (isGoodEnumModel(model)) {
      return getResourceStubType({ operator })
    }

    return GraphQLJSON
  })

  function getResourceStubType ({ operator }) {
    return operator ? ResourceStubType.input : ResourceStubType.output
  }

  const getType = cachifyByModelAndOperatorType(function ({ model, operator }) {
    if (isEnum(model)) {
      return getEnumType({ model, operator })
    }

    let ctor
    if (operator) {
      ctor = GraphQLInputObjectType
    } else if (isInstantiable(model)) {
      ctor = GraphQLObjectType
    } else {
      return operator ? ResourceStubType.input : ResourceStubType.output
      // wrapInterfaceConstructor({ model })
    }

    return new ctor({
      name: getTypeName({ model, operator }),
      description: model.description,
      interfaces: getInterfaces({ model, operator }),
      fields: () => getFields({ model, operator })
    })
  })

  const getConnectionType = ({ model }) =>
    getConnectionDefinition({ model }).connectionType

  // const getEdgeType = ({ model }) =>
  //   getConnectionDefinition({ model }).edgeType

  const getConnectionDefinition = cachifyByModel(({ model }) => {
    return GraphQLRelay.connectionDefinitions({
      name: getTypeName({ model }),
      nodeType: getType({ model })
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

  const getOperatorFields = cachifyByModel(function ({ model }) {
    return {
      filter: {
        type: getFilterField({ model })
      },
      orderBy: {
        type: getOrderByField({ model })
      },
      // limit: {
      //   type: GraphQLInt
      // }
    }
  })

  const getArgs = getOperatorFields
  const getFilterField = cachifyByModel(function ({ model }) {
    return new GraphQLInputObjectType({
      name: 'filter_' + getTypeName({ model }),
      fields: () => {
        const fields = {
          IN: {
            type: getSelectorOperatorField({ model, operator: 'IN' })
          },
          BETWEEN: {
            type: getSelectorOperatorField({ model, operator: 'BETWEEN' })
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

  const getSelectorOperatorField = cachify(function ({ model, operator }) {
    const { properties } = model
    const propertyNames = getProperties(model)
    return new GraphQLInputObjectType({
      name: `${operator}_${getTypeName({ model })}`,
      fields: () => {
        const fields = {}
        propertyNames.forEach(propertyName => {
          const property = properties[propertyName]
          if (property.type === 'array') return

          if (isScalarProperty(property)) {
            const fieldName = getFieldName(propertyName)
            fields[fieldName] = createField({
              propertyName,
              property: shallowClone(property, {
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
  }, ({ model, operator }) => `${model.id}~${operator}`)

  const getOrderByField = function getOrderByField ({ model }) {
    return new GraphQLInputObjectType({
      name: `orderby_${getTypeName({ model })}`,
      fields: {
        property: {
          type: getPropertiesEnumType({ model })
        },
        desc: {
          type: GraphQLBoolean
        }
      }
    })
  }

  const getPropertiesEnumType = cachifyByModel(function ({ model }) {
    const values = {}
    const { properties } = model
    for (let propertyName in properties) {
      let property = properties[propertyName]
      fieldName = getFieldName(propertyName)
      values[fieldName] = { value: fieldName }
    }

    return new GraphQLEnumType({
      name: 'properties_' + getTypeName({ model }),
      values
    })
  })

  function isNodeModel (model) {
    return !model.inlined
  }

  function isNestedProperty (propertyName) {
    return propertyName.indexOf('.') !== -1
  }

  function getFields ({ model, operator }) {
    const required = operator ? [] : getRequiredProperties(model)
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
      fields.id = GraphQLRelay.globalIdField(model.id, getPrimaryKey)
    }

    return fields
  }

  function getFieldName (propertyName) {
    return propertyName.split('.').join(NESTED_PROP_SEPARATOR)
  }

  const createField = cachify(function ({
    propertyName,
    property,
    model,
    required=[],
    operator
  }) {
    const { description } = property
    const { type, resolve } = getFieldType({
      propertyName,
      property,
      model,
      isRequired: required.indexOf(propertyName) !== -1,
      operator
    })

    const field = { type }
    if (resolve) field.resolve = resolve
    if (description) field.description = description

    return field
  }, ({
    model,
    propertyName,
    operator
  }) => `${operator ? 'i' : 'o'}~${model.id}~${propertyName}~${operator||''}`)

  function getFieldType (propertyInfo) {
    const { property, isRequired } = propertyInfo
    let { type, resolve } = _getFieldType(propertyInfo)
    if (isRequired || !isNullableProperty(property)) {
      type = new GraphQLNonNull(type)
    }

    return { type, resolve }
  }

  function _getFieldType ({ propertyName, property, model, isRequired, operator }) {
    const { type, range } = property
    if (range === 'json') {
      return { type: GraphQLJSON }
    }

    switch (type) {
      case 'bytes':
        return { type: BytesType }
      case 'string':
        return StringWrapper
      case 'boolean':
        return { type: GraphQLBoolean }
      case 'number':
        return { type: GraphQLFloat }
      case 'date':
        return { type: TimestampType }
      case 'object':
        return getObjectValueType({
          model,
          propertyName,
          property,
          operator
        })
      case 'array':
        return getArrayValueType({
          model,
          propertyName,
          property,
          operator
        })
      case 'enum':
        return { type: GraphQLString }
      default:
        throw new Error(`${model.id} property ${propertyName} has unexpected type: ${type}`)
    }
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

  /**
   * This is the type that will be the root of our query,
   * and the entry point into our schema.
   */
  const QueryType = new GraphQLObjectType({
    name: 'Query',
    fields: () => {
      const fields = {
        node: nodeField
      }

      getInstantiableModels(models).forEach(id => {
        const model = models[id]
        const type = getType({ model })
        fields[getGetterFieldName(id)] = {
          type,
          args: primaryKeyArgs,
          resolve: getGetter({ model })
        }

        fields[getConnectionFieldName(id)] = {
          type: getConnectionType({ model }),
          args: getConnectionArgs({ model }),
          resolve: getLister({ model })
        }
      })

      return fields
    }
  })

  const getConnectionArgs = cachifyByModel(({ model }) => {
    return extend(
      getArgs({ model }),
      GraphQLRelay.connectionArgs
    )
  })

  // const createWrappedMutationType = function createWrappedMutationType ({ model }) {
  //   return new GraphQLInputObjectType({
  //     name: getTypeName({ model }),
  //     description: model.description,
  //     fields: extend({
  //       object: createMutationType({ model }),
  //     }, metadataTypes),
  //     // args: () => extend({
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

  const schemas = {}
  Object.keys(models).forEach(id => {
    // lazy
    schemas.__defineGetter__(id, () => {
      return getType({ model: models[id] })
    })
  })

  function getRefType ({ propertyName, property, model, operator }) {
    const ref = getRef(property)
    const range = models[ref]
    if (!range) {
      return { type: GraphQLJSON }
    }

    if (range.subClassOf === 'tradle.Enum') {
      return { type: getEnumType({ model: range, operator }) }
    }

    const maybeToList = property.type === 'array' ? toListType : IDENTITY_FN
    if (isInlinedProperty({ models, property })) {
      if (isInstantiable(range)) {
        return { type: getType({ model: range, operator }) }
      }

      // ideally we would want to return a json with _t required
      // and an arbitrary set of other props
      return { type: GraphQLJSON }
    }

    // input
    if (operator) {
      return { type: ResourceStubType.input }
    }

    // output
    // e.g. interface or abstract class
    if (!isInstantiable(range)) {
      debug(`not sure how to handle property ${model.id}.${propertyName} with range ${ref}`)
      return {
        type: maybeToList(ResourceStubType.output)
      }
    }

    const ret = {}
    if (property.type === 'array') {
      if (property.items.backlink) {
        ret.type = getConnectionType({ model: range })
        ret.resolve = getBacklinkResolver({ model: range })
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
  const primaryKeyArgs = toNonNull(pick(basePropsTypes, primaryKeys))
  const schema = new GraphQLSchema({
    query: QueryType,
    // mutation: MutationType,
    types: getValues(TYPES)
  })

  return {
    schema,
    schemas
  }
}

function cachifyByModel (fn, cache={}) {
  return cachify(fn, ({ model }) => model.id, cache)
}

function cachifyByModelAndOperatorType (fn, cache={}) {
  return cachify(fn, ({ model, operator }) => {
    let operatorType = 'n/a'
    if (operator) {
      if (OPERATORS[operator].scalar) {
        operatorType = 'scalar'
      } else {
        operatorType = 'any'
      }
    }

    return `${operatorType}~${model.id}`
  }, cache)
}

function cachifyByModelAndInput (fn, cache={}) {
  return cachify(fn, ({ model, operator }) => {
    // i for input, o for output
    return `${operator ? 'i' : 'o'}~${model.id}`
  }, cache)
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

function getPrimaryKey (item) {
  return item._link
}

function idToPrimaryKey (id) {
  return { _link: id }
}

function firstPropertyValue (obj) {
  for (let key in obj) return obj[key]
}

function toListType (type) {
  return new GraphQLList(type)
}

module.exports = createSchema
