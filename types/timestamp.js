const { Kind } = require('graphql/language')
const { GraphQLScalarType } = require('graphql')

function serializeDate (value) {
  if (!isNaN(value)) {
    return value
  }

  if (value instanceof Date) {
    return value.getTime()
  }

  if (typeof value === 'number') {
    return Math.trunc(value)
  }

  if (typeof value === 'string') {
    return Date.parse(value)
  }

  return null
}

function parseDate (value) {
  if (value === null) {
    return null
  }

  try {
    return new Date(value).getTime()
  } catch (err) {
    return null
  }
}

function parseDateFromLiteral (ast) {
  if (ast.kind === Kind.INT || !isNaN(ast.value)) {
    return parseInt(ast.value, 10)
  } else if (ast.kind === Kind.STRING) {
    return parseDate(ast.value)
  }

  return null
}

function andStringify (fn) {
  return function (...args) {
    const result = fn.apply(this, args)
    return result == null ? null : result + ''
  }
}

const TimestampType = new GraphQLScalarType({
  name: 'Timestamp',
  description:
    'The javascript `Date` as integer. Type represents date and time ' +
    'as number of milliseconds from start of UNIX epoch.',
  serialize: andStringify(serializeDate),
  parseValue: andStringify(parseDate),
  parseLiteral: andStringify(parseDateFromLiteral)
})

module.exports = TimestampType
