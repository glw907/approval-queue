import { defineEnvVars } from '@sveltejs/kit/env';

// Optional: a required variable fails `vite build` and vitest imports with env_invalid.
export const variables = defineEnvVars({
	APPROVAL_QUEUE_STATE: { schema: (value) => value ?? '' }
});
