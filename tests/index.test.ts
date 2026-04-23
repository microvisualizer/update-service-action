import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as core from '@actions/core'
import nock from 'nock'
import { run } from '../src/index'

vi.mock('@actions/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@actions/core')>()
  return {
    ...actual,
    getInput: vi.fn(),
    getBooleanInput: vi.fn(),
    setOutput: vi.fn(),
    setFailed: vi.fn(),
    info: vi.fn(),
  }
})

const mockedCore = vi.mocked(core)

const apiUrl = 'https://api.microvisualizer.com'

function setupInputs(inputs: Record<string, string | boolean>) {
  mockedCore.getInput.mockImplementation((name: string) => {
    const value = inputs[name]
    return typeof value === 'string' ? value : ''
  })
  mockedCore.getBooleanInput.mockImplementation((name: string) => {
    const value = inputs[name]
    return typeof value === 'boolean' ? value : false
  })
}

function mockListServices(status: number, body: object) {
  return nock(apiUrl).get('/v1/projects/proj-1/services').reply(status, body)
}

function mockCreateService(status: number, body: object) {
  return nock(apiUrl).post('/v1/projects/proj-1/services').reply(status, body)
}

function mockUpdateService(slug: string, status: number, body: object) {
  return nock(apiUrl).put(`/v1/projects/proj-1/services/${slug}`).reply(status, body)
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  nock.cleanAll()
})

describe('input validation', () => {
  it('fails when neither service nor service-src is provided', async () => {
    setupInputs({
      'project-id': 'proj-1',
      'api-key': 'key',
      'api-url': apiUrl,
      'dry-run': false,
      'allow-create': true,
    })

    await run()

    expect(mockedCore.setFailed).toHaveBeenCalledWith('Exactly one of "service" or "service-src" must be provided.')
  })

  it('fails when both service and service-src are provided', async () => {
    setupInputs({
      'project-id': 'proj-1',
      'api-key': 'key',
      service: '{"name":"Orders"}',
      'service-src': 'svc.yaml',
      'api-url': apiUrl,
      'dry-run': false,
      'allow-create': true,
    })

    await run()

    expect(mockedCore.setFailed).toHaveBeenCalledWith('Exactly one of "service" or "service-src" must be provided.')
  })
})

describe('create', () => {
  it('creates a service when none exists', async () => {
    setupInputs({
      'project-id': 'proj-1',
      'api-key': 'key',
      service: '{"name":"Orders","description":"Order service"}',
      'api-url': apiUrl,
      'dry-run': false,
      'allow-create': true,
    })

    mockListServices(200, [])
    mockCreateService(201, {
      slug: 'orders',
      name: 'Orders',
      url: 'https://app.microvisualizer.com/services/orders',
    })

    await run()

    expect(mockedCore.setOutput).toHaveBeenCalledWith('operation', 'created')
    expect(mockedCore.setOutput).toHaveBeenCalledWith('slug', 'orders')
    expect(mockedCore.setOutput).toHaveBeenCalledWith('url', 'https://app.microvisualizer.com/services/orders')
  })
})

describe('update', () => {
  it('updates a service when it already exists', async () => {
    setupInputs({
      'project-id': 'proj-1',
      'api-key': 'key',
      service: '{"name":"Orders","description":"Updated"}',
      'api-url': apiUrl,
      'dry-run': false,
      'allow-create': true,
    })

    mockListServices(200, [{ slug: 'orders', name: 'Orders' }])
    mockUpdateService('orders', 200, {
      slug: 'orders',
      name: 'Orders',
      url: 'https://app.microvisualizer.com/services/orders',
    })

    await run()

    expect(mockedCore.setOutput).toHaveBeenCalledWith('operation', 'updated')
    expect(mockedCore.setOutput).toHaveBeenCalledWith('slug', 'orders')
  })
})

describe('file input', () => {
  it('reads service from file', async () => {
    setupInputs({
      'project-id': 'proj-1',
      'api-key': 'key',
      'service-src': 'tests/fixtures/service.yaml',
      'api-url': apiUrl,
      'dry-run': false,
      'allow-create': true,
    })

    mockListServices(200, [])
    mockCreateService(201, { slug: 'payments', name: 'Payments' })

    await run()

    expect(mockedCore.setOutput).toHaveBeenCalledWith('operation', 'created')
    expect(mockedCore.setOutput).toHaveBeenCalledWith('slug', 'payments')
  })
})

