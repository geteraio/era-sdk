/**
 * The builder skills every Era desktop chat gets (R54 G1), written beside era-cli and era-actions
 * (era-station era/workspaceFiles.ts) for Claude Code and Codex:
 *
 *   era-site-builder    "here is my logo and content — build my coffee shop site and publish it"
 *   era-app-builder     "make me a POS screen that shows my orders"
 *   era-business-setup  "set up my business"
 *
 * They teach the agent Era's public developer surface (the `era` CLI's public verbs, @getera/sdk,
 * @getera/storefront, era.theme.json, the deploy API) as it runs inside an Era chat: the session's terminal has
 * ERA_BASE_URL + ERA_TOKEN, a loopback door that acts as THIS member with their own permissions.
 */

export interface EraBuilderSkill {
  readonly slug: string;
  readonly description: string;
  readonly body: string;
}

const SHARED = `## The ground rules (every builder skill)

- You act as this person, with exactly their permissions. \`era whoami --json\` says which modules they may read or change. A refusal (exit 4, "not found", 403/404) is final: say in one plain sentence what is missing and who can grant it (the workspace owner, in Settings → Roles). Never look for another key, another door or a workaround.
- The terminal already holds the credentials (ERA_BASE_URL, ERA_TOKEN). Never print, echo, copy or save them, never put them in a file, a page or a commit.
- Work in this folder: sites under \`sites/<name>/\`, apps under \`apps/<name>/\`. Answer in the person's language; the things you build are Turkish first when they write Turkish (the templates have TR + EN).
- Publishing, sending, inviting and paying are visible to others. Do them when the person asked for them in words ("yayınla", "publish", "davet et"); otherwise show what you will do and wait for a yes.
- Show, don't describe: when a page or app is ready, write its absolute path to \`index.html\` in your answer. The desktop puts a "Tuvalde aç" (open in canvas) card under it: preview, code, history, publish.
- Before the final answer after several writes, run \`era turn report\` and report exactly what was done, what failed and what was skipped.`;

