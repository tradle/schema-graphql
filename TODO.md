
- Optimize resolution of backlinks. Currently a query like the one below will cause one request to fetch a backlink per edge (!), i.e. one request for verifications per ProfessionalIndemnity result
```json
{
  rl_tradle_ProfessionalIndemnity {
    pageInfo {
      startCursor
      endCursor
      hasNextPage
    }
    edges {
      cursor
      node {
        verifications {
          edges {
            node {
              _link,
              _permalink,
              document {
                id
              }
            }
          }
        }
      }
    }
  }
}
```

- support argument (filter, etc.) for backlinks, e.g.
