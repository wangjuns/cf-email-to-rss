import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('Email -> RSS worker', () => {
	it('responds with RSS feed xml (unit style)', async () => {
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(new IncomingRequest('http://example.com/feed.xml'), env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		const text = await response.text();
		expect(text).toContain('<rss version="2.0">');
		expect(text).toContain('<channel>');
		// No items in unit tests because D1 binding is absent.
		expect(text).not.toContain('<item>');
	});

	it('stores parsed newsletter in D1 and returns it in /feed.xml', async () => {
		const rawEmail = `From: sender@example.com
To: recipient@example.com
Subject: Weekly News
Date: Fri, 20 Mar 2026 10:00:00 +0000
Message-ID: <msg-1@example.com>
Content-Type: text/plain; charset="utf-8"

Hello!
Read more at https://example.com/article.
`;

		const bytes = new TextEncoder().encode(rawEmail);
		const message = {
			from: 'sender@example.com',
			to: 'recipient@example.com',
			raw: new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(bytes);
					controller.close();
				},
			}),
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

		const ctx = createExecutionContext();
		await worker.email(message as any, env as any, ctx);
		await waitOnExecutionContext(ctx);

		const response = await worker.fetch(new IncomingRequest('http://example.com/feed.xml'), env, ctx);
		const text = await response.text();

		expect(text).toContain('<item>');
		expect(text).toContain('<title>Weekly News</title>');
		expect(text).toContain('https://example.com/article');
	});

	it('responds with RSS feed xml (integration style)', async () => {
		const response = await SELF.fetch('https://example.com/feed.xml');
		const text = await response.text();
		expect(text).toContain('<rss version="2.0">');
		expect(text).toContain('<channel>');
	});
});
