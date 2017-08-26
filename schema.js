const co = require('co').wrap
const debug = require('debug')(require('./package.json').name)
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
  clone
} = require('./utils')

const USE_INTERFACES = false
const TYPE = '_t'
const primaryKeys = ['_link']
const { TimestampType, BytesType, ResourceStubType } = require('./types')
const { NESTED_PROP_SEPARATOR } = require('./constants')
const StringWrapper = { type: GraphQLString }
// TODO: use getFields for this

const SCALAR_OPERATORS = Object.keys(OPERATORS)
  .filter(name => OPERATORS[name].scalar)

const ResourceStubProps = {
  id: {
    type: 'string'
  },
  title: {
    type: 'string'
  }
}

const CURSOR_PREFIX = ''// new Buffer('cursor:').toString('base64')
const getGetterFieldName = type => `r_${getTypeName({ type })}`
// const getListerFieldName = type => `rl_${getTypeName({ type })}`
const getConnectionFieldName = type => `rl_${getTypeName({ type })}`
const getCreaterFieldName = type => `c_${getTypeName({ type })}`
const getUpdaterFieldName = type => `u_${getTypeName({ type })}`
const getDeleterFieldName = type => `d_${getTypeName({ type })}`
const BaseObjectModel = require('./object-model')

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
  //     isInput: true,
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

  const getEnumType = cachifyByModelAndInput(function ({ model, isInput }) {
    if (isGoodEnumModel(model)) {
      return getResourceStubType({ isInput })
    }

    return GraphQLJSON
  })

  function getResourceStubType ({ isInput }) {
    return isInput ? ResourceStubType.input : ResourceStubType.output
  }

  const getType = cachifyByModelAndInput(function ({ model, isInput }) {
    if (isEnum(model)) {
      return getEnumType({ model, isInput })
    }

    let ctor
    if (isInput) {
      ctor = GraphQLInputObjectType
    } else if (isInstantiable(model)) {
      ctor = GraphQLObjectType
    } else {
      return isInput ? ResourceStubType.input : ResourceStubType.output
      // wrapInterfaceConstructor({ model })
    }

    return new ctor({
      name: getTypeName({ model, isInput }),
      description: model.description,
      interfaces: getInterfaces({ model, isInput }),
      fields: () => getFields({ model, isInput })
    })
  })

  const getConnectionType = ({ model }) =>
    getConnectionDefinition({ model }).connectionType

  // const getEdgeType = ({ model }) =>
  //   getConnectionDefinition({ model }).edgeType

  const getConnectionDefinition = cachifyByModelAndInput(({ model }) => {
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

  function getInterfaces ({ model, isInput }) {
    const { interfaces=[] } = model
    return interfaces.filter(isGoodInterface).map(type => {
      return getType({ model: models[type], isInput })
    })
    .concat(nodeInterface)
  }

  const getOperatorFields = cachifyByModel(function ({ model }) {
    return {
      filter: {
        type: getFilterField({ model })
      },
      orderBy: {
        type: getOrderByField({ model })
      },
      limit: {
        type: GraphQLInt
      }
    }
  })

  // const getArgs = ({ model }) => getFields({ model, isInput: true })
  const getArgs = getOperatorFields

  const getFilterField = cachifyByModel(function ({ model }) {
    return new GraphQLInputObjectType({
      name: 'filter_' + getTypeName({ model }),
      fields: () => {
        const fields = {
          EQ: {
            type: getEqOperatorField({ model })
          },
          NEQ: {
            type: getEqOperatorField({ model })
          },
          IN: {
            type: getSelectorOperatorField({ model, operator: 'IN' })
          },
          BETWEEN: {
            type: getSelectorOperatorField({ model, operator: 'BETWEEN' })
          }
        }

        SCALAR_OPERATORS.forEach(operator => {
          if (!fields[operator]) {
            fields[operator] = {
              type: getScalarComparatorField({ model, operator })
            }
          }
        })

        return fields
      }
    })
  })

  const getEqOperatorField = function getEqOperatorField ({ model }) {
    return getType({ model, isInput: true })
  }

  const getScalarComparatorField = cachify(function ({ model, operator }) {
    const { properties } = model
    const propertyNames = getProperties(model)
    return new GraphQLInputObjectType({
      name: `${operator}_${getTypeName({ model })}`,
      fields: () => {
        const fields = {}
        propertyNames.forEach(propertyName => {
          const property = properties[propertyName]
          if (!isScalarProperty(property)) return

          fields[propertyName] = createField({
            propertyName,
            property,
            model,
            isInput: true
          })
        })

        return fields
      }
    })
  }, ({ model, operator }) => `${model.id}~${operator}`)

  const getSelectorOperatorField = cachify(function ({ model, operator }) {
    const { properties } = model
    const propertyNames = getProperties(model)
    return new GraphQLInputObjectType({
      name: `${operator}_${getTypeName({ model })}`,
      fields: () => {
        const fields = {}
        propertyNames.forEach(propertyName => {
          let field
          const property = properties[propertyName]
          if (property.type === 'array') return

          fields[propertyName] = createField({
            propertyName,
            property: shallowClone(property, {
              type: 'array',
              items: {
                type: 'string'
              }
            }),
            model,
            isInput: true,
            operator
          })
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
      values[propertyName] = { value: propertyName }
    }

    return new GraphQLEnumType({
      name: 'properties_' + getTypeName({ model }),
      values
    })
  })

  function getFields ({ model, isInput }) {
    const required = isInput ? [] : getRequiredProperties(model)
    const { properties } = model
    const propertyNames = getProperties(model)
    const fields = {}
    if (!isInput) {
      fields.id = GraphQLRelay.globalIdField(model.id, getPrimaryKey)
    }

    propertyNames.forEach(propertyName => {
      let field
      const property = properties[propertyName]
      fields[propertyName] = createField({
        propertyName,
        property,
        model,
        required,
        isInput
      })

      if (!isInput ||
        property.type !== 'object' ||
        property.range === 'json') {
        return
      }

      let nestedProps
      if (isInlinedProperty({ models, property })) {
        const ref = getRef(property)
        if (ref === 'tradle.Model') return

        nestedProps = ref
          ? models[ref].properties
          : property.properties || property.items.properties

      } else {
        nestedProps = ResourceStubProps
      }

      for (let p in nestedProps) {
        let nestedPropertyName = `${propertyName}${NESTED_PROP_SEPARATOR}${p}`
        let field = createField({
          propertyName: nestedPropertyName,
          property: nestedProps[p],
          model,
          // model: {
          //   properties:
          // },
          isInput
        })

        fields[nestedPropertyName] = field

        // let prop = shallowClone(nestedProps[p])
        // prop.nested = true
        // properties[`${propertyName}.${p}`] = prop
      }

    })

    return fields
  }

  const createField = cachify(function ({
    propertyName,
    property,
    model,
    required=[],
    isInput,
    operator
  }) {
    const { description } = property
    const { type, resolve } = getFieldType({
      propertyName,
      property,
      model,
      isRequired: required.indexOf(propertyName) !== -1,
      isInput
    })

    const field = { type }
    if (resolve) field.resolve = resolve
    if (description) field.description = description

    return field
  }, ({
    model,
    propertyName,
    isInput,
    operator
  }) => `${isInput ? 'i' : 'o'}~${model.id}~${propertyName}~${operator||''}`)

  function getFieldType (propertyInfo) {
    const { property, isRequired } = propertyInfo
    let { type, resolve } = _getFieldType(propertyInfo)
    if (isRequired || !isNullableProperty(property)) {
      type = new GraphQLNonNull(type)
    }

    return { type, resolve }
  }

  function _getFieldType ({ propertyName, property, model, isRequired, isInput }) {
    if (propertyName === 'typeOfCoverage') debugger
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
          isInput
        })
      case 'array':
        return getArrayValueType({
          model,
          propertyName,
          property,
          isInput
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
    const { model, propertyName, property, isInput } = opts
    if (getRef(property)) {
      // backlink or array of forward links
      return getRefType(opts)
    }

    if (property.items.properties) {
      // inlined type unique to this model
      return {
        type: new GraphQLList(getType({
          model: {
            id: model.id + '_' + propertyName,
            properties: property.items.properties
          },
          isInput
        }))
      }
    }

    // array of a primitive type
    return {
      type: new GraphQLList(getFieldType({
        model,
        propertyName,
        property: property.items,
        isInput
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
        // fields[getListerFieldName(id)] = {
        //   type: new GraphQLList(type),
        //   args: getArgs({ model }),//  getType({ model, isInput: true }),
        //   resolve: getLister({ model })
        // }

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

  function getRefType ({ propertyName, property, model, isInput }) {
    const ref = getRef(property)
    const range = models[ref]
    if (!range) {
      return { type: GraphQLJSON }
    }

    if (range.subClassOf === 'tradle.Enum') {
      return { type: getEnumType({ model: range, isInput }) }
    }

    if (isInput) {
      return { type: ResourceStubType.input }
    }

    // e.g. interface or abstract class
    if (!isInstantiable(range)) {
      if (isGoodInterface(range.id)) {
        return { type: GraphQLJSON }
      }

      debug(`not sure how to handle property with range ${ref}`)
      return {
        type: getType({ model: range }),
        // resolve: IDENTITY_FN
      }
      // return { type: GraphQLJSON }
    }

    if (isInlinedProperty({ models, property })) {
      return {
        type: getType({ model: range })
      }
    }

    const ret = {}
    if (property.type === 'array') {
      if (property.items.backlink) {
        ret.type = getConnectionType({ model: range })
        ret.resolve = getBacklinkResolver({ model: range })
        ret.args = getConnectionArgs({ model: range })
      } else {
        ret.type = new GraphQLList(ResourceStubType.output)
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

function cachifyByModelAndInput (fn, cache={}) {
  return cachify(fn, ({ model, isInput }) => {
    return `${isInput ? 'i' : 'o'}~${model.id}`
  }, cache)
}

function alwaysTrue () {
  return true
}

function isGoodInterface (id) {
  return USE_INTERFACES &&
    id !== 'tradle.Message' &&
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

module.exports = createSchema
