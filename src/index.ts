import * as core from '@actions/core'
import * as fs from 'fs'
import * as yaml from 'js-yaml'
import fetch, { RequestInit, Response } from 'node-fetch'

interface Service {
  slug: string
  name: string
  url?: string
}

interface ServicePayload {
  name: string
  slug?: string
  description?: string
  type?: string
  config?: Record<string, unknown>
  [key: string]: unknown
}

function getInputs(): {
  projectId: string
  apiKey: string
  service: string | undefined
  serviceSrc: string | undefined
  apiUrl: string
  allowCreate: boolean
  dryRun: boolean
} {
  const projectId = core.getInput('project-id', { required: true })
  const apiKey = core.getInput('api-key', { required: true })
  const service = core.getInput('service')
  const serviceSrc = core.getInput('service-src')
  const apiUrl = core.getInput('api-url') || 'https://api.microvisualizer.com'
  const allowCreate = core.getBooleanInput('allow-create')
  const dryRun = core.getBooleanInput('dry-run')

  if (!service === !serviceSrc) {
    throw new Error('Exactly one of "service" or "service-src" must be provided.')
  }

  return { projectId, apiKey, service, serviceSrc, apiUrl, allowCreate, dryRun }
}

function detectFormat(content: string, path?: string): 'json' | 'yaml' {
  const trimmed = content.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return 'json'
  }
  if (path) {
    const lower = path.toLowerCase()
    if (lower.endsWith('.json')) return 'json'
    if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml'
  }
  if (trimmed.startsWith('---') || trimmed.includes(':')) {
    return 'yaml'
  }
  throw new Error(`Unable to detect config format${path ? ` for ${path}` : ''}. Use .json, .yaml, or .yml extension.`)
}

function parseService(content: string, path?: string): ServicePayload {
  const format = detectFormat(content, path)
  try {
    if (format === 'json') {
      return JSON.parse(content) as ServicePayload
    }
    return yaml.load(content) as ServicePayload
  } catch (err) {
    throw new Error(`Failed to parse service config as ${format}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function readService(service?: string, serviceSrc?: string): ServicePayload {
  if (service) {
    return parseService(service)
  }
  if (!serviceSrc) {
    throw new Error('No service input provided.')
  }
  if (!fs.existsSync(serviceSrc)) {
    throw new Error(`Service file not found: ${serviceSrc}`)
  }
  const content = fs.readFileSync(serviceSrc, 'utf-8')
  return parseService(content, serviceSrc)
}

async function fetchWithRetry(url: string, init: RequestInit, retries = 1, backoffMs = 1000): Promise<Response> {
  try {
    const res = await fetch(url, init)
    if (res.status === 429 && retries > 0) {
      const retryAfter = res.headers.get('retry-after')
      const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : backoffMs
      await new Promise((r) => setTimeout(r, delay))
      return fetchWithRetry(url, init, retries - 1, backoffMs * 2)
    }
    return res
  } catch (err) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, backoffMs))
      return fetchWithRetry(url, init, retries - 1, backoffMs * 2)
    }
    throw err
  }
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

async function handleApiError(res: Response, operation: string, projectId: string, slug?: string): Promise<never> {
  const text = await res.text().catch(() => 'Unknown error')
  if (res.status === 401 || res.status === 403) throw new Error('Authentication failed: invalid API key.')
  if (res.status === 404) throw new Error(slug ? `Project or service not found: ${projectId}/${slug}` : `Project not found: ${projectId}`)
  if (res.status === 429) throw new Error('Rate limit exceeded. Please try again later.')
  throw new Error(`Failed to ${operation} (${res.status}): ${text}`)
}

async function listServices(apiUrl: string, projectId: string, apiKey: string): Promise<Service[]> {
  const url = `${apiUrl}/v1/projects/${encodeURIComponent(projectId)}/services`
  const res = await fetchWithRetry(url, { headers: buildHeaders(apiKey) })

  if (!res.ok) await handleApiError(res, 'list services', projectId)

  return (await res.json()) as Service[]
}

async function createService(opts: {
  apiUrl: string
  projectId: string
  apiKey: string
  payload: ServicePayload
}): Promise<Service> {
  const { apiUrl, projectId, apiKey, payload } = opts
  const url = `${apiUrl}/v1/projects/${encodeURIComponent(projectId)}/services`
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify(payload),
  })

  if (!res.ok) await handleApiError(res, 'create service', projectId)

  return (await res.json()) as Service
}

async function updateService(opts: {
  apiUrl: string
  projectId: string
  slug: string
  apiKey: string
  payload: ServicePayload
}): Promise<Service> {
  const { apiUrl, projectId, slug, apiKey, payload } = opts
  const url = `${apiUrl}/v1/projects/${encodeURIComponent(projectId)}/services/${encodeURIComponent(slug)}`
  const res = await fetchWithRetry(url, {
    method: 'PUT',
    headers: buildHeaders(apiKey),
    body: JSON.stringify(payload),
  })

  if (!res.ok) await handleApiError(res, 'update service', projectId, slug)

  return (await res.json()) as Service
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function dryRunSync(opts: {
  apiUrl: string
  projectId: string
  apiKey: string
  payload: ServicePayload
  allowCreate: boolean
}): Promise<void> {
  const { payload, allowCreate } = opts
  core.info(`[dry-run] Resolved payload: ${JSON.stringify(payload, null, 2)}`)
  if (!allowCreate) {
    core.info(`[dry-run] Service "${payload.name}" not found. Would skip (allow-create=false).`)
    core.setOutput('operation', 'skipped')
    return
  }
  const generatedSlug = payload.slug || slugify(payload.name)
  core.info(`[dry-run] Would create service "${payload.name}" (slug: ${generatedSlug})`)
  core.setOutput('operation', 'created')
  core.setOutput('slug', generatedSlug)
}

async function syncService(opts: {
  apiUrl: string
  projectId: string
  apiKey: string
  payload: ServicePayload
  allowCreate: boolean
}): Promise<void> {
  const { apiUrl, projectId, apiKey, payload, allowCreate } = opts
  const existing = await listServices(apiUrl, projectId, apiKey)
  const match = existing.find((s) => s.name.toLowerCase() === payload.name.toLowerCase())
  if (match) {
    core.info(`Updating existing service "${payload.name}" (slug: ${match.slug})`)
    const result = await updateService({ apiUrl, projectId, slug: match.slug, apiKey, payload })
    core.setOutput('operation', 'updated')
    core.setOutput('slug', result.slug)
    if (result.url) core.setOutput('url', result.url)
    return
  }
  if (!allowCreate) {
    throw new Error(`Service "${payload.name}" not found. Set allow-create=true (or omit it) to create it.`)
  }
  core.info(`Creating new service "${payload.name}"`)
  const result = await createService({ apiUrl, projectId, apiKey, payload })
  core.setOutput('operation', 'created')
  core.setOutput('slug', result.slug)
  if (result.url) core.setOutput('url', result.url)
}

export async function run(): Promise<void> {
  try {
    const { projectId, apiKey, service, serviceSrc, apiUrl, allowCreate, dryRun } = getInputs()
    const payload = readService(service, serviceSrc)

    if (!payload.name || typeof payload.name !== 'string') {
      throw new Error('Service payload must include a "name" field.')
    }

    if (dryRun) {
      await dryRunSync({ apiUrl, projectId, apiKey, payload, allowCreate })
      return
    }

    await syncService({ apiUrl, projectId, apiKey, payload, allowCreate })
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err))
  }
}

if (require.main === module) {
  run()
}
