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
  // "id" is deprecated
  id: {
    type: new GraphQLNonNull(GraphQLString)
  },
  title: {
    type: GraphQLString
  },
  type: {
    type: GraphQLString
  },
  link: {
    type: GraphQLString
  },
  permalink: {
    type: GraphQLString
  },
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
