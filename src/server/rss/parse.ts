import { parseFeed } from 'feedsmith';
import { AppError } from '../../shared/error-codes';
import { articleText, firstImage, sanitizeArticle } from './sanitize';
export interface ParsedEntry {
  guid: string; title: string; url: string; author?: string; publishedAt: number;
  snippet: string; contentHtml: string; contentText: string; image?: string; lang?: string;
}
export interface ParsedFeed {
  title: string; siteUrl: string; description: string; icon: string;
  entries: ParsedEntry[]; nextUrl?: string;
}
function stamp(value: unknown) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : Date.now();
}
function text(value: unknown) { return articleText(String(value || '')); }
function clean(value: unknown) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function absoluteUrl(value: unknown, base?: string) {
  const raw = clean(value);
  if (!raw) return '';
  if (/^data:/i.test(raw)) return raw;
  try { return new URL(raw, base || undefined).toString(); } catch { return raw; }
}
function faviconUrl(siteUrl: string) {
  if (!siteUrl) return '';
  try { return new URL('/favicon.ico', siteUrl).toString(); } catch { return ''; }
}
function nextLink(links: any[] | undefined) {
  return clean((links || []).find(link => String(link?.rel || '').toLowerCase() === 'next')?.href);
}
// 相对图标按站点地址补全；订阅未声明图标时回退站点 favicon，侧栏可直接展示。
function finish(parsed: ParsedFeed, feedUrl?: string): ParsedFeed {
  const siteUrl = absoluteUrl(parsed.siteUrl, feedUrl);
  const nextUrl = absoluteUrl(parsed.nextUrl, feedUrl);
  return {
    ...parsed, siteUrl, nextUrl: nextUrl || undefined,
    icon: absoluteUrl(parsed.icon, siteUrl || feedUrl) || faviconUrl(siteUrl),
  };
}
function entry(input: { guid: string; title: string; url: string; author?: string; date?: unknown; html?: string; text?: string; image?: string; lang?: string }): ParsedEntry {
  const rawHtml = input.html || '';
  const html = sanitizeArticle(rawHtml);
  const contentText = text(rawHtml || input.text || input.title);
  return {
    guid: input.guid || input.url || input.title, title: clean(input.title) || clean(input.url) || '未命名文章',
    url: input.url, author: input.author ? clean(input.author) : undefined, publishedAt: stamp(input.date),
    snippet: contentText.slice(0, 180), contentHtml: html, contentText,
    image: input.image || firstImage(html), lang: input.lang,
  };
}
export function parseSubscription(body: string, feedUrl?: string): ParsedFeed {
  let parsed: any;
  try { parsed = parseFeed(body); }
  catch { throw new AppError('FEED_INVALID'); }
  if (!parsed?.feed) throw new AppError('FEED_INVALID');
  const feed = parsed.feed;
  if (parsed.format === 'atom') {
    const links: any[] = feed.links || [];
    const siteUrl = links.find(link => !link.rel || link.rel === 'alternate')?.href || '';
    return finish({
      title: clean(feed.title?.value) || clean(siteUrl) || '未命名订阅',
      siteUrl, description: text(feed.subtitle?.value), icon: clean(feed.icon || feed.logo),
      nextUrl: nextLink(links),
      entries: (feed.entries || []).map((item: any) => {
        const itemLinks: any[] = item.links || [];
        const url = itemLinks.find(link => !link.rel || link.rel === 'alternate')?.href || item.id || siteUrl;
        return entry({
          guid: clean(item.id) || url, title: clean(item.title?.value), url,
          author: item.authors?.[0]?.name, date: item.published || item.updated,
          html: item.content?.value || item.summary?.value, text: item.summary?.value,
          image: item.media?.thumbnail?.url, lang: item.lang,
        });
      }),
    }, feedUrl);
  }
  if (parsed.format === 'json') {
    const siteUrl = clean(feed.home_page_url);
    return finish({
      title: clean(feed.title) || siteUrl || '未命名订阅', siteUrl,
      description: text(feed.description), icon: clean(feed.icon || feed.favicon),
      nextUrl: clean(feed.next_url),
      entries: (feed.items || []).map((item: any) => entry({
        guid: clean(item.id) || clean(item.url), title: clean(item.title), url: clean(item.url || item.external_url || siteUrl),
        author: item.authors?.[0]?.name, date: item.date_published || item.date_modified,
        html: item.content_html, text: item.content_text || item.summary, image: item.image || item.banner_image,
        lang: item.language,
      })),
    }, feedUrl);
  }
  if (parsed.format === 'rdf') {
    const siteUrl = clean(feed.link);
    return finish({
      title: clean(feed.title) || siteUrl || '未命名订阅', siteUrl,
      description: text(feed.description), icon: clean(feed.image?.url),
      nextUrl: nextLink(feed.atom?.links),
      entries: (feed.items || []).map((item: any) => entry({
        guid: clean(item.rdf?.about) || clean(item.link), title: clean(item.title),
        url: clean(item.link || item.rdf?.about || siteUrl), author: item.dc?.creator,
        date: item.dc?.date || item.dcterms?.issued || item.atom?.updated,
        html: item.content?.value || item.description, image: item.media?.thumbnail?.url,
      })),
    }, feedUrl);
  }
  const siteUrl = clean(feed.link || feed.atom?.links?.[0]?.href);
  return finish({
    title: clean(feed.title) || siteUrl || '未命名订阅', siteUrl,
    description: text(feed.description), icon: clean(feed.image?.url || feed.atom?.icon || feed.itunes?.image?.href),
    nextUrl: nextLink(feed.atom?.links),
    entries: (feed.items || []).map((item: any) => entry({
      guid: clean(item.guid?.value) || clean(item.link), title: clean(item.title),
      url: clean(item.link || siteUrl), author: item.authors?.[0]?.name || item.dc?.creator,
      date: item.pubDate || item.dc?.date || item.dcterms?.issued,
      html: item.content?.value || item.description || item.atom?.content?.value,
      image: item.enclosures?.find((value: any) => /^image\//i.test(value.type || ''))?.url ||
        item.media?.thumbnail?.url, lang: feed.language,
    })),
  }, feedUrl);
}