export const ERA_SITE_BUILDER_SKILL: EraBuilderSkill = {
  slug: "era-site-builder",
  description:
    "Design and write the business's website yourself, from scratch, as real code (any stack), with Era as its backend only: products, prices, stock, cart and Era's hosted checkout, orders, customer accounts, blog/news, forms, bookings. Declare the parts the owner edits without code in era.theme.json (sections + settings, like a Shopify theme) so they appear in Era's theme editor, then publish to <slug>.getera.site. Use for: make/build/redesign my website, landing page, online store, menu site, 'site kur', 'siteyi yayınla', change something on my site.",
  body: `# Build the business's site: your own code, Era as the backend

${SHARED}

Era gives you a BACKEND, not a site builder. You design and write the site yourself, from scratch, for this one brand: its own typography, palette, layout, imagery and motion, in whatever stack you judge best (plain HTML/CSS/JS, Astro, a Next.js static export, Vite …). Era's 31 templates (\`era templates\`) are only inspiration, and only when the person asks for a template. Never assemble a site from generic blocks.

## 1. Design first (load the frontend-design skill)
Read the brief (\`marka/\`, attached files, the message): name, what they sell, address, hours, language(s), the feeling they want, their logo and colours. Follow the frontend-design skill: write a short design plan (4–6 named colours from their brand, a deliberate type pairing, a layout concept with an ASCII wireframe, the one memorable thing), check it is not a generic default, then build. Turkish first when they write Turkish (correct ç ğ ı İ ö ş ü, ₺ prices), English second if they want two languages.

## 2. What lives in Era (never hard-code it)
| On the site | Lives in Era | Read it with |
|---|---|---|
| Products, prices, stock, product photos | Catalogue (Era → Products) | \`era.products.list()\` / \`.get(slug)\` |
| Basket, checkout, payment, order confirmation | Era's hosted checkout | \`era.cart.add()\`, \`era.checkout.redirect({ returnUrl })\`, \`era.checkout.result()\` |
| Customer sign-in, their orders | Era customers | \`era.customer.requestCode / verify / orders\` |
| Blog posts, news | Era → Site → Blog / News | \`<div data-era-posts="blog">\` or \`era.posts.list()\` |
| Contact / booking / wholesale forms | Era forms (answers become leads) | \`era.forms.submit(slug, values, spam)\` |
| Bookings | Era appointments | \`era.booking.services() / slots() / book()\` |
| Company, contact, socials, logo | Era → Settings → Website | \`era.settings()\` |
| Every other word, photo, link, hours table, section order | **era.theme.json** sections (Era's theme editor) | \`data-era="hero.title"\` bindings (§5) |

Money: Era stores amounts in minor units (\`priceAmount: 42000\` = ₺420,00); the storefront API answers \`{ amount: 420, currency: "TRY" }\`.

## 3. Set the business up in Era (as this person; ask before anything visible to others)
Each write: \`era run <module.action> --json @step.json\` with step.json = \`{"input": {…}}\` (UTF-8 file: Turkish letters stay intact).
1. The site: \`era sites list --json\`; reuse the one they mean, else \`site.create_site\` \`{"name":"Köşe Kavurma","type":"commerce","defaultLocale":"tr"}\`. Two languages: \`site.set_locale\` \`{"siteId":"…","defaultLocale":"tr","locales":["tr","en"]}\`. Its public API answers only once it is published: \`site.publish\` \`{"siteId":"…"}\` when the person asked you to publish.
2. Photos into Era: \`era file save <path>\` → a fileId; make it public with \`files.publish\` \`{"id":"<fileId>"}\` (a site may only show public files). No photos from the person → generate them first (§4).
3. Products: \`era products list --json\` first (never duplicate). A new one: \`catalog.create_item\` \`{"name":"Etiyopya Guji 250 g","kind":"product","fulfilment":"shipping","summary":"…","description":"…","priceAmount":42000,"inShop":true,"imageFileId":"<fileId>","categoryId":"<id>"}\`. Then put each one on sale on the site: \`retail.set_item_listing\` \`{"itemId":"<id>","isPublished":true,"visibleInListings":true}\` (\`inShop\` prices it in the shop currency; the listing is what makes it visible). Give the site's products their own category (\`catalog.create_category\`) when the workspace sells other things too, and list by it. A menu that is not sold online (espresso at the counter) is theme content (§5), not products.
4. A first blog/news post when they ask for one: \`site.save_post\` / \`site.save_news\` with \`content\` as a Lexical document (\`{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"…"}]}]}}\`, one paragraph node per paragraph), then \`site.publish_post\` / \`site.set_news_status\` \`{"id":"…","status":"published"}\`.
5. Check it as a visitor: \`curl -s "$ERA_PUBLIC_URL/api/site/v1/<siteId>/products?category=<slug>"\` must list them with prices and image URLs.

## 4. Photos: never an empty box
Order: the person's own photos (this folder, the chat, Era → Products / Files) → ask for them in one line and keep building → **generate them with \`era images generate\`** (below) → Era's own library in \`$ERA_TEMPLATES_DIR/photos\` (e.g. \`scenes__coffee_roaster.avif\`) → only then an art-directed SVG you draw as a real image file. Never a grey box, an icon or "photo coming soon".

**Generating (the person's own ChatGPT plan through the Codex CLI; no paid image API, nothing to buy):**
\`\`\`sh
era images status                                   # exit 0 = Codex is signed in with ChatGPT
era images generate --style "$(cat sites/<name>/art-direction.txt)" --size 4:5 --max-width 1200 \\
  --prompt "A 250 g matte kraft coffee bag, cream label printed 'Etiyopya Guji' / 'Yıkanmış · 250 g', on a walnut table, roasted beans and dried peach beside it" \\
  --out sites/<name>/img/guji.webp
era images generate --style "…same line…" --ref sites/<name>/img/guji.webp --size 4:5 --prompt "The same bag design, label 'Kolombiya Huila' …" --out sites/<name>/img/huila.webp
era images generate --style "…same line…" --ref sites/<name>/img/guji.webp --size 4:3 --max-width 1600 --prompt "Inside the roastery: beans pouring into the cooling tray … No people, no text." --out sites/<name>/img/hero.webp
\`\`\`
- **One art direction per brand.** Before the first picture write ONE style line from the brand (its colours, materials, light, lens, mood; e.g. "warm editorial product photography, espresso-brown, cream and copper, walnut and hammered copper, soft morning window light from the left, 50 mm, shallow depth of field, subtle grain") to \`sites/<name>/art-direction.txt\` and pass the same line as \`--style\` to every picture. Make the first product shot, look at it, then pass it as \`--ref\` to the others so packaging, table and light match. Each picture takes about a minute: run them one after another, never in parallel.
- **What to make:** a realistic product photograph for every physical product without a photo (packshot on a surface from the brand's world; the label shows only the product's own name and facts, spelled exactly, Turkish letters included); the hero and section images (the place, the craft, the material — what the business actually does); a cover for each blog/news post you write. Services and digital products get a scene, not a fake box.
- **Never:** a real company's logo, trademark or packaging (only the person's own brand); a face that could be taken for real staff, a real customer or a real person (people only as hands, backs or out of focus); invented awards, certificates or badges; text over the photo.
- **Look at every picture** before using it (open the file): wrong spelling on a label, extra fingers, a second logo, a mismatch with the series → generate it again with a corrected prompt. Mention in your answer which pictures you generated.
- **Web-ready:** \`--out x.webp\` (or \`.avif\`) crops to \`--size\` and saves at \`--max-width\` (1200 for products, 1600 for heroes); without an encoder on the machine it keeps a PNG, and Era's image door (\`/api/site/img?src=/api/files/public/<fileId>&w=<width>\`) still serves WebP at any width for \`srcset\`.
- **Into Era, bound to the fields the owner edits** (so they replace a picture in Era, not in your code): \`era file save <file>\` → fileId, then \`files.publish\` \`{"id":"<fileId>"}\`. Products: \`imageFileId\` on \`catalog.create_item\`, or for an existing one \`catalog.attach_file\` \`{"itemId":"…","fileId":"…","role":"image","alt":"…","sortOrder":0}\` and \`catalog.detach_file\` \`{"id":"<the stand-in's attachment id>"}\` for the drawn/library stand-in it replaces. Hero and section images: the theme setting (\`type: "image"\`) keeps a local default (\`/img/hero.webp\`, also copied next to the pages so the page is complete without Era); on the FIRST build set its Era value to the uploaded file with \`site.set_content\` \`{"siteId":"…","key":"hero.image","value":{"*":{"fileId":"…","url":"/api/files/public/<fileId>","alt":"…"}}}\` — later, only when \`era theme pull\` shows the owner has not changed it. Posts: \`featuredImageId\` on \`site.save_post\` / \`site.save_news\`.
- **Codex not signed in** (\`era images status\` ≠ 0, or generate exits 3): don't stop and don't buy anything. Use Era's library or a drawn SVG for now and tell the person in one line: "Ürün fotoğraflarını ChatGPT aboneliğinizle üretebilirim: bir kez \`codex login\` → Sign in with ChatGPT." A plan limit (exit 4) is the same: say so, use the library, offer to retry later.
Every \`<img>\` has meaningful alt text (Turkish when the site is), width/height, and loads lazily below the fold.

## 5. The code: Era as the backend, the owner's sections declared
Work in \`sites/<name>/\` (source) and publish its static output folder (the folder itself for plain HTML, \`dist/\` for a build tool).
- Era in the page: copy \`.era/lib/era-site.js\` next to the pages and load it once:
  \`<script src="/era-site.js" data-site="<siteId>" data-api="$ERA_PUBLIC_URL" defer></script>\`
  It binds the owner's content and gives \`window.era\` (the @getera/storefront client). With a bundler, \`npm i @getera/storefront\` and \`createStorefront({ siteId, apiBase })\` + \`await era.bind()\` instead.
- Products render from \`era.products.list({ category })\` at runtime; write the same products into the HTML at build time too, so the page is never empty and is indexable. Buttons call \`era.cart.add(variantId)\`; checkout is \`era.checkout.redirect({ returnUrl: location.origin + "/tesekkurler.html" })\` — never collect card details yourself.
- **era.theme.json** at the site's root declares what the owner edits in Era (the theme editor shows these sections and fields; nothing else is editable there):
\`\`\`json
{
  "name": "Köşe Kavurma",
  "locales": ["tr", "en"],
  "sections": [
    { "id": "announcement", "label": { "tr": "Duyuru şeridi", "en": "Announcement bar" },
      "settings": [
        { "id": "on", "type": "checkbox", "label": { "tr": "Göster", "en": "Show" }, "default": true },
        { "id": "text", "type": "text", "label": { "tr": "Metin", "en": "Text" }, "default": { "tr": "Salı ve cuma taze kavrum", "en": "Fresh roast every Tuesday and Friday" } } ] },
    { "id": "hero", "label": { "tr": "Giriş", "en": "Hero" },
      "settings": [
        { "id": "title", "type": "text", "label": { "tr": "Başlık", "en": "Headline" }, "default": { "tr": "…", "en": "…" } },
        { "id": "body", "type": "textarea", "label": { "tr": "Metin", "en": "Text" }, "default": { "tr": "…", "en": "…" } },
        { "id": "image", "type": "image", "label": { "tr": "Görsel", "en": "Image" }, "default": { "url": "/img/hero.avif", "alt": "…" } },
        { "id": "cta", "type": "link", "label": { "tr": "Düğme", "en": "Button" }, "default": { "tr": { "label": "Kahvelerimiz", "href": "#kahveler" }, "en": { "label": "Our coffees", "href": "#kahveler" } } } ] },
    { "id": "coffees", "label": { "tr": "Kahvelerimiz", "en": "Our coffees" }, "source": { "type": "products", "category": "kose-kavurma" },
      "settings": [ { "id": "title", "type": "text", "label": { "tr": "Başlık", "en": "Title" }, "default": { "tr": "Kahvelerimiz", "en": "Our coffees" } } ] },
    { "id": "hours", "label": { "tr": "Çalışma saatleri", "en": "Opening hours" },
      "settings": [ { "id": "title", "type": "text", "label": { "tr": "Başlık", "en": "Title" }, "default": { "tr": "Saatler", "en": "Hours" } } ],
      "blocks": { "label": { "tr": "Satırlar", "en": "Rows" }, "max": 7,
        "settings": [ { "id": "label", "type": "text", "label": { "tr": "Günler", "en": "Days" } }, { "id": "value", "type": "text", "label": { "tr": "Saat", "en": "Hours" } } ],
        "default": { "tr": [ { "label": "Her gün", "value": "08:00–20:00" } ], "en": [ { "label": "Every day", "value": "08:00–20:00" } ] } } },
    { "id": "news", "label": { "tr": "Haberler", "en": "News" }, "source": { "type": "posts", "kind": "news" },
      "settings": [ { "id": "title", "type": "text", "label": { "tr": "Başlık", "en": "Title" }, "default": { "tr": "Kavurma günlüğü", "en": "Roast log" } },
                    { "id": "count", "type": "number", "label": { "tr": "Kaç yazı", "en": "How many" }, "default": 3, "min": 1, "max": 6 } ] }
  ],
  "layout": { "order": ["announcement", "hero", "coffees", "hours", "news"] }
}
\`\`\`
  Setting types: text, textarea, image ({url|fileId, alt}), link ({label, href}), url, number, checkbox, select (+options), color, json. Texts are per language; image, number, checkbox, select, color are shared unless \`"localized": true\`. \`blocks\` = a repeatable list (rows, cards, menu items) with its own settings. \`source\` = a section whose items are live Era data (posts kind blog|news, products, form, services); its settings are the frame (title, count).
- Bind the page to it (the text you write in the HTML is the fallback, so the page is complete without Era):
  - \`<h1 data-era="hero.title">…</h1>\`, \`<img data-era="hero.image" src="/img/hero.avif" alt="…">\`, \`<a data-era="hero.cta" href="#kahveler">…</a>\` — key = \`<section id>.<setting id>\`; text, textarea, image, link, number fill themselves.
  - \`<div data-era-show="announcement.on">\` shows/hides; \`<meta name="description" data-era-attr="content:seo.description">\` sets attributes.
  - Blocks: \`<ul data-era="hours.blocks"><template><li><span data-era-field="label"></span> <span data-era-field="value"></span></li></template><li>Her gün 08:00–20:00</li></ul>\` (\`data-era-href\`, \`data-era-src\`, \`data-era-alt\` name fields for attributes).
  - Live posts: \`<div data-era-posts="news" data-era-limit="news.count" data-era-href="/haberler/{slug}"><template><article><img data-era-src="image" alt=""><h3 data-era-field="title"></h3><p data-era-field="excerpt"></p><time data-era-field="date"></time></article></template></div>\`.
  - Sections the owner may reorder or hide: \`<section data-era-section="hours">\` (siblings in one parent).
  Keep keys stable forever: they are where the owner's edits live. A new idea = a new key with a default.
- \`era theme check sites/<name>\` validates the manifest against Era before you publish.

## 6. Look at it, then show it
Serve the output folder (\`npx serve <folder>\` or \`python -m http.server\` in the background), take headless screenshots at 1440×900 and 390×844 if a browser is available (\`npx playwright screenshot --viewport-size=390,844 <url> shot.png\`), look at them, fix what is off, stop the server. Then write the absolute path of the site's \`index.html\` in your answer (the desktop opens it in the canvas).

## 7. Publish
\`\`\`sh
era deploy sites/<name>/dist --site <siteId>     # imports era.theme.json (folder or its parent), then uploads the files as they are
\`\`\`
If Era answers that the getera.site edge cannot publish yet (502, "edge refused" / token), run it once more with \`--provider local\` (a private preview copy in Era, members only) and say plainly that \`<slug>.getera.site\` goes live as soon as publishing is switched on. Era binds the owner's content into every page at the edge, so their later edits need no new deploy.

## 8. Tell the person what they can change without you
In one short list: texts, photos, hours, sections and their order → Era → Website → Content (or the theme editor); products, prices, stock, photos → Era → Products; blog/news → Era → Website → Blog / News; company, contact, socials → Settings → Website. Changes show on the site within half a minute.

## 9. Changing the site later
Run \`era theme pull sites/<name>\` first: \`era.theme.values.json\` holds what the owner set. Change the code freely; keep existing keys, give new settings defaults, never overwrite the owner's values (an import keeps them; \`--prune\` removes settings you deleted from the manifest — only when the person agrees). Then \`era deploy\` again. A site made in Era's block editor (not code) is changed with \`era site edit "<what to change>"\` instead.`,
};

