/**
 * Era Brain in 20 lines: remember, search, explain, forget.
 *   ERA_API_KEY=era_… bun examples/remember.ts          (or ERA_BASE_URL=http://localhost:3001 for a local Era)
 */
import { createBrain } from '../src/index'

const brain = createBrain()

const saved = await brain.add('Ada Lovelace from Analytical Engines prefers invoices in EUR, sent on the 1st of each month.', { wait: 15 })
console.log('job:', saved.job.status, '·', saved.memories?.length ?? 0, 'memories stored')
for (const m of saved.memories ?? []) console.log('  +', m.content)

const { results } = await brain.search('How does Ada want to be invoiced?', { limit: 3 })
for (const r of results) console.log(`  ${r.score.toFixed(4)}  ${r.content}`)

if (results[0]) {
  const why = await brain.explain('How does Ada want to be invoiced?', results[0].id)
  console.log('why #1:', why.visible_because, '· keyword terms:', why.keyword.terms.join(', '), '· similarity:', why.semantic.similarity)
}

for (const m of saved.memories ?? []) await brain.forget(m.id)
console.log('forgotten:', saved.memories?.length ?? 0)
