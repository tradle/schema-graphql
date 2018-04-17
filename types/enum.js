const _ = require('lodash')
const {
  GraphQLObjectType,
  GraphQLInputObjectType,
  GraphQLString,
  GraphQLNonNull
} = require('graphql/type')

function identity (value) {
  return value
}

const enumValueProps = ['id', 'title']

function parseLiteral (ast) {
  const stub = ast.fields.reduce((props, field) => {
    props[field.name.value] = field.value.value
    return props
  }, {})

  return _.pick(stub, enumValueProps)
}

const fields = {
  id: {
    type: new GraphQLNonNull(GraphQLString)
  },
  title: {
    type: GraphQLString
  }
}

const EnumInputType = new GraphQLInputObjectType({
  name: 'EnumValueInput',
  // value sent to the client
  serialize: identity,
  // // value sent by the client
  parseValue: identity,
  parseLiteral,
  fields
})

const EnumType = new GraphQLObjectType({
  name: 'EnumValue',
  // value sent to the client
  fields
})

module.exports = {
  input: EnumInputType,
  output: EnumType,
  propertyNames: enumValueProps
}
