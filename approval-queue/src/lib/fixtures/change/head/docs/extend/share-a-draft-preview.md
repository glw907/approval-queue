## Mint and revoke from your own admin route

`mintPreview` and `revokePreview` run the built-in actions' checks from a route your site gates, so
your workflow can share and take back links. A site that mounts content routes by hand already gets
the built-in `previewMintAction` and `previewRevokeAction` from `createContentRoutes`. Place and gate
the route as [Add a custom admin screen](add-a-custom-admin-screen.md) shows. Both functions take
the editor from the session the admin guard resolves.

The two signatures are `mintPreview(runtime, config, event, { concept, entryId })` and
`revokePreview(runtime, event, { concept, entryId })`. The `config` argument is a
`PreviewTokenConfig`, the same `{ ttlMs }` your `createCairnAdmin` call sets. Both functions check
the editor, the concept, the access map, and the id's shape, in that order. Only then does a mint
check for a draft. A refusal never reveals whether the entry exists. A session or access-map
refusal throws a 403 or a redirect to sign-in. An unknown concept, a bad id, or, for a mint, a
missing draft comes back as an `outcome` value instead. The
[`mintPreview`](../reference/sveltekit.md#mintpreview) and
[`revokePreview`](../reference/sveltekit.md#revokepreview) entries list each outcome's fields.

To mint and revoke from your screen, follow these steps:

1. In your screen's `+page.server.ts`, add an action that calls `mintPreview` with the entry's concept
   and id.
2. In that action, when the mint succeeds, build the link from your configured origin, `/preview/`,
   and the returned token.
3. In the same file, add an action that calls `revokePreview` with the same concept and id.

The following file shows both actions on a scaffolded site.

<!-- snippet-check-skip: imports cloudflare:workers and the scaffold's #chassis alias -->
```ts
// src/routes/admin/review/+page.server.ts
import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { env } from 'cloudflare:workers';
import { mintPreview, revokePreview } from '@glw907/cairn-cms/sveltekit';
import { runtime } from '#chassis/cairn.server.js';

// Match the lifetime the createCairnAdmin call's preview option sets.
const previewConfig = { ttlMs: 2 * 24 * 60 * 60 * 1000 };

async function readTarget(request: Request) {
  const form = await request.formData();
  return { concept: String(form.get('concept')), entryId: String(form.get('entryId')) };
}

export const actions: Actions = {
  sharePreview: async (event) => {
    const target = await readTarget(event.request);
    const result = await mintPreview(runtime, previewConfig, event, target);
    if (result.outcome !== 'minted') return fail(400, { outcome: result.outcome });
    return { link: `${env.PUBLIC_ORIGIN}/preview/${result.token}`, expiresAt: result.expiresAt };
  },
  revokePreviews: async (event) => {
    const target = await readTarget(event.request);
    const result = await revokePreview(runtime, event, target);
    if (result.outcome !== 'revoked') return fail(400, { outcome: result.outcome });
    return { revoked: result.count };
  },
};
```

The file reads `PUBLIC_ORIGIN` from `cloudflare:workers`.
[Debug your site](debug-your-site.md#eventplatform-is-undefined) explains why the env comes
from there. Both functions log the same mint and revoke records the built-in actions log. The
`sharePreview` action returns a link that opens the draft, the same result
[Verify the preview](#verify-the-preview) checks.