describe('error handling', () => {
  it('surfaces invalid credentials', async () => {
    setupInputs({
      'project-id': 'proj-1',
      'api-key': 'bad',
      service: '{"name":"Orders"}',
      'api-url': apiUrl,
      'dry-run': false,
      'allow-create': true,
    })

    mockListServices(401, { message: 'Unauthorized' })

    await run()

    expect(mockedCore.setFailed).toHaveBeenCalledWith('Authentication failed: invalid API key.')
  })

  it('surfaces project not found', async () => {
    setupInputs({
      'project-id': 'missing',
      'api-key': 'key',
      service: '{"name":"Orders"}',
      'api-url': apiUrl,
      'dry-run': false,
      'allow-create': true,
    })

    nock(apiUrl).get('/v1/projects/missing/services').reply(404, { message: 'Not found' })

    await run()

    expect(mockedCore.setFailed).toHaveBeenCalledWith('Project not found: missing')
  })
})

describe('dry run', () => {
  it('dry run mode skips API calls', async () => {
    setupInputs({
      'project-id': 'proj-1',
      'api-key': 'key',
      service: '{"name":"Orders"}',
      'api-url': apiUrl,
      'dry-run': true,
      'allow-create': true,
    })

    await run()

    expect(mockedCore.setOutput).toHaveBeenCalledWith('operation', 'created')
    expect(mockedCore.info).toHaveBeenCalledWith(expect.stringContaining('[dry-run]'))
  })
})

describe('allow-create', () => {
  it('fails when service does not exist and allow-create is false', async () => {
    setupInputs({
      'project-id': 'proj-1',
      'api-key': 'key',
      service: '{"name":"Orders"}',
      'api-url': apiUrl,
      'dry-run': false,
      'allow-create': false,
    })

    mockListServices(200, [])

    await run()

    expect(mockedCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('Service "Orders" not found'))
  })

  it('updates existing service even when allow-create is false', async () => {
    setupInputs({
      'project-id': 'proj-1',
      'api-key': 'key',
      service: '{"name":"Orders","description":"Updated"}',
      'api-url': apiUrl,
      'dry-run': false,
      'allow-create': false,
    })

    mockListServices(200, [{ slug: 'orders', name: 'Orders' }])
    mockUpdateService('orders', 200, { slug: 'orders', name: 'Orders' })

    await run()

    expect(mockedCore.setOutput).toHaveBeenCalledWith('operation', 'updated')
  })

  it('dry-run skips creation when allow-create is false', async () => {
    setupInputs({
      'project-id': 'proj-1',
      'api-key': 'key',
      service: '{"name":"Orders"}',
      'api-url': apiUrl,
      'dry-run': true,
      'allow-create': false,
    })

    await run()

    expect(mockedCore.setOutput).toHaveBeenCalledWith('operation', 'skipped')
  })
})

describe('parse errors', () => {
  it('handles malformed yaml', async () => {
    setupInputs({
      'project-id': 'proj-1',
      'api-key': 'key',
      service: 'name: [broken',
      'api-url': apiUrl,
      'dry-run': false,
      'allow-create': true,
    })

    await run()

    expect(mockedCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('Failed to parse'))
  })
})

describe('network resilience', () => {
  it('retries on network error once', async () => {
    setupInputs({
      'project-id': 'proj-1',
      'api-key': 'key',
      service: '{"name":"Orders"}',
      'api-url': apiUrl,
      'dry-run': false,
      'allow-create': true,
    })

    nock(apiUrl)
      .get('/v1/projects/proj-1/services')
      .replyWithError({ code: 'ECONNRESET', message: 'connection reset' })
      .get('/v1/projects/proj-1/services')
      .reply(200, [])

    mockCreateService(201, { slug: 'orders', name: 'Orders' })

    await run()

    expect(mockedCore.setOutput).toHaveBeenCalledWith('operation', 'created')
  })
})
