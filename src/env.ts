export {};

// Keep this Env typing resilient for unit tests where bindings may be absent.
declare global {
	interface Env {
		DB?: D1Database;
		RSS_TITLE?: string;
		/**
		 * Base URL used to build RSS <link> when the email doesn't contain a clear article URL.
		 * Example: "https://example.com"
		 */
		RSS_BASE_URL?: string;
		/**
		 * Comma-separated Telegraph access tokens for publishing long content.
		 * Example: "token1,token2,token3"
		 * Tokens are selected via deterministic round-robin based on item ID.
		 */
		TELEGRAPH_TOKENS?: string;
	}
}

