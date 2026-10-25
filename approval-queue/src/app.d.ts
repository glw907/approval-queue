import type { LayoutData } from './routes/$types';

declare global {
	/** The port this build serves, baked in by `vite.config.ts` from `APPROVAL_QUEUE_PORT`. */
	const __QUEUE_PORT__: number;

	namespace App {
		/** What every page's `data` carries: the layout load's queue and this session's decisions. */
		interface PageData extends Pick<LayoutData, 'queue' | 'decided'> {}
	}
}

export {};
