import type { RssItem } from './rss';

type DbRow = {
	id: string;
	title: string;
	link: string | null;
	pubDateMs: number;
	description: string | null;
	htmlContent: string | null;
};

function coerceRow(row: DbRow): RssItem {
	return {
		id: row.id,
		title: row.title,
		link: row.link ?? undefined,
		pubDate: new Date(row.pubDateMs),
		description: row.description ?? undefined,
		htmlContent: row.htmlContent ?? undefined,
	};
}

async function ensureSchema(env: Env) {
	if (!env.DB) return;
	// In local/unit tests, Wrangler D1 migrations may not run automatically.
	// Ensure the table exists so the worker can still serve an empty feed.
	await env.DB.exec(
		'CREATE TABLE IF NOT EXISTS rss_items (id TEXT PRIMARY KEY, title TEXT NOT NULL, link TEXT, pubDateMs INTEGER NOT NULL, description TEXT, htmlContent TEXT); ' +
			'CREATE INDEX IF NOT EXISTS rss_items_pubDateMs_idx ON rss_items (pubDateMs);',
	);

	// If the table was created by an older migration, add the missing column.
	const cols = await env.DB.prepare("SELECT name FROM pragma_table_info('rss_items') WHERE name = 'htmlContent'").first();
	if (!cols) {
		await env.DB.exec('ALTER TABLE rss_items ADD COLUMN htmlContent TEXT;');
	}
}

export async function saveRssItem(env: Env, params: { id: string; item: RssItem }) {
	if (!env.DB) return;

	await ensureSchema(env);

	const tsMs = params.item.pubDate.getTime();

	// id is PRIMARY KEY, so this insert is naturally deduped.
	// If the same newsletter arrives multiple times, later inserts will be ignored.
	await env.DB
		.prepare(
			`INSERT OR IGNORE INTO rss_items (id, title, link, pubDateMs, description, htmlContent)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			params.item.id,
			params.item.title,
			params.item.link ?? null,
			tsMs,
			params.item.description ?? null,
			params.item.htmlContent ?? null,
		)
		.run();
}

export async function listRssItems(env: Env, limit: number): Promise<RssItem[]> {
	if (!env.DB) return [];

	await ensureSchema(env);

	// Use pubDateMs for time-ordered feed output.
	const rows = await env.DB
		.prepare(
			`SELECT id, title, link, pubDateMs, description, htmlContent
			 FROM rss_items
			 ORDER BY pubDateMs DESC
			 LIMIT ?`,
		)
		.bind(limit)
		.all<DbRow>();

	return rows.results.map(coerceRow);
}
