<!-- @component
One 24-pixel stroke icon from the packet screen's set. The icon is decorative: it always sits beside
text that says the same thing, so it is hidden from assistive technology.
-->
<script lang="ts" module>
	const PATHS = {
		check: 'm5 12 5 5 9-10',
		pause: 'M9 5v14M15 5v14',
		undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
		play: 'M7 5v14l11-7z',
		user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 20c1.5-4 5-6 8-6s6.5 2 8 6',
		skip: 'M5 5v14l9-7zM18 5v14',
		warn: 'M12 3 2 20h20L12 3zM12 10v4M12 17h.01',
		info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
		lock: 'M7 11h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2zM8 11V7a4 4 0 0 1 8 0v4',
		gate: 'M8 3h8l5 5v8l-5 5H8l-5-5V8zM9 9l6 6M15 9l-6 6',
		arrows: 'M4 7h15l-4-4M20 17H5l4 4',
		globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
		help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01',
		scale: 'M12 3v18M5 7h14M5 7l-3 7h6zM19 7l-3 7h6z',
		eyeoff: 'm3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-3 4M6.6 6.6C4.5 8 2.8 10 2 12c1 2.5 5 7 10 7a10 10 0 0 0 5.4-1.6',
		bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z',
		chev: 'm9 6 6 6-6 6'
	};

	export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
	interface Props {
		name: IconName;
		/** Tailwind size and spacing classes; the icon is 1rem square when omitted. */
		class?: string;
	}

	let { name, class: klass = 'size-4' }: Props = $props();
</script>

<svg class={[klass, 'shrink-0']} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={PATHS[name]} /></svg>