export const ERA_APP_BUILDER_SKILL: EraBuilderSkill = {
  slug: "era-app-builder",
  description:
    "Build a small internal app or screen on the business's live Era data with @getera/sdk: a POS / orders screen, a kitchen board, a stock counter, a booking board, a sales dashboard. It runs in the desktop canvas as this person, with their permissions. Use for: make me a screen/app/panel/dashboard that shows my orders, products, bookings, customers; 'POS ekranı yap', 'siparişlerimi gösteren ekran'.",
  body: `# Build an app on Era's data

${SHARED}

## 1. What may this person see?
\`\`\`sh
era whoami --json                            # modules → capabilities (read / write / manage)
era resources                                # every resource they can read (orders, products, bookings …)
era orders list --limit 3 --json             # the REAL shape of the rows — never invent field names
era actions retail                           # what they may DO (with input fields), e.g. fulfil, cancel
\`\`\`
Build only on what they can read. If the app needs a module they cannot see (finance, payroll …), say so and build without it — never try to reach it another way.

## 2. The app folder
\`\`\`
apps/pos/index.html     the screen (with <meta name="era-app" content="sdk">)
apps/pos/era-sdk.js     copy of .era/lib/era-sdk.js from this work folder
apps/pos/app.js         your code (classic script or inline <script>)
apps/pos/style.css
\`\`\`
\`\`\`sh
mkdir -p apps/pos && cp .era/lib/era-sdk.js apps/pos/
\`\`\`
(PowerShell: \`New-Item -ItemType Directory -Force apps/pos; Copy-Item .era/lib/era-sdk.js apps/pos/\`)

## 3. The code
\`\`\`html
<meta name="era-app" content="sdk">
<script src="era-sdk.js"></script>
<script src="app.js"></script>
\`\`\`
\`\`\`js
const era = EraSDK.createEra(EraSDK.fromPage());   // the canvas hands the page this member's key
const page = await era.orders.list({ limit: 50, order: '-created_at' });   // { data, next_cursor }
for (const o of page.data) render(o);
await era.actions.run('retail.<action>', { /* input from era actions */ }, { idempotencyKey: crypto.randomUUID() });
\`\`\`
- Lists: \`era.<resource>.list({ limit, cursor, order, q, fields, <column>: value })\`; one row: \`.get(id)\`. Any call: \`era.client.request('GET', '/api/v1/orders', { query })\`.
- Errors are \`EraSDK.EraError\` (\`status\`, \`code\`, \`message\`). 401/403/404 means "not for this person": show a calm empty state that says so, not a crash.
- Ids and big numbers arrive as strings. Money columns named \`*_amount\` (\`total_amount\`, \`subtotal_amount\` …) are whole numbers in the currency's minor unit (kuruş, cents): \`32600\` with \`currency: "TRY"\` is ₺326,00. Divide by 100 and format with \`Intl.NumberFormat(locale, { style: 'currency', currency })\`; compare one row with Era's own order screen value when unsure.
- Refresh on an interval (15–30 s) for a live board; never hammer the API.
- Era's look: black and white, 1 px borders, radius 4–12 px, one font, colour only for status; no purple, no pills. Large touch targets for a POS. Turkish labels when the person writes Turkish.
- No credentials in the files: \`EraSDK.fromPage()\` reads the key the canvas injects at preview time. The file on disk holds none.

## 4. Check it, then show it
Run the same reads with \`era <resource> list --json\` to be sure the data is there (an empty list is a fine answer; the app must show a clear empty state). Then put the absolute path of \`apps/pos/index.html\` in your answer: the person opens it in the canvas ("Tuvalde aç"), where it runs live as them.

## 5. Writes from the app
Buttons that change data (mark fulfilled, cancel, take payment) call actions the person may run (\`era actions <module>\`). Payment, sending and deleting keep Era's own approval; design the button so a double click cannot submit twice (disable while pending, idempotency key).

## 6. Pictures in an app
An app shows the pictures Era already holds (product images from \`era.products\` / the item's files, the workspace logo); it never ships its own copies of business photos. When a product the app shows has no picture and the person wants one, make it with their ChatGPT plan, the same way era-site-builder §4 does: \`era images status\`, then \`era images generate --style "<the brand's one art-direction line>" --size 4:5 --prompt "<the real product, its own label text>" --out img/<slug>.webp\`, look at it, \`era file save\` → \`files.publish\` → \`catalog.attach_file\` (role image) so it lives on the product and the owner can replace it in Era → Products. Realistic product photography for physical goods; never a real brand's logo, never a face that could pass for real staff. Codex not signed in: show a clean initial-letter tile and tell the person the one-time \`codex login\` (Sign in with ChatGPT).

## 7. Publishing an app
The canvas is where an internal app runs. A published copy on getera.site has no sign-in, so never deploy an app that reads members' data (orders, customers, finance). A public, data-free page (a menu board from the public catalogue via the site API) may be published with era-site-builder's \`era deploy\`.`,
};

