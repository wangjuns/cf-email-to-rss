/**
 * Telegraph API client for publishing long-form newsletter content.
 *
 * Converts email HTML into Telegraph's Node format and publishes via createPage.
 * Supports multiple access tokens with deterministic round-robin selection.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

type TelegraphNode = string | TelegraphElement;

interface TelegraphElement {
	tag: string;
	attrs?: Record<string, string>;
	children?: TelegraphNode[];
}

interface TelegraphPageResult {
	ok: boolean;
	result?: { url: string; path: string };
	error?: string;
}

// ─── Allowed tags in Telegraph ───────────────────────────────────────────────

const ALLOWED_TAGS = new Set([
	'a', 'aside', 'b', 'blockquote', 'br', 'code', 'em',
	'figcaption', 'figure', 'h3', 'h4', 'hr', 'i', 'iframe',
	'img', 'li', 'ol', 'p', 'pre', 's', 'strong', 'u', 'ul',
]);

/** Map common HTML tags to their Telegraph equivalents. */
const TAG_MAP: Record<string, string> = {
	h1: 'h3',
	h2: 'h3',
	h5: 'h3',
	h6: 'h4',
	div: 'p',
	span: 'p',
	section: 'p',
	article: 'p',
	main: 'p',
	header: 'p',
	footer: 'p',
	nav: 'p',
	bold: 'b',
	italic: 'i',
	strike: 's',
	del: 's',
	ins: 'u',
	tbody: 'p',
	thead: 'p',
	tr: 'p',
	td: 'p',
	th: 'p',
	table: 'p',
};

// ─── Content length detection ────────────────────────────────────────────────

/**
 * Determines if content exceeds the threshold for Telegraph publishing.
 * - Chinese/CJK text: 300 characters
 * - English/other: 300 words
 *
 * Uses the ratio of CJK characters to decide which counting method to use.
 */
export function isContentLong(plainText: string): boolean {
	if (!plainText) return false;

	// Count CJK characters (Chinese, Japanese, Korean)
	const cjkMatches = plainText.match(/[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{2a6df}\u{2a700}-\u{2b73f}\u{2b740}-\u{2b81f}\u{2b820}-\u{2ceaf}\u3000-\u303f\uff00-\uffef\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/gu);
	const cjkCount = cjkMatches?.length ?? 0;

	// If more than 20% CJK, treat as CJK text → 300 character threshold
	if (cjkCount > plainText.length * 0.2) {
		return cjkCount > 300;
	}

	// Otherwise, count words (whitespace-separated tokens)
	const words = plainText.split(/\s+/).filter(Boolean);
	return words.length > 300;
}

// ─── HTML → Telegraph Nodes ──────────────────────────────────────────────────

/**
 * Convert HTML string to Telegraph Node array using a simple regex-based parser.
 *
 * We avoid HTMLRewriter here because it streams and does not build a tree.
 * Instead we use a simple stack-based parser sufficient for newsletter HTML.
 */
export function htmlToTelegraphNodes(html: string): TelegraphNode[] {
	// Remove script/style/head tags entirely
	let cleaned = html
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<head[\s\S]*?<\/head>/gi, '')
		.replace(/<!--[\s\S]*?-->/g, '');

	const nodes: TelegraphNode[] = [];
	const stack: TelegraphElement[] = [];

	// Tokenize HTML
	const tokenRegex = /(<\/?[a-zA-Z][^>]*\/?>)|([^<]+)/g;
	let match: RegExpExecArray | null;

	while ((match = tokenRegex.exec(cleaned)) !== null) {
		const [, tag, text] = match;

		if (text) {
			// Text node — decode basic HTML entities
			const decoded = decodeEntities(text);
			if (decoded.trim() || decoded.includes('\n')) {
				const parent = stack.length ? stack[stack.length - 1] : null;
				if (parent) {
					if (!parent.children) parent.children = [];
					parent.children.push(decoded);
				} else {
					nodes.push(decoded);
				}
			}
			continue;
		}

		if (!tag) continue;

		// Self-closing or void tags
		const selfClosingMatch = tag.match(/^<([a-zA-Z][a-zA-Z0-9]*)\s*((?:[^>]*?))\s*\/?>$/i);
		const closingMatch = tag.match(/^<\/([a-zA-Z][a-zA-Z0-9]*)\s*>$/i);
		const openMatch = tag.match(/^<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^>]*)?)\s*>$/i);

		if (closingMatch) {
			// Closing tag — pop from stack
			const tagName = closingMatch[1].toLowerCase();
			const mappedTag = TAG_MAP[tagName] ?? tagName;

			// Find matching open tag in stack
			for (let i = stack.length - 1; i >= 0; i--) {
				if (stack[i].tag === mappedTag || stack[i].tag === tagName) {
					const closed = stack.splice(i)[0];
					const parent = stack.length ? stack[stack.length - 1] : null;

					if (ALLOWED_TAGS.has(closed.tag)) {
						if (parent) {
							if (!parent.children) parent.children = [];
							parent.children.push(closed);
						} else {
							nodes.push(closed);
						}
					} else {
						// Tag not allowed — promote children
						const children = closed.children ?? [];
						if (parent) {
							if (!parent.children) parent.children = [];
							parent.children.push(...children);
						} else {
							nodes.push(...children);
						}
					}
					break;
				}
			}
			continue;
		}

		// Open or self-closing tag
		const tagMatch = selfClosingMatch ?? openMatch;
		if (!tagMatch) continue;

		let tagName = tagMatch[1].toLowerCase();
		const attrStr = tagMatch[2] || '';

		// Map to allowed tag
		tagName = TAG_MAP[tagName] ?? tagName;

		// Check for void elements
		const isVoid = /^(br|hr|img|iframe)$/.test(tagName);
		const isSelfClosing = !!selfClosingMatch || isVoid;

		// Parse attributes (only href and src are allowed in Telegraph)
		const attrs: Record<string, string> = {};
		const attrRegex = /\b(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/gi;
		let attrMatch: RegExpExecArray | null;
		while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
			attrs[attrMatch[1].toLowerCase()] = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4];
		}

		const element: TelegraphElement = { tag: tagName };
		if (Object.keys(attrs).length > 0) element.attrs = attrs;

		if (isSelfClosing) {
			if (ALLOWED_TAGS.has(tagName)) {
				const parent = stack.length ? stack[stack.length - 1] : null;
				if (parent) {
					if (!parent.children) parent.children = [];
					parent.children.push(element);
				} else {
					nodes.push(element);
				}
			}
		} else {
			stack.push(element);
		}
	}

	// Flush any remaining unclosed tags
	while (stack.length > 0) {
		const unclosed = stack.pop()!;
		const parent = stack.length ? stack[stack.length - 1] : null;
		if (ALLOWED_TAGS.has(unclosed.tag)) {
			if (parent) {
				if (!parent.children) parent.children = [];
				parent.children.push(unclosed);
			} else {
				nodes.push(unclosed);
			}
		} else {
			const children = unclosed.children ?? [];
			if (parent) {
				if (!parent.children) parent.children = [];
				parent.children.push(...children);
			} else {
				nodes.push(...children);
			}
		}
	}

	return flattenParagraphs(nodes);
}

