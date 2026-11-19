export const feedCategories = [
  { id: 'tech', name: '科技资讯', description: '互联网、消费电子与产业动态' },
  { id: 'dev', name: '开发技术', description: '工程实践、开源与开发者工具' },
  { id: 'ai', name: 'AI 前沿', description: '模型、研究与应用进展' },
  { id: 'design', name: '产品设计', description: '产品方法、体验与设计实践' },
  { id: 'business', name: '商业财经', description: '公司、市场与商业分析' },
  { id: 'news', name: '新闻时事', description: '国内外重要新闻与深度报道' },
  { id: 'science', name: '科学探索', description: '科学研究、自然与太空探索' },
  { id: 'reading', name: '阅读写作', description: '文学、书评与长文随笔' },
  { id: 'digital', name: '数码生活', description: '软件、硬件与数字生活方式' },
] as const;

export type FeedCategoryId = typeof feedCategories[number]['id'];

export interface FeedCatalogItem {
  id: string;
  title: string;
  url: string;
  siteUrl: string;
  category: FeedCategoryId;
  description: string;
  via?: string;
}

export const feedCatalog: FeedCatalogItem[] = [
  { id: 'sspai', title: '少数派', url: 'https://sspai.com/feed', siteUrl: 'https://sspai.com', category: 'tech', description: '效率工具、数字生活与消费决策。' },
  { id: 'ithome', title: 'IT之家', url: 'https://www.ithome.com/rss/', siteUrl: 'https://www.ithome.com', category: 'tech', description: '国内科技新闻与数码产品快讯。' },
  { id: '36kr', title: '36氪', url: 'https://www.36kr.com/feed', siteUrl: 'https://www.36kr.com', category: 'tech', description: '创业、融资与新经济公司动态。' },
  { id: 'ruanyifeng', title: '\u962E\u4E00\u5CF0\u7684\u7F51\u7EDC\u65E5\u5FD7', url: 'https://www.ruanyifeng.com/blog/atom.xml', siteUrl: 'https://www.ruanyifeng.com/blog/', category: 'dev', description: '每周科技周刊与 Web 开发随笔。' },
  { id: 'infoq-cn', title: 'InfoQ 中文', url: 'https://www.infoq.cn/feed', siteUrl: 'https://www.infoq.cn', category: 'dev', description: '架构、工程实践与技术大会内容。' },
  { id: 'github-blog', title: 'GitHub Blog', url: 'https://github.blog/feed/', siteUrl: 'https://github.blog', category: 'dev', description: 'GitHub 产品、开源生态与工程实践。' },
  { id: 'qbitai', title: '量子位', url: 'https://www.qbitai.com/feed', siteUrl: 'https://www.qbitai.com', category: 'ai', description: '国内 AI 产业、模型与产品资讯。' },
  { id: 'jiqizhixin', title: '机器之心', url: 'https://plink.anyfeeder.com/weixin/almosthuman2014', siteUrl: 'https://www.jiqizhixin.com', category: 'ai', description: 'AI 研究、论文与产业应用报道。', via: 'AnyFeeder' },
  { id: 'openai', title: 'OpenAI News', url: 'https://openai.com/blog/rss.xml', siteUrl: 'https://openai.com/news/', category: 'ai', description: 'OpenAI 模型、产品与安全研究动态。' },
  { id: 'woshipm', title: '人人都是产品经理', url: 'https://www.woshipm.com/feed', siteUrl: 'https://www.woshipm.com', category: 'design', description: '产品方法、用户研究与职业成长。' },
  { id: 'figma-blog', title: 'Figma Blog', url: 'https://www.figma.com/blog/feed/atom.xml', siteUrl: 'https://www.figma.com/blog/', category: 'design', description: '设计协作、产品设计与团队工作流。' },
  { id: 'nng', title: 'Nielsen Norman Group', url: 'https://www.nngroup.com/feed/rss/', siteUrl: 'https://www.nngroup.com/articles/', category: 'design', description: '用户体验研究与可用性方法论。' },
  { id: 'wallstreetcn', title: '华尔街见闻', url: 'https://plink.anyfeeder.com/weixin/wallstreetcn', siteUrl: 'https://wallstreetcn.com', category: 'business', description: '全球市场、宏观与公司快讯。', via: 'AnyFeeder' },
  { id: 'caixin', title: '财新网', url: 'https://plink.anyfeeder.com/weixin/caixinwang', siteUrl: 'https://www.caixin.com', category: 'business', description: '财经调查、政策与商业深度报道。', via: 'AnyFeeder' },
  { id: 'hbrchina', title: '哈佛商业评论', url: 'https://plink.anyfeeder.com/weixin/hbrchinese', siteUrl: 'https://www.hbrchina.org', category: 'business', description: '管理、战略与组织实践。', via: 'AnyFeeder' },
  { id: 'xinhua', title: '新华社', url: 'https://plink.anyfeeder.com/newscn/whxw', siteUrl: 'https://www.news.cn', category: 'news', description: '国内外重大新闻与权威发布。', via: 'AnyFeeder' },
  { id: 'thepaper', title: '澎湃新闻', url: 'https://plink.anyfeeder.com/thepaper', siteUrl: 'https://www.thepaper.cn', category: 'news', description: '时政、社会与深度调查报道。', via: 'AnyFeeder' },
  { id: 'bbc-cn', title: 'BBC News 中文', url: 'https://plink.anyfeeder.com/bbc/cn', siteUrl: 'https://www.bbc.com/zhongwen/simp', category: 'news', description: '国际新闻与全球议题的中文报道。', via: 'AnyFeeder' },
  { id: 'guokr', title: '果壳', url: 'https://plink.anyfeeder.com/weixin/Guokr42', siteUrl: 'https://www.guokr.com', category: 'science', description: '泛科学、健康与生活科普。', via: 'AnyFeeder' },
  { id: 'nature', title: 'Nature', url: 'https://www.nature.com/nature.rss', siteUrl: 'https://www.nature.com', category: 'science', description: '全球自然科学研究与期刊动态。' },
  { id: 'quanta', title: 'Quanta Magazine', url: 'https://www.quantamagazine.org/feed/', siteUrl: 'https://www.quantamagazine.org', category: 'science', description: '数学、物理与生命科学的深度报道。' },
  { id: 'lifeweek', title: '三联生活周刊', url: 'https://plink.anyfeeder.com/weixin/lifeweek', siteUrl: 'https://www.lifeweek.com.cn', category: 'reading', description: '社会、文化与生活方式的深度报道。', via: 'AnyFeeder' },
  { id: 'dandu', title: '单读', url: 'https://plink.anyfeeder.com/weixin/dandureading', siteUrl: 'https://www.owspace.com', category: 'reading', description: '文学、思想与青年文化内容。', via: 'AnyFeeder' },
  { id: 'aeon', title: 'Aeon', url: 'https://aeon.co/feed.rss', siteUrl: 'https://aeon.co', category: 'reading', description: '哲学、科学与文化议题的长文。' },
  { id: 'appinn', title: '小众软件', url: 'https://www.appinn.com/feed/', siteUrl: 'https://www.appinn.com', category: 'digital', description: '独立软件、效率工具与使用技巧。' },
  { id: 'dgtle', title: '数字尾巴', url: 'https://plink.anyfeeder.com/dgtle', siteUrl: 'https://www.dgtle.com', category: 'digital', description: '数码产品、生活方式与摄影。', via: 'AnyFeeder' },
  { id: 'gcores', title: '机核', url: 'https://www.gcores.com/rss', siteUrl: 'https://www.gcores.com', category: 'digital', description: '游戏、亚文化与创作者访谈。' },
];

export function feedHost(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

export function normalizeFeedUrl(url: string) {
  try {
    const value = new URL(url.trim());
    value.hash = '';
    value.hostname = value.hostname.toLowerCase();
    value.pathname = value.pathname.replace(/\/+$/, '') || '/';
    return value.toString();
  } catch {
    return url.trim().replace(/\/+$/, '');
  }
}

export function sameFeedUrl(left: string, right: string) {
  return normalizeFeedUrl(left) === normalizeFeedUrl(right);
}
