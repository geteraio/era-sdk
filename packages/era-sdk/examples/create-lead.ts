/**
 * A customer and a lead, through the typed SDK.
 *   ERA_TOKEN=<access token from era login> ERA_BASE_URL=http://localhost:3001 bun examples/create-lead.ts
 *   (or ERA_API_KEY=era_… for a server key)
 */
import { createEra, EraError } from '../src/index'

const era = createEra({ accessToken: process.env.ERA_TOKEN, apiKey: process.env.ERA_API_KEY })

const me = await era.me()
console.log(`as ${me.user.name} in ${me.workspace.id}`)

const customer = await era.customers.create({ name: 'Ada Lovelace', email: `ada+${Date.now()}@example.com` }, { idempotencyKey: crypto.randomUUID() })
const customerId = (customer.result as { id: string }).id
const lead = await era.leads.captureLead({ customerId, message: 'Wants the yearly plan' })
const leadId = (lead.result as { id: string }).id
console.log('lead', leadId, 'events', lead.events.join(', '))

const fetched = await era.leads.get(leadId)
console.log('read back', fetched.id, fetched.customer_id === customerId ? '(same customer)' : '')

try {
  await era.leads.captureLead({ customerId: '00000000-0000-0000-0000-000000000000' })
} catch (e) {
  if (e instanceof EraError) console.log('refused as expected:', e.status, e.code)
  else throw e
}
