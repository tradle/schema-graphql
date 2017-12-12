const debug = require('debug')(require('./package').name)
const pick = require('object.pick')
const omit = require('object.omit')
const shallowClone = require('xtend')
const extend = require('xtend/mutable')
const deepEqual = require('deep-equal')
const clone = require('clone')
const cloneNonCircular = obj => clone(obj, false)
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
const { ResourceStubType } = require('./types')
const BaseObjectModel = require('./object-model')
const BASE_REQUIRED_INLINED = [TYPE]
// const ObjectPropNames = Object.keys(BaseObjectModel.properties)
const { NESTED_PROP_SEPARATOR, RESOURCE_STUB_PROPS } = require('./constants')

module.exports = {
  debug,
  pick,
  omit,
  shallowClone,
  clone,
  extend,
  deepEqual,
  lazy,
  isResourceStub,
  isBadEnumModel,
  isGoodEnumModel,
  isNullableProperty,
  isScalarProperty,
  normalizeModels,
  normalizeNestedProps,
  cachify,
  getValues,
  toNonNull,
  getProperties,
  getRequiredProperties,
  getInstantiableModels,
  getRef,
  getTypeName,
  fromResourceStub
}

function cachify (fn, getId, cache={}) {
  return function (...args) {
    const id = getId(...args)
    if (!(id in cache)) {
      cache[id] = fn.apply(this, args)
    }

    return cache[id]
  }
}

function getValues (obj) {
  return Object.keys(obj).map(key => obj[key])
}

function toNonNull (types) {
  return mapObject(types, wrapper => {
    return shallowClone(wrapper, {
      type: new GraphQLNonNull(wrapper.type)
    })
  })
}

function isResourceStub (props) {
  const keys = Object.keys(props)
  return keys.length === ResourceStubType.propertyNames &&
    deepEqual(keys.sort(), ResourceStubType.propertyNames)
}

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
  if (model.id === 'tradle.Seal') {
    debug('not adding protocol props to tradle.Seal model')
    return
  }

  let required = model.required || []
  while (true) {
    let expanded = expandGroupProps(model, required)
    if (expanded.length === required.length) {
      break
    }

    required = expanded
  }

  if (model.inlined) {
    model.properties[TYPE] = cloneNonCircular(BaseObjectModel.properties[TYPE])
  } else {
    extend(model.properties, cloneNonCircular(BaseObjectModel.properties))
  }

  model.required = getRequiredProperties({ model, inlined: model.inlined })
}

function expandGroupProps (model, arr) {
  const props = []
  for (const name of arr) {
    const { group } = model.properties[name]
    // nested group props should be caught in @tradle/validate-model
    props.push(group || name)
  }

  return props
}

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
//   return !!Object.keys(omit(model.properties, PROTOCOL_PROP_NAMES)).length
// }

// function toInlinedModel (model) {
//   return shallowClone(model, {
//     inlined: true,
//     required: getRequiredProperties({ model, inlined })
//   })
// }

function normalizeModels (models) {
  // models = filterObject(models, model => {
  //   return !isInstantiable(model) || hasNonProtocolProps(model)
  // })

  models = cloneNonCircular(models)
  forEachPropIn(models, addProtocolProps, models)
  forEachPropIn(models, addCustomProps, models)
  forEachPropIn(models, addNestedProps, models)
  // return fixEnums(addedProtocol)
  return models
}

function addCustomProps (model) {
  if (model.inlined) return

  model.properties._authorTitle = {
    type: 'string'
  }
}

function addNestedProps (model, models) {
  const { properties } = model
  getProperties(model).forEach(propertyName => {
    const property = properties[propertyName]
    if (property.type !== 'object' && property.type !== 'array') {
      return
    }

    if (property.range === 'json') {
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
      nestedProps = RESOURCE_STUB_PROPS
    }

    for (let p in nestedProps) {
      properties[`${propertyName}.${p}`] = shallowClone(nestedProps[p])
    }
  })

  return model
}

function getRequiredProperties ({ model, inlined }) {
  let required = model.required || []
  if (inlined) {
    required = required.concat(BASE_REQUIRED_INLINED)
  } else {
    required = required.concat(BaseObjectModel.required)
  }

  return unique(required)
}

function getRef (property) {
  return property.ref || (property.items && property.items.ref)
}

function getProperties (model) {
  const props = Object.keys(model.properties)
  if (props.includes('id')) {
    throw new Error(`"id" is a reserved property, model ${model.id} needs to learn its place`)
  }

  return props

    // .filter(propertyName => {
    //   return propertyName.charAt(0) !== '_'
    // })
}

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

function mapObject (obj, mapper, ...args) {
  const mapped = {}
  for (let key in obj) {
    mapped[key] = mapper(obj[key], ...args)
  }

  return mapped
}

function forEachPropIn (obj, mapper, ...args) {
  for (let key in obj) {
    mapper(obj[key], ...args)
  }
}

function lazy (fn) {
  let val
  let called
  return function (...args) {
    if (called) return val

    val = fn.apply(this, args)
    called = true
    return val
  }
}

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

function fromResourceStub ({ id, title }) {
  const { type, link, permalink } = parseId(id)
  const resource = {
    [TYPE]: type
  }

  setVirtual(resource, {
    _link: link,
    _permalink: permalink,
    _displayName: title
  })

  return resource
}
