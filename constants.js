
const { stubProps } = require('@tradle/validate-resource').utils

module.exports = {
  NESTED_PROP_SEPARATOR: '__',
  RESOURCE_STUB_PROPS: stubProps.sort().reduce((props, prop) => {
    props[prop] = { type: 'string' }
    return props
  }, {})
}
