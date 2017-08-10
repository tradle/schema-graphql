const { GraphQLScalarType } = require('graphql')

module.exports = new GraphQLScalarType({
  name: 'timestamp',
  serialize: function (value) {
    if (value instanceof Date) {
      return value.getTime()
    }

    if (typeof value === 'number') {
      return value
    }

    if (typeof value === 'string') {
      return new Date(value).getTime()
    }

    throw new Error('expected Date, Unix timestamp, Javascript timestamp, Date string')
  },
  /**
   * @param  {Number} timestamp
   * @return {Number} date value
   */
  parseValue: validateAndReturn,
  /**
   * @param  {Number} timestamp
   * @return {Number} date value
   */
  parseLiteral: function (ast) {
    return validateAndReturn(parseInt(ast.value, 10))
  }
})

function validateAndReturn (value) {
  if (value !== new Date(value).getTime()) {
    throw new Error('invalid timestamp')
  }

  return value
}
