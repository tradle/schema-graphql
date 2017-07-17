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

const GraphQLJSON = require('graphql-type-json')
const { isInlinedProperty } = require('@tradle/validate-resource').utils
const OPERATORS = require('./operators')
const {
  GraphQLDate,
  // GraphQLTime,
  // GraphQLDateTime
} = require('graphql-iso-date')

const {
  getTypeName,
  isResourceStub,
  isNullableProperty,
  isScalarProperty,
  isGoodEnumModel,
  isBadEnumModel,
  fromResourceStub,
  getInstantiableModels,
  isInstantiable,
  getOnCreateProperties,
  getProperties,
  getRequiredProperties,
  getRef,
  cachify,
  toNonNull,
  getValues,
  shallowClone,
  extend,
  pick,
  lazy
} = require('./utils')

const USE_INTERFACES = false
const TYPE = '_t'
const primaryKeys = ['_link']
const { TimestampType, BytesType, ResourceStubType } = require('./types')
const StringWrapper = { type: GraphQLString }
// TODO: use getFields for this
const metadataTypes = {
  _link: StringWrapper,
  _permalink: StringWrapper,
  _author: StringWrapper,
  _time: { type: TimestampType },
  _min: { type: GraphQLBoolean }
}

const SCALAR_OPERATORS = Object.keys(OPERATORS)
  .filter(name => OPERATORS[name].scalar)

const getGetterFieldName = type => `r_${getTypeName({ type })}`
const getListerFieldName = type => `rl_${getTypeName({ type })}`
const getCreaterFieldName = type => `c_${getTypeName({ type })}`
const getUpdaterFieldName = type => `u_${getTypeName({ type })}`
const getDeleterFieldName = type => `d_${getTypeName({ type })}`
const BaseObjectModel = require('./object-model')

function createSchema ({ resolvers, objects, models }) {
  const TYPES = {}
  // const metadataArgs = toNonNull(metadataTypes)
  const primaryKeyArgs = toNonNull(pick(metadataTypes, primaryKeys))
  const getBaseObjectType = () => getType({ model: BaseObjectModel })

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

    // TODO: add ProjectionExpression with attributes to fetch
    return resolvers.get({ model, key })
  })

  const getBacklinkResolver = cachifyByModel(function ({ model }) {
    return function (source, args, context, info) {
      const type = source[TYPE]
      const { fieldName } = info
      const { backlink } = models[type].properties[fieldName].items
      return resolvers.list({
        model,
        source,
        args: {
          [backlink]: source._link
        }
      })
    }
  })

  const getLinkResolver = cachifyByModel(function ({ model }) {
    return function (source, args, context, info) {
      const { fieldName } = info
      const stub = source[fieldName]
      return getByStub({ model, stub })
    }
  })

  const getLister = cachifyByModel(function ({ model }) {
    return function (source, args, context, info) {
      return resolvers.list({ model, source, args, context, info })
    }
  })

  // function getPrimaryKeyProps (props) {
  //   return pick(props, PRIMARY_KEY_PROPS)
  // }

  // function sanitizeEnumValueName (id) {
  //   return id.replace(/[^_a-zA-Z0-9]/g, '_')
  // }

  const getEnumType = cachifyByModelAndInput(function ({ model, isInput }) {
    const ctor = isInput ? GraphQLInputObjectType : GraphQLObjectType
    return new ctor({
      name: getTypeName({ model, isInput }),
      description: model.description,
      fields: {
        id: {
          type: new GraphQLNonNull(GraphQLString)
        },
        title: StringWrapper
      }
    })

    // TODO: uncomment after enums are refactored
    // to be more like enums and less like resources

    // const values = {}
    // for (const value of model.enum) {
    //   const { id, title } = value
    //   values[sanitizeEnumValueName(id)] = {
    //     value: id,
    //     description: title
    //   }
    // }

    // return new GraphQLEnumType({
    //   name: getTypeName({ model }),
    //   description: model.description,
    //   values
    // })
  })

  const getType = cachifyByModelAndInput(function ({ model, isInput }) {
    if (isGoodEnumModel(model)) {
      return getEnumType({ model, isInput })
    }

    if (isBadEnumModel(model)) {
      debug(`bad enum: ${model.id}`)
      return GraphQLJSON
    }

    let ctor
    if (isInput) {
      ctor = GraphQLInputObjectType
    } else if (isInstantiable(model)) {
      ctor = GraphQLObjectType
    } else {
      ctor = wrapInterfaceConstructor({ model })
    }

    return new ctor({
      name: getTypeName({ model, isInput }),
      description: model.description,
      interfaces: getInterfaces({ model, isInput }),
      fields: () => getFields({ model, isInput })
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
    const fields = shallowClone(metadataTypes)
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
    })

    return fields
  }

  const createField = cachify(function ({
    propertyName,
    property,
    model,
    required=[],
    isInput=false,
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
        return { type: GraphQLDate }
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
        debug(`unexpected property type: ${type}`)
        return { type: GraphQLJSON }
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

    return {
      type: new GraphQLList(getFieldType({
        model,
        propertyName,
        property: property.items,
        isInput
      }).type)
    }
  }

  /**
   * This is the type that will be the root of our query,
   * and the entry point into our schema.
   */
  const QueryType = new GraphQLObjectType({
    name: 'Query',
    fields: () => {
      const fields = {}
      getInstantiableModels(models).forEach(id => {
        const model = models[id]
        const type = getType({ model })
        fields[getListerFieldName(id)] = {
          type: new GraphQLList(type),
          args: getArgs({ model }),//  getType({ model, isInput: true }),
          resolve: getLister({ model })
        }

        fields[getGetterFieldName(id)] = {
          type,
          args: primaryKeyArgs,
          resolve: getGetter({ model })
        }
      })

      return fields
    }
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
  //     // }, metadataArgs)
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
    let { type, resolve } = _getRefType(arguments[0])
    if (property.type === 'array') {
      type = new GraphQLList(type)
    }

    return { type, resolve }
  }

  function _getRefType ({ propertyName, property, model, isInput }) {
    const ref = getRef(property)
    const range = models[ref]
    if (!range || isBadEnumModel(range)) {
      return { type: GraphQLJSON }
    }

    if (isInput) {
      return { type: ResourceStubType.input }
    }

    if (isGoodEnumModel(range)) {
      return { type: ResourceStubType.output }
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

    const ret = {
      type: getType({ model: range }),
    }

    if (property.type === 'array') {
      ret.resolve = getBacklinkResolver({ model: range })
    } else {
      ret.resolve = getLinkResolver({ model: range })
    }

    return ret
  }

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

module.exports = createSchema
