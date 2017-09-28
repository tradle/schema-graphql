module.exports = {
  EQ: {
    type: 'any'
  },
  NEQ: {
    type: 'any'
  },
  NULL: {
    type: 'any'
  },
  IN: {
    type: 'array'
  },
  BETWEEN: {
    type: 'array',
    scalar: true
  },
  STARTS_WITH: {
    type: 'string',
    scalar: true
  },
  CONTAINS: {
    type: 'string',
    scalar: true
  },
  LT: {
    scalar: true
  },
  LTE: {
    scalar: true
  },
  GT: {
    scalar: true
  },
  GTE: {
    scalar: true
  },
  // NOT IMPLEMENTED
  // OR: {
  //   type: 'array'
  // },
  // AND: {
  //   type: 'array'
  // }
}
