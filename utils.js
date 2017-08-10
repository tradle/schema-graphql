const pick = require('object.pick')
const omit = require('object.omit')
const shallowClone = require('xtend')
const extend = require('xtend/mutable')
const deepEqual = require('deep-equal')
const {
  GraphQLNonNull,
} = require('graphql/type')

const { ResourceStubType } = require('./types')
const BaseObjectModel = require('./object-model')
const ObjectPropNames = Object.keys(BaseObjectModel.properties)
// const NON_VIRTUAL_PROP_NAMES = ObjectPropNames
//   .filter(name => !BaseObjectModel.properties[name].virtual)

// const REQUIRED_PROTOCOL_PROP_NAMES = ObjectPropNames
//   .filter(name => BaseObjectModel.required.includes(name))

// const PROTOCOL_PROPS = pick(BaseObjectModel.properties, NON_VIRTUAL_PROP_NAMES)

module.exports = {
  pick,
  omit,
  shallowClone,
  extend,
  deepEqual,
  lazy,
  isResourceStub,
  isBadEnumModel,
  isGoodEnumModel,
  isNullableProperty,
  isScalarProperty,
  normalizeModels,
  cachify,
  getValues,
  toNonNull,
  getProperties,
  getRequiredProperties,
  getInstantiableModels,
  isInstantiable,
  getRef,
  getTypeName
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

function withProtocolProps (model) {
  let required = model.required || []
  while (true) {
    let expanded = expandGroupProps(model, required)
    if (expanded.length === required.length) {
      break
    }

    required = expanded
  }

  return shallowClone(model, shallowClone({
    properties: shallowClone(model.properties, BaseObjectModel.properties),
    required: unique(required.concat(BaseObjectModel.required || []))
  }))
}

function withHeaderProps (model) {
  return shallowClone(model, shallowClone({
    properties: shallowClone(model.properties, BaseObjectModel.properties)
  }))
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

  const withProtocol = mapObject(models, withProtocolProps)
  const whole = mapObject(withProtocol, withHeaderProps)
  return whole
  // return fixEnums(addedProtocol)
}

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

function isInstantiable (model) {
  const { id, isInterface, abstract } = model
  if (id === 'tradle.Model' || isInterface || abstract) {
    return false
  }

  return true
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

function mapObject (obj, mapper) {
  const mapped = {}
  for (let key in obj) {
    mapped[key] = mapper(obj[key])
  }

  return mapped
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

  const base = type.replace(/[^a-zA-Z-_0-9]/g, '_')
  if (isInput) return `i_${base}`

  return base
}
