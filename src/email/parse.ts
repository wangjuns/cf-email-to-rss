import PostalMime from 'postal-mime';
import type { Email } from 'postal-mime';
import type { RssItem } from '../rss';

function extractFirstUrl(text: string): string | undefined {
	// Basic URL detection; good enough for most newsletters.
	const match = text.match(/https?:\/\/[^\s<>"']+/i);
	if (!match) return;
	// Trim common trailing punctuation.
	return match[0].replace(/[),.;:!?]+$/g, '');
}

function stripHtml(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/\r\n/g, '\n')
		.trim();
}

/**
 * Clean HTML for RSS display — remove scripts, styles, and tracking noise,
 * but keep structural/formatting tags so readers can render the original layout.
 */
function cleanHtml(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<head[\s\S]*?<\/head>/gi, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		// Remove common newsletter tracking pixels (1×1 images)
		.replace(/<img[^>]*(?:width\s*=\s*["']?1["']?\s+height\s*=\s*["']?1["']?|height\s*=\s*["']?1["']?\s+width\s*=\s*["']?1["']?)[^>]*\/?>/gi, '')
		.trim();
}

function normalizeMessageId(id: string): string {
	return id.trim().replace(/^<|>$/g, '');
}

async function sha256Hex(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function pickDescription(email: Email): string | undefined {
	const raw = email.text ?? (email.html ? stripHtml(email.html) : undefined);
	if (!raw) return;
	// Compress whitespace for RSS friendliness.
	const compact = raw.replace(/[ \t]+\n/g, '\n').replace(/\s+/g, ' ').trim();
	// Keep it short to reduce payloads.
	return compact.slice(0, 2000);
}

function pickHtmlContent(email: Email): string | undefined {
	if (!email.html) return;
	return cleanHtml(email.html);
}

export async function parseNewsletterToRssItem(
	message: ForwardableEmailMessage,
	params: { baseUrl?: string },
): Promise<RssItem | null> {
	const parsed = await PostalMime.parse(message.raw, {
		maxHeadersSize: 1024 * 1024, // Be tolerant; Email Workers still cap overall message size.
		maxNestingDepth: 50,
	});

	const title = parsed.subject?.trim() || 'Newsletter';
	const pubDateRaw = parsed.date || null;
	const pubDate = pubDateRaw ? new Date(pubDateRaw) : new Date();
	const pubDateSafe = Number.isNaN(pubDate.getTime()) ? new Date() : pubDate;

	const description = pickDescription(parsed);
	const htmlContent = pickHtmlContent(parsed);

	const linkSource = [parsed.html, parsed.text].filter(Boolean).join('\n');
	const extractedLink = linkSource ? extractFirstUrl(linkSource) : undefined;
	const link = extractedLink || params.baseUrl;

	const messageId =
		(parsed.messageId && normalizeMessageId(parsed.messageId)) ||
		(parsed.headers.find((h) => h.key === 'message-id')
			? normalizeMessageId(parsed.headers.find((h) => h.key === 'message-id')!.value)
			: undefined);

	const idSeed =
		messageId ??
		`${parsed.subject ?? ''}|${parsed.date ?? ''}|${parsed.from?.address ?? message.from}|${extractedLink ?? ''}`;

	const id = await sha256Hex(idSeed);

	if (!link) {
		// RFC-wise RSS <link> is expected. Caller can set a channel link fallback.
		// We keep items without link to avoid fabricating URLs.
	}

	return {
		id,
		title,
		link,
		pubDate: pubDateSafe,
		description,
		htmlContent,
	};
}
