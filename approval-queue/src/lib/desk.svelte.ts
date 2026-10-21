import type { KeyAction } from '#lib/keys.ts';
import type { Row } from '#lib/triage.ts';

/**
 * State the layout, the open item, and the key handler share. The layout owns the keys and the
 * toast; the item panel registers the handlers that act on its own form and clears them when the
 * item changes. Only client code writes it, so one instance serves every request.
 */
class Desk {
	singleKeys = $state(true);
	sheetOpen = $state(false);
	noteOpen = $state(false);
	/** The queue rail is open as a drawer (below 1024px). */
	railOpen = $state(false);
	/** The review pane is open as a drawer (below 1260px). */
	paneOpen = $state(false);
	/** Approve is disabled, so the `a` key must not post it either. */
	approveLocked = $state(false);
	page = $state<'pr' | 'design' | 'triage' | 'packet' | 'blueprint' | 'page' | 'change'>('design');
	/** A plain toast's text; null hides it. A held decision's toast is `held`'s, and takes its place. */
	toast = $state<string | null>(null);
	/** The live region's text. */
	status = $state('');
	handlers: Partial<Record<KeyAction, () => void>> = {};
	/**
	 * Unsent triage calls by item id. The item panel is rebuilt for every item, so calls made
	 * before opening another item live here until they are submitted.
	 */
	drafts = new Map<string, Row[]>();

	/**
	 * Adds key handlers and returns the function that removes them again, so a component that
	 * registers from an effect can unregister in its teardown without clearing another's.
	 */
	register(handlers: Partial<Record<KeyAction, () => void>>): () => void {
		this.handlers = { ...this.handlers, ...handlers };
		return () => {
			const kept = { ...this.handlers };
			for (const [action, fn] of Object.entries(handlers) as Array<[KeyAction, () => void]>) {
				if (kept[action] === fn) delete kept[action];
			}
			this.handlers = kept;
		};
	}

	/** Blanks the region first so a repeated message is read again. */
	announce(message: string) {
		this.status = '';
		setTimeout(() => (this.status = message), 50);
	}
}

export const desk = new Desk();
