import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			adapter: adapter(),
			// The built app's CSRF check trusts this origin; without it adapter-node
			// derives an https origin and every form post from the browser fails.
			paths: { origin: 'http://127.0.0.1:7907' },
			csp: { directives: { 'script-src': ['self'] } }
		})
	]
});
