const debug = require('debug')(require('./package').name)
const _ = require('lodash')
const {
  GraphQLNonNull,
} = require('graphql/type')

const { TYPE } = require('@tradle/constants')
const {
  isInlinedProperty,
  parseId,
  setVirtual,
  isInstantiable
} = require('@tradle/validate-resource').utils

const {
  getNestedProperties,
  getProperty
} = require('@tradle/validate-model').utils

// const { ResourceStubType } = require('./types')
const BaseObjectModel = require('./object-model')
const BASE_REQUIRED_INLINED = [TYPE]
// const ObjectPropNames = Object.keys(BaseObjectModel.properties)
const { NESTED_PROP_SEPARATOR } = require('./constants')
const OPERATORS = require('./operators')
const AUTHOR_TITLE_PROP = {
  type: 'string'
}

const memoizeByModel = fn => _.memoize(fn, opts => opts.model.id)
const memoizeByModelAndBacklink = fn => _.memoize(fn, ({ model, backlink }) => {
  return `${model.id}:${backlink ? 'b' : ''}`
})

// function memoizeByModelAndOperatorType (fn) {
//   return _.memoize(fn, opts => {
//     return `${getOperatorType(opts.operator) || ''}~${opts.model.id}`
//   })
// }

const memoizeByModelAndOperator = fn =>
  _.memoize(fn, opts => `${opts.model.id}~${opts.operator}`)

const memoizeByModelAndInput = fn => _.memoize(fn, opts => {
  // i for input, o for output
  return `${opts.operator ? 'i' : 'o'}~${opts.model.id}`
})

// function toNonNull (types) {
//   return mapObject(types, wrapper => {
//     return _.extend({}, wrapper, {
//       type: new GraphQLNonNull(wrapper.type)
//     })
//   })
// }

// const isResourceStub = props => {
//   const keys = Object.keys(props)
//   return keys.length === ResourceStubType.propertyNames &&
//     _.isEqual(keys.sort(), ResourceStubType.propertyNames)
// }

function isComplexProperty ({ type, range }) {
  return type === 'object' ||
    type === 'array' ||
    type === 'enum' ||
    range === 'json'
}

function isBadEnumModel (model) {
  return model.subClassOf === 'tradle.Enum' && !Array.isArray(model.enum)
}

function isGoodEnumModel (model) {
  return model.subClassOf === 'tradle.Enum' && Array.isArray(model.enum)
}

function isNullableProperty (property) {
  return !isComplexProperty(property.type)
}

function isScalarProperty (property) {
  return !isComplexProperty(property)
}

// function filterObject (obj, filter) {
//   const filtered = {}
//   for (let key in obj) {
//     let val = obj[key]
//     if (filter(val)) {
//       filtered[key] = val
//     }
//   }

//   return filtered
// }

function addProtocolProps (model) {
  let required = model.required || []
  while (true) {
    let expanded = expandGroupProps(model, required)
    if (expanded.length === required.length) {
      break
    }

    required = expanded
  }

  if (model.inlined) {
    model.properties[TYPE] = _.cloneDeep(BaseObjectModel.properties[TYPE])
  } else {
    _.extend(model.properties, _.cloneDeep(BaseObjectModel.properties))
  }

  model.required = getRequiredProperties({ model, inlined: model.inlined })
}

function expandGroupProps (model, arr) {
  const props = []
  for (const propertyName of arr) {
    const { group } = getProperty({ model, propertyName })
    // nested group props should be caught in @tradle/validate-model
    props.push(group || propertyName)
  }

  return props
}

// faster than lodash
function unique (strings) {
  const obj = {}
  for (let str of strings) {
    if (!(str in obj)) {
      obj[str] = true
    }
  }

  return Object.keys(obj)
}

// function hasNonProtocolProps (model) {
//   return !!Object.keys(_.omit(model.properties, PROTOCOL_PROP_NAMES)).length
// }

// function toInlinedModel (model) {
//   return _.extend({}, model, {
//     inlined: true,
//     required: getRequiredProperties({ model, inlined })
//   })
// }

function normalizeModels (models, base={}) {
  // models = filterObject(models, model => {
  //   return !isInstantiable(model) || hasNonProtocolProps(model)
  // })

  models = _.cloneDeep(models)
  const all = _.extend({}, models, base)
  forEachPropIn(models, addProtocolProps, all)
  forEachPropIn(models, addCustomProps, all)
  forEachPropIn(models, addNestedProps, all)
  // return fixEnums(addedProtocol)
  return models
}

