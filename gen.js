#!/usr/bin/env node

const { graphql, buildSchema, buildClientSchema, printSchema, introspectionQuery } = require('graphql')
const { createSchema } = require('./')
const models = require('./models')
const tradleGraphql = createSchema()
tradleGraphql.addModels(models)
const str = printSchema(tradleGraphql.schema)
process.stdout.write(str)
// process.stdout.write(JSON.stringify(schema, null, 2))

// graphql(schema, introspectionQuery)
//   .then(result => {
//     // process.stdout.write(JSON.stringify(result.data, null, 2))
//     // debugger
//     // console.time('fromJson')
//     // const fromJson = buildClientSchema(result.data)
//     // console.timeEnd('fromJson')

//     // console.time('fromString')
//     // const fromString = buildSchema(str)
//     // console.timeEnd('fromString')

//     // console.log(printSchema(fromJson) === printSchema(fromString))
//   })


// const toJSON = schema => graphql(schema, introspectionQuery).then(result => result.data)
