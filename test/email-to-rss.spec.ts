import { describe, it, expect } from 'vitest';
import { parseNewsletterToRssItem } from '../src/email/parse';

function toReadableStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
}

function makeTestEmailMessage(rawEmail: string) {
	const bytes = new TextEncoder().encode(rawEmail);
	return {
		from: 'sender@example.com',
		to: 'recipient@example.com',
		raw: toReadableStream(bytes),
		rawSize: bytes.byteLength,
		headers: new Headers([
			['message-id', '<msg-1@example.com>'],
		]),
		setReject() {
			// noop
		},
		forward() {
			return Promise.resolve();
		},
		reply() {
			return Promise.resolve();
		},
	};
}

describe('email -> rss item', () => {
	it('extracts title, link, pubDate from a simple text email', async () => {
		const rawEmail = `From: sender@example.com
To: recipient@example.com
Subject: Weekly News
Date: Fri, 20 Mar 2026 10:00:00 +0000
Message-ID: <msg-1@example.com>
Content-Type: text/plain; charset="utf-8"

Hello!
Read more at https://example.com/article.
`;

		const message = makeTestEmailMessage(rawEmail);
		const item = await parseNewsletterToRssItem(message as any, { baseUrl: 'https://example.com' });

		expect(item?.title).toBe('Weekly News');
		expect(item?.link).toBe('https://example.com/article');
		expect(item?.description).toContain('Read more at https://example.com/article.');
		expect(item?.id).toHaveLength(64); // sha256 hex
		expect(item?.pubDate.toUTCString()).toContain('20 Mar 2026');
	});
});

