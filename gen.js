#!/usr/bin/env node
const fs = require('fs')
const _ = require('lodash')
// const Diff = require('diff')
const { graphql, buildSchema, buildClientSchema, printSchema, introspectionQuery } = require('graphql')
const { createSchema } = require('./')
const models = require('./models')
const rethrow = (err) => {
  if (err) throw err
}

// fs.writeFile('./schema-graphql', printSchema(createSchema().addModels(models).schema), rethrow)

let modelsCount = Object.keys(models).length
let counter = 0
while (modelsCount < 1000) {
  counter++
  let more = models//{}
  Object.keys(models).forEach(id => {
    modelsCount++
    const model = models[id]
    const copy = _.cloneDeep(model)
    copy.id = id + '.' + counter
    more[copy.id] = copy
  })
}

console.log(Object.keys(models).length, 'models')
console.time('gen')
const tradleGraphql = createSchema()
tradleGraphql.addModels(models)

// let counter = 0
// while (modelsCount < 1000) {
//   counter++
//   let more = {}
//   Object.keys(models).forEach(id => {
//     modelsCount++
//     const model = models[id]
//     const copy = _.clone(model)
//     copy.id = id + counter
//     more[copy.id] = copy
//   })

//   console.log('added')
//   tradleGraphql.addModels(more)
// }

tradleGraphql.schema
console.timeEnd('gen')
process.exit(0)

// const { schema } = tradleGraphql
// const str = printSchema(tradleGraphql.schema)
// // process.stdout.write(str)
// // process.stdout.write(JSON.stringify(schema, null, 2))

// graphql(schema, introspectionQuery)
//   .then(result => {
//     // process.stdout.write(JSON.stringify(result.data, null, 2))
//     // debugger
//     console.time('fromJson')
//     const fromJson = buildClientSchema(result.data)
//     console.timeEnd('fromJson')

//     console.time('fromString')
//     const fromString = buildSchema(str)
//     console.timeEnd('fromString')

//     // const printedFromJsonStr = printSchema(fromJson)
//     // const printedFromStringStr = printSchema(fromString)
//     // const diff = Diff.diffLines(printedFromJsonStr, printedFromStringStr, {
//     //   ignoreWhitespace: true
//     // })

//     // console.log('diff', diff)
//     // console.log(printedFromJsonStr === printedFromStringStr)
//     // if (printedFromJsonStr !== printedFromStringStr) {
//     //   fs.writeFile('./from-json.graphql', printedFromJsonStr, rethrow)
//     //   fs.writeFile('./from-str.graphql', printedFromStringStr, rethrow)
//     // }
//   })


// // const toJSON = schema => graphql(schema, introspectionQuery).then(result => result.data)
