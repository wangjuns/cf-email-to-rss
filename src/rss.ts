export type RssItem = {
	id: string;
	title: string;
	link?: string;
	pubDate: Date;
	description?: string;
	/** Cleaned HTML from the original email, preserving structure. */
	htmlContent?: string;
};

function escapeXml(input: string): string {
	return input
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function cdata(text: string): string {
	// Avoid prematurely closing CDATA sections.
	const safe = text.replaceAll(']]>', ']]]]><![CDATA[>');
	return `<![CDATA[${safe}]]>`;
}

export function buildRssXml(params: {
	title: string;
	link: string;
	description?: string;
	items: RssItem[];
}): string {
	const { title, link, description, items } = params;

	const channelDescription = description ?? title;

	const itemsXml = items
		.map((item) => {
			const guid = escapeXml(item.id);
			const itemTitle = escapeXml(item.title);
			const itemLink = escapeXml(item.link ?? link);
			const pubDateRfc822 = item.pubDate.toUTCString();
			const descSource = item.htmlContent ?? item.description;
			const desc = descSource ? cdata(descSource) : cdata('');

			return [
				'<item>',
				`<title>${itemTitle}</title>`,
				`<link>${itemLink}</link>`,
				`<guid isPermaLink="false">${guid}</guid>`,
				`<pubDate>${escapeXml(pubDateRfc822)}</pubDate>`,
				`<description>${desc}</description>`,
				'</item>',
			].join('');
		})
		.join('');

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<rss version="2.0">',
		'<channel>',
		`<title>${escapeXml(title)}</title>`,
		`<link>${escapeXml(link)}</link>`,
		`<description>${escapeXml(channelDescription)}</description>`,
		itemsXml,
		'</channel>',
		'</rss>',
	].join('');
}

