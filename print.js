const { printSchema } = require('graphql')
const { createSchema } = require('./')
const models = require('./models')

console.log(printSchema(createSchema().addModels(models).schema))
