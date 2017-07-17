#!/usr/bin/env node

const { printSchema } = require('graphql')
const { createSchema } = require('./')
const models = require('./models')
const { schema } = createSchema({ models })

process.stdout.write(printSchema(schema))
