import { randomBytes, randomUUID } from 'node:crypto';
import { link, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Cookies } from '@sveltejs/kit';

/** The cookie that marks the browser the queue opens new items in. */
export const CLAIM_COOKIE = 'desk-claim';

/**
 * `secure` is off because SvelteKit defaults it on for any host but `localhost`, and the queue
 * serves `http://127.0.0.1`. Chrome caps a cookie's lifetime at 400 days, so each claimed poll sets it
 * again and the 400 days count from the last use.
 */
const CLAIM_OPTIONS = { path: '/', httpOnly: true, sameSite: 'lax', secure: false, maxAge: 34_560_000 } as const;

/** The state root's claim token, or undefined before the first `/claim` visit. */
export async function readClaimToken(root: string): Promise<string | undefined> {
	return (await readFile(join(root, 'claim.token'), 'utf8').catch(() => undefined))?.trim();
}

/**
 * Reads the claim token, making it on the first visit: 32 random bytes as hex, mode 0600. The token is
 * written to a temp file and `link`ed into place, so two first visits agree on one token and neither
 * reads a half-written file.
 */
export async function ensureClaimToken(root: string): Promise<string> {
	const path = join(root, 'claim.token');
	const tmp = `${path}.${randomUUID()}.tmp`;
	await writeFile(tmp, randomBytes(32).toString('hex'), { mode: 0o600 });
	try {
		await link(tmp, path);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
	} finally {
		await unlink(tmp);
	}
	return (await readFile(path, 'utf8')).trim();
}

/** Sets the claim cookie to the token, which also pushes its expiry out again. */
export function setClaimCookie(cookies: Cookies, token: string) {
	cookies.set(CLAIM_COOKIE, token, CLAIM_OPTIONS);
}
