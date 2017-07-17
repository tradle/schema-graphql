const { GraphQLScalarType } = require('graphql')

function identity (value) {
  return value
}

function fromStringOrBuffer (str) {
  if (Buffer.isBuffer(str)) return str

  const semiIdx = str.indexOf(':')
  const enc = str.slice(0, semiIdx)
  const data = str.slice(semiIdx + 1)
  return new Buffer(data, enc)
}

function parseLiteral (ast) {
  const { value } = ast
  if (typeof value === 'string') {
    return fromStringOrBuffer(value)
  }

  throw new Error('expected string representation of bytes of the form <enc>:<data>')
}

const BytesType = new GraphQLScalarType({
  name: 'Bytes',
  description: 'Node.js Buffer objects',
  serialize: identity,
  parseValue: fromStringOrBuffer,
  parseLiteral
})

module.exports = BytesType
