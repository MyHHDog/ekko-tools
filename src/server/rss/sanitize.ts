import sanitize from 'sanitize-html';
const tags = 'a b i u em strong p br hr div span blockquote pre code ul ol li table thead tbody tr td th h1 h2 h3 h4 h5 h6 img figure figcaption sub sup'.split(' ');
export function sanitizeArticle(raw: string) {
  return sanitize(raw.slice(0, 512 * 1024), {
    allowedTags: tags,
    allowedAttributes: {
      a: ['href', 'title'], img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'referrerpolicy'],
      code: ['class'], '*': ['style'],
    },
    allowedSchemes: ['http', 'https'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: ['script', 'style', 'textarea', 'option', 'iframe', 'object', 'embed', 'svg', 'math'],
    transformTags: {
      a: (_tag, attrs) => ({ tagName: 'a', attribs: { ...attrs, rel: 'noopener noreferrer nofollow', target: '_blank' } }),
      img: (_tag, attrs) => {
        const src = (attrs.src || '').trim();
        const tiny = (attrs.width === '1' && attrs.height === '1') || /pixel|beacon|track/i.test(src);
        if (!src || tiny) return { tagName: 'span', attribs: {} };
        return { tagName: 'img', attribs: { ...attrs, src, loading: 'lazy', referrerpolicy: 'no-referrer', alt: attrs.alt || '' } };
      },
    },
  });
}
export function articleText(html: string) {
  return sanitize(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
export function firstImage(html: string) {
  const match = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(html);
  return match?.[1]?.startsWith('http') ? match[1] : undefined;
}