function addCustomProps (model) {
  if (model.inlined) return

  model.properties._authorTitle = AUTHOR_TITLE_PROP
}

function addNestedProps (model, models) {
  return _.extend(model.properties, getNestedProperties({ models, model }))
}

const getRequiredProperties = _.memoize(({ model, inlined }) => {
  let required = model.required || []
  if (inlined) {
    required = required.concat(BASE_REQUIRED_INLINED)
  } else {
    required = required.concat(BaseObjectModel.required)
  }

  return unique(required)
}, ({ model, inlined }) => inlined ? 'i_' + model.id : 'o_' + model.id)

function getRef (property) {
  return property.ref || (property.items && property.items.ref)
}

const getProperties = _.memoize(model => {
  if (model.properties.id) {
    throw new Error(`"id" is a reserved property, model ${model.id} needs to learn its place`)
  }

  return Object.keys(model.properties)
}, model => model.id)

function getInstantiableModels (models) {
  return Object.keys(models).filter(id => isInstantiable(models[id]))
}

function getOnCreateProperties ({ model, models }) {
  return Object.keys(model.properties).filter(propertyName => {
    return isSetOnCreate({ model, propertyName })
  })
}

function isSetOnCreate ({ model, propertyName }) {
  const property = model.properties[propertyName]
  return !property.backlink

  // const { type } = property
  // if (type !== 'object' && type !== 'array') {
  //   return true
  // }

  // if (isInlinedProperty({ property, models })) {
  //   return true
  // }

  // if (!property.backlink) return true
}

// function mapObject (obj, mapper, ...args) {
//   const mapped = {}
//   for (let key in obj) {
//     mapped[key] = mapper(obj[key], ...args)
//   }

//   return mapped
// }

function forEachPropIn (obj, mapper, ...args) {
  for (let key in obj) {
    mapper(obj[key], ...args)
  }
}

// function lazy (fn) {
//   let val
//   let called
//   return function (...args) {
//     if (called) return val

//     val = fn.apply(this, args)
//     called = true
//     return val
//   }
// }

function getTypeName ({ model, type, operator, operatorType, inlined }) {
  if (!type) {
    type = model.id
  }

  let name = type.replace(/[^_a-zA-Z0-9]/g, '_')

  // graphql constraint
  if (!/^[_a-zA-Z][_a-zA-Z0-9]*$/.test(name)) {
    throw new Error('unable to sanitize type name: ' + type)
  }

  if (operator || operatorType) {
    name = `${operator || operatorType}_${name}`
  }

  if (inlined) name = `${name}_i`

  return name
}

/**
 * Convert NESTED_PROP_SEPARATOR to '.' in filter,
 * e.g. document__id to document.id
 */
function normalizeNestedProps ({ args, model, models }) {
  const { properties } = model
  const { filter, orderBy } = args
  for (let comparator in filter) {
    let vals = filter[comparator]
    Object.keys(vals).forEach(propertyName => {
      const val = vals[propertyName]
      const path = propertyName.split(NESTED_PROP_SEPARATOR)
      if (path.length >= 2) {
        vals[path.join('.')] = val
        delete vals[propertyName]
      }
    })
  }

  if (orderBy) {
    orderBy.property = orderBy.property
      .split(NESTED_PROP_SEPARATOR)
      .join('.')
  }
}

function defineGetter (obj, prop, getter, cache) {
  let cached
  Object.defineProperty(obj, prop, {
    get: () => {
      if (cache && cached) return cached

      return cached = getter()
    }
  })
}

function getOperatorType (operator) {
  if (operator) {
    if (OPERATORS[operator].scalar) {
      return 'scalar_compare'
    }

    return 'compare'
  }
}

module.exports = {
  debug,
  // lazy,
  // isResourceStub,
  isBadEnumModel,
  isGoodEnumModel,
  isNullableProperty,
  isScalarProperty,
  normalizeModels,
  normalizeNestedProps,
  memoizeByModel,
  memoizeByModelAndInput,
  memoizeByModelAndBacklink,
  memoizeByModelAndOperator,
  // toNonNull,
  getProperties,
  getRequiredProperties,
  getInstantiableModels,
  getRef,
  getTypeName,
  defineGetter,
  getOperatorType
}