export const ERA_BUSINESS_SETUP_SKILL: EraBuilderSkill = {
  slug: "era-business-setup",
  description:
    "Set up the person's business in Era step by step with their confirmation: business profile and logo, modules, products, website (built and published), integrations (WhatsApp, Instagram, Google …), team invites and first automations. Use for: set up my business, 'işletmemi kur', onboarding, get me started, the /kur plan.",
  body: `# Set up the business

${SHARED}

The workspace already exists (Era never creates one from a chat; a new workspace is made on the web). You fill the CURRENT workspace.

## 1. Read where they are
\`\`\`sh
era whoami --json            # who, which workspace, which modules they may read/write/manage
era overview --text          # enabled modules, apps, today's numbers
\`\`\`
Then check each step from the data (never assume it is done):

| # | Step | Done when | Needs |
|---|---|---|---|
| 1 | Business profile: what it does + logo | the workspace has a description and a logo | organizations:manage |
| 2 | Modules for this business | the modules it needs are on | security_access:manage |
| 3 | Products / services / menu | \`era products list --limit 1\` has rows | catalog:write |
| 4 | Website | \`era sites list\` has a site | site:write |
| 5 | Published | the site has a live deploy (\`era api GET /api/v1/sites/<id>/deploys\`) | site:manage |
| 6 | Channels and apps | \`era channels\`, \`era apps find\` show what is connected | apps:write |
| 7 | Team | more than one active member | organizations:manage |
| 8 | Automations | a workflow is on (\`era workflows list\`) | workflows:manage |

## 2. Show the plan, then wait
One short numbered list: each step with ✓ done, → to do (what exactly you will do), or "not for your role" (and who can). Ask which steps to do now. Do nothing that writes before the person says yes. Mention Era's own setup screen (/kur on the desktop) does the same.

## 3. Do the steps they chose, one at a time
Find the exact action and its fields first: \`era actions <module>\` or \`era find "<what>"\`; then \`era run <module.action> --json @step.json\` with step.json = \`{"input": {…the fields…}}\` (a UTF-8 file keeps Turkish letters intact on Windows). Show the result of each step in one line before the next.
- Profile: \`organizations.update_workspace\` (\`workspace_id\`, \`description\`; the logo is uploaded with \`era file save <logo>\` first).
- Modules: \`security_access.toggle_module\` (\`module_code\`, \`enabled: true\`, \`with_dependencies: true\`). Only modules this business needs; say what each adds.
- Products: \`era products create --data @product.json\` per item (or \`era file import <sheet.xlsx> --target crm|table\` for a list).
- Website and publishing: follow the era-site-builder skill end to end.
- Channels/apps: \`era app connect <app>\` puts a "Bağla" card in the chat; the person connects it themselves. Never type or ask for a password or API key in the chat.
- Team: \`organizations.invite_member\` (\`email\`, role) — an invitation email goes out, so confirm each address first.
- Automations: \`workflows.draft\` (trigger + steps; "every day at 9, do X" = a schedule trigger + one flow.era step). Drafts stay off until the person turns them on; say where (Era → Automations).

## 4. Finish
\`era turn report\`, then a short summary: what is set up, what is left and why (a permission, a connection only they can make, a decision they did not take yet).`,
};

/** Every builder skill, in the order the skills screen lists them. */
export const ERA_BUILDER_SKILLS: readonly EraBuilderSkill[] = [
  ERA_SITE_BUILDER_SKILL,
  ERA_APP_BUILDER_SKILL,
  ERA_BUSINESS_SETUP_SKILL,
];
