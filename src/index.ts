/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { buildRssXml } from './rss';
import { listRssItems, saveRssItem } from './storage';
import { parseNewsletterToRssItem } from './email/parse';
import {
	isContentLong,
	htmlToTelegraphNodes,
	pickToken,
	parseTokens,
	createTelegraphPage,
} from './telegraph';

function feedTitle(env: Env, fallback: string): string {
	return env.RSS_TITLE?.trim() || fallback;
}

function stripHtmlForLength(html: string): string {
	return html
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/feed.xml') {
			const feedLink = env.RSS_BASE_URL?.trim() || url.origin;
			const title = feedTitle(env, 'Email -> RSS');

			const items = await listRssItems(env, 20);
			const xml = buildRssXml({
				title,
				link: feedLink,
				description: title,
				items,
			});

			return new Response(xml, {
				headers: {
					'Content-Type': 'application/rss+xml; charset=utf-8',
					'Cache-Control': 'no-store',
				},
			});
		}

		return new Response('Not Found', { status: 404 });
	},

	async email(message, env, ctx): Promise<void> {
		try {
			if (!env.DB) return;

			const baseUrl = env.RSS_BASE_URL?.trim();
			const item = await parseNewsletterToRssItem(message, { baseUrl });
			if (!item) return;

			// If content is long and Telegraph tokens are configured, publish to Telegraph
			const telegraphTokensRaw = env.TELEGRAPH_TOKENS?.trim();
			if (telegraphTokensRaw && item.htmlContent) {
				const plainText = item.description ?? stripHtmlForLength(item.htmlContent);
				if (isContentLong(plainText)) {
					const tokens = parseTokens(telegraphTokensRaw);
					if (tokens.length > 0) {
						const token = pickToken(tokens, item.id);
						const nodes = htmlToTelegraphNodes(item.htmlContent);
						const telegraphUrl = await createTelegraphPage({
							token,
							title: item.title,
							content: nodes,
							authorName: message.from,
						});
						if (telegraphUrl) {
							item.link = telegraphUrl;
						}
					}
				}
			}

			await saveRssItem(env, { id: item.id, item });
		} catch (err) {
			// Avoid rejecting the email; just log parsing/storage errors.
			console.error('Failed to convert email to RSS:', err);
		}
	},
} satisfies ExportedHandler<Env>;
