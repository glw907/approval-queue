/** The port the app serves on when `APPROVAL_QUEUE_PORT` is unset. */
export const DEFAULT_PORT = 7907;

/**
 * Reads the port from `APPROVAL_QUEUE_PORT`. The build bakes the result into both the CSRF origin
 * and the Host check, so a bad value stops the build instead of serving a port nobody asked for.
 */
export function queuePort(env: string | undefined): number {
	if (env === undefined || env === '') return DEFAULT_PORT;
	const port = Number(env);
	if (!/^\d+$/.test(env) || port < 1 || port > 65535) {
		throw new Error(`APPROVAL_QUEUE_PORT must be a port number from 1 to 65535, not "${env}"`);
	}
	return port;
}
