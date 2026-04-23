# Update MicroVisualizer Service

A GitHub Action that syncs a service definition (JSON or YAML) to a MicroVisualizer project. It automatically determines whether to create a new service or update an existing one based on name matching.

## Quick Start

```yaml
- uses: microvisualizer/update-service-action@v1
  with:
    project-id: ${{ vars.MICROVISUALIZER_PROJECT_ID }}
    api-key: ${{ secrets.MICROVISUALIZER_API_KEY }}
    service-src: .microvisualizer/service.yaml
```

## Inputs

| Name                   | Required | Default                           | Description                               |
| ---------------------- | -------- | --------------------------------- | ----------------------------------------- |
| `project-id`           | true     | —                                 | MicroVisualizer project ID                |
| `api-key`              | true     | —                                 | MicroVisualizer API key                   |
| `service`              | false    | —                                 | Inline JSON or YAML string                |
| `service-src`          | false    | —                                 | Path to a JSON or YAML file               |
| `api-url`              | false    | `https://api.microvisualizer.com` | Base URL of the MicroVisualizer API       |
| `allow-create`     | false    | `true`                            | Allow creating a new service if it does not exist |
| `dry-run`              | false    | `false`                           | Log the payload without making API calls  |

Exactly one of `service` or `service-src` must be provided.

## Outputs

| Name        | Description                                         |
| ----------- | --------------------------------------------------- |
| `slug`      | The slug of the created or updated service          |
| `operation` | Either `created`, `updated`, or `skipped` (dry-run) |
| `url`       | Direct URL to the service in MicroVisualizer        |

## Service Format

### JSON

```json
{
  "name": "Orders",
  "description": "Order management service",
  "category": "commerce",
  "owner": "platform-team",
  "flows": ["checkout"],
  "produces": [
    { "name": "order.created" }
  ],
  "consumes": [
    { "name": "payment.completed" }
  ],
  "extras": {
    "repo": "https://github.com/example/orders"
  }
}
```

### YAML

```yaml
name: Orders
description: Order management service
category: commerce
owner: platform-team
flows:
  - checkout
produces:
  - name: order.created
consumes:
  - name: payment.completed
extras:
  repo: https://github.com/example/orders
```

Only `name` is required. All other fields are optional.

## Usage Examples

### Inline JSON

```yaml
- uses: microvisualizer/update-service-action@v1
  with:
    project-id: ${{ vars.MICROVISUALIZER_PROJECT_ID }}
    api-key: ${{ secrets.MICROVISUALIZER_API_KEY }}
    service: |
      {"name":"Orders","description":"Order management service","category":"commerce","owner":"platform-team"}
```

### Load from repo file

```yaml
- uses: microvisualizer/update-service-action@v1
  with:
    project-id: ${{ vars.MICROVISUALIZER_PROJECT_ID }}
    api-key: ${{ secrets.MICROVISUALIZER_API_KEY }}
    service-src: .microvisualizer/service.yaml
```

### Dry-run on PRs, real execution on main

```yaml
on:
  pull_request:
  push:
    branches: [main]

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: microvisualizer/update-service-action@v1
        with:
          project-id: ${{ vars.MICROVISUALIZER_PROJECT_ID }}
          api-key: ${{ secrets.MICROVISUALIZER_API_KEY }}
          service-src: .microvisualizer/service.yaml
          dry-run: ${{ github.event_name == 'pull_request' }}
```

### Matrix strategy for multiple services

```yaml
jobs:
  sync:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service: [services/orders.yaml, services/payments.yaml, services/shipping.yaml]
    steps:
      - uses: actions/checkout@v4
      - uses: microvisualizer/update-service-action@v1
        with:
          project-id: ${{ vars.MICROVISUALIZER_PROJECT_ID }}
          api-key: ${{ secrets.MICROVISUALIZER_API_KEY }}
          service-src: ${{ matrix.service }}
```

### Update only — fail if service doesn't exist

```yaml
- uses: microvisualizer/update-service-action@v1
  with:
    project-id: ${{ vars.MICROVISUALIZER_PROJECT_ID }}
    api-key: ${{ secrets.MICROVISUALIZER_API_KEY }}
    service-src: .microvisualizer/service.yaml
    allow-create: false
```

## Troubleshooting

| Error                   | Cause                      | Fix                                                      |
| ----------------------- | -------------------------- | -------------------------------------------------------- |
| `Authentication failed` | Invalid or expired API key | Rotate your key in MicroVisualizer and update the secret |
| `Project not found`     | Incorrect `project-id`     | Verify the project ID in MicroVisualizer                 |
| `Rate limit exceeded`   | Too many requests          | Wait and retry; consider batching updates                |
| `Failed to parse`       | Invalid JSON or YAML       | Validate syntax with a linter before committing          |

## Contributing

```bash
npm install
npm run typecheck
npm run package
npm run lint
npm run test
```

When submitting a PR, ensure `dist/` is up to date (run `npm run package`).
