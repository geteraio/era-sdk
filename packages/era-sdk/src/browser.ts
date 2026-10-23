/**
 * `era-sdk.js` — the SDK as one classic script for a page with no build step (an app an Era chat
 * makes on the desktop and opens in the canvas). It defines `window.EraSDK`:
 *
 *   <script src="era-sdk.js"></script>
 *   <script>
 *     const era = EraSDK.createEra(EraSDK.fromPage())   // the canvas hands the page its member key
 *     const { data } = await era.orders.list({ limit: 20 })
 *   </script>
 *
 * `fromPage()` reads `window.ERA_API` ({ baseUrl, token }), which Era's canvas injects into a page
 * that declares `<meta name="era-app" content="sdk">`. The page itself never holds a credential.
 */
import { createEra, EraError, paginate } from './index'

interface PageApi {
  baseUrl?: string
  token?: string
}

function fromPage(): { baseUrl?: string; accessToken?: string } {
  const api = (globalThis as { ERA_API?: PageApi }).ERA_API
  if (!api?.baseUrl || !api.token) return {}
  return { baseUrl: api.baseUrl, accessToken: api.token }
}

;(globalThis as Record<string, unknown>).EraSDK = { createEra, EraError, paginate, fromPage }