/** Ensure top-level text nodes are wrapped in <p> for Telegraph. */
function flattenParagraphs(nodes: TelegraphNode[]): TelegraphNode[] {
	const result: TelegraphNode[] = [];
	let pendingText: string[] = [];

	function flushText() {
		if (pendingText.length > 0) {
			const text = pendingText.join('').trim();
			if (text) {
				result.push({ tag: 'p', children: [text] });
			}
			pendingText = [];
		}
	}

	for (const node of nodes) {
		if (typeof node === 'string') {
			pendingText.push(node);
		} else {
			flushText();
			result.push(node);
		}
	}
	flushText();

	// Telegraph requires at least one node
	if (result.length === 0) {
		result.push({ tag: 'p', children: ['(empty)'] });
	}

	return result;
}

function decodeEntities(text: string): string {
	return text
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
		.replace(/&nbsp;/g, ' ');
}

// ─── Token selection ─────────────────────────────────────────────────────────

/**
 * Deterministic token selection based on seed string.
 * Same article always uses the same token (stable across retries).
 */
export function pickToken(tokens: string[], seed: string): string {
	if (tokens.length === 0) throw new Error('No Telegraph tokens configured');
	if (tokens.length === 1) return tokens[0];

	// Simple hash: sum of char codes
	let hash = 0;
	for (let i = 0; i < seed.length; i++) {
		hash = (hash * 31 + seed.charCodeAt(i)) | 0;
	}
	const index = Math.abs(hash) % tokens.length;
	return tokens[index];
}

/** Parse comma-separated token string into array. */
export function parseTokens(raw: string): string[] {
	return raw
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);
}

// ─── Telegraph API ───────────────────────────────────────────────────────────

/**
 * Create a Telegraph page with HTML content.
 * Returns the page URL on success, or null on failure.
 */
export async function createTelegraphPage(params: {
	token: string;
	title: string;
	content: TelegraphNode[];
	authorName?: string;
}): Promise<string | null> {
	const body = {
		access_token: params.token,
		title: params.title.slice(0, 256),
		content: JSON.stringify(params.content),
		author_name: params.authorName?.slice(0, 128) ?? '',
		return_content: false,
	};

	try {
		const resp = await fetch('https://api.telegra.ph/createPage', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});

		const data = (await resp.json()) as TelegraphPageResult;

		if (data.ok && data.result?.url) {
			return data.result.url;
		}

		console.error('Telegraph createPage failed:', data.error ?? 'unknown error');
		return null;
	} catch (err) {
		console.error('Telegraph API request failed:', err);
		return null;
	}
}
