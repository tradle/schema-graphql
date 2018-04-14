const _ = require('lodash')
const {
  GraphQLObjectType,
  GraphQLInputObjectType,
  GraphQLString,
  GraphQLNonNull
} = require('graphql/type')

const {
  stubProps
} = require('@tradle/validate-resource').utils

function identity (value) {
  return value
}

function parseLiteral (ast) {
  const stub = ast.fields.reduce((props, field) => {
    props[field.name.value] = field.value.value
    return props
  }, {})

  return _.pick(stub, stubProps)
}

const fields = {
  _t: {
    type: new GraphQLNonNull(GraphQLString)
  },
  _link: {
    type: new GraphQLNonNull(GraphQLString)
  },
  _permalink: {
    type: new GraphQLNonNull(GraphQLString)
  },
  _displayName: {
    type: GraphQLString
  }
}

const ResourceStubInputType = new GraphQLInputObjectType({
  name: 'StubInput',
  description: 'resource stub',
  // value sent to the client
  serialize: identity,
  // // value sent by the client
  parseValue: identity,
  parseLiteral,
  fields
})

const ResourceStubOutputType = new GraphQLObjectType({
  name: 'Stub',
  description: 'resource stub',
  // value sent to the client
  fields
})

module.exports = {
  input: ResourceStubInputType,
  output: ResourceStubOutputType,
  propertyNames: stubProps
}
