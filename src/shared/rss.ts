export type RssSummaryProvider = 'hostModel' | 'openai';
export type RssSummaryLang = 'zh' | 'en';
export type RssArticleTheme = 'paper' | 'sepia' | 'dark';
export type RssArticleFont = 'serif' | 'sans' | 'mono';
export interface RssFolder { id: string; name: string; createdAt: number; unread?: number }
export interface RssFeed {
  id: string; url: string; title: string; siteUrl: string; description: string;
  icon: string; folderId?: string; enabled: boolean; lastFetchedAt?: number;
  lastError?: string; unread?: number;
}
export interface RssEntryItem {
  id: string; feedId: string; feedTitle: string; feedIcon?: string; title: string;
  url: string; author?: string; publishedAt: number; snippet: string;
  read: boolean; starred: boolean; hasSummary: boolean; image?: string;
}
export interface RssSummary {
  tldr: string; points: string[]; whyRead: string; tags: string[];
  model: string; createdAt: number;
}
export interface RssEntry extends RssEntryItem {
  contentHtml: string; contentText: string; fetchedAt: number; summary?: RssSummary;
}
export interface RssEntryPage {
  items: RssEntryItem[]; nextCursor?: number; total: number; unread: number;
}
export interface RssDigestItem { entryId: string; title: string; url: string; line: string; source: string }
export interface RssDigestSection { name: string; items: RssDigestItem[] }
export interface RssDigest {
  id: string; title: string; overview: string; sections: RssDigestSection[];
  period: string; createdAt: number;
}
export interface RssSettings {
  summaryProvider: RssSummaryProvider; summaryModel: string; summaryLang: RssSummaryLang;
  autoSummary: boolean; pollMinutes: number; retentionDays: number;
  maxEntriesPerFeed: number; fullText: boolean; remoteImages: boolean;
  articleTheme: RssArticleTheme; articleFont: RssArticleFont;
  articleFontSize: number; articleLineHeight: number; articleWidth: number;
  articleCustomCss: string;
}
export interface RssCounts { feeds: number; unread: number; today: number; starred: number }
export interface RssBootstrap {
  folders: RssFolder[]; feeds: RssFeed[]; settings: RssSettings;
  counts: RssCounts; lastSyncAt?: number; digest?: RssDigest;
}
export const defaultRssSettings: RssSettings = {
  summaryProvider: 'hostModel', summaryModel: '', summaryLang: 'zh',
  autoSummary: false, pollMinutes: 15, retentionDays: 90,
  maxEntriesPerFeed: 2000, fullText: true, remoteImages: true,
  articleTheme: 'paper', articleFont: 'serif',
  articleFontSize: 16, articleLineHeight: 1.85, articleWidth: 720,
  articleCustomCss: '',
};
