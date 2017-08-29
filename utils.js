const debug = require('debug')(require('./package').name)
const pick = require('object.pick')
const omit = require('object.omit')
const shallowClone = require('xtend')
const extend = require('xtend/mutable')
const deepEqual = require('deep-equal')
const clone = require('clone')
const {
  GraphQLNonNull,
} = require('graphql/type')

const { TYPE } = require('@tradle/constants')
const {
  // isInlinedProperty,
  parseId,
  setVirtual,
  isInstantiable
} = require('@tradle/validate-resource').utils
const { ResourceStubType } = require('./types')
const BaseObjectModel = require('./object-model')
const ObjectPropNames = Object.keys(BaseObjectModel.properties)
const { NESTED_PROP_SEPARATOR } = require('./constants')

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
  let required = model.required || []
  while (true) {
    let expanded = expandGroupProps(model, required)
    if (expanded.length === required.length) {
      break
    }

    required = expanded
  }

  if (model.inlined) {
    model.properties[TYPE] =  clone(BaseObjectModel.properties[TYPE])
    if (BaseObjectModel.required.includes(TYPE)) {
      model.required = model.required.concat(TYPE)
    }
  } else {
    extend(model.properties, clone(BaseObjectModel.properties))
    model.required = unique(required.concat(BaseObjectModel.required || []))
  }
}

function expandGroupProps (model, arr) {
  return arr.reduce((props, name) => {
    const { group } = model.properties[name]
    if (group) {
      // nested group props should be caught in @tradle/validate-model
      return props.concat(group)
    }

    return props.concat(name)
  }, [])
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

function normalizeModels (models) {
  // models = filterObject(models, model => {
  //   return !isInstantiable(model) || hasNonProtocolProps(model)
  // })

  models = clone(models)
  forEachPropIn(models, addProtocolProps, models)
  forEachPropIn(models, addCustomProps, models)
  // models = forEachPropIn(models, addNestedProps, models)
  // return fixEnums(addedProtocol)
  return models
}

function addCustomProps (model) {
  if (model.inlined) return

  model.properties._authorTitle = {
    type: 'string'
  }
}

// function addNestedProps (model, models) {
//   const { properties } = model
//   getProperties(model).forEach(propertyName => {
//     const property = properties[propertyName]
//     if (property.type !== 'object' && property.type !== 'array') {
//       return
//     }

//     if (property.range === 'json') {
//       return
//     }

//     let nestedProps
//     if (isInlinedProperty({ models, property })) {
//       const ref = getRef(property)
//       if (ref === 'tradle.Model') return

//       nestedProps = ref
//         ? models[ref].properties
//         : property.properties || property.items.properties

//     } else {
//       nestedProps = ResourceStubProps
//     }

//     for (let p in nestedProps) {
//       let prop = shallowClone(nestedProps[p])
//       prop.nested = true
//       properties[`${propertyName}.${p}`] = prop
//     }
//   })

//   return model
// }

function getRequiredProperties (model) {
  return model.required || []
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

function getTypeName ({ model, type, isInput }) {
  if (!type) {
    type = model.id
  }

  const base = type.replace(/[^_a-zA-Z0-9]/g, '_')

  // graphql constraint
  if (!/^[_a-zA-Z][_a-zA-Z0-9]*$/.test(base)) {
    throw new Error('unable to sanitize type name: ' + type)
  }

  if (isInput) return `i_${base}`

  return base
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
