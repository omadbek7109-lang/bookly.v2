import type { MessageKey } from './uz';

/** English (beta). Missing keys fall back to Uzbek. */
const en: Partial<Record<MessageKey, string>> = {
  'common.save': 'Save', 'common.saved': 'Saved', 'common.saving': 'Saving…', 'common.cancel': 'Cancel', 'common.close': 'Close',
  'common.delete': 'Delete', 'common.edit': 'Edit', 'common.open': 'Open', 'common.back': 'Back', 'common.next': 'Next',
  'common.prev': 'Previous', 'common.done': 'Done', 'common.apply': 'Apply', 'common.accept': 'Accept', 'common.reject': 'Reject',
  'common.search': 'Search', 'common.seeAll': 'See all', 'common.loading': 'Loading…', 'common.rename': 'Rename',
  'common.duplicate': 'Duplicate', 'common.preview': 'Preview', 'common.export': 'Export', 'common.restore': 'Restore',
  'common.favorite': 'Favorite', 'common.chapters': '{n} chapters', 'common.words': '{n} words', 'common.untitled': 'Untitled book',
  'nav.home': 'Home', 'nav.books': 'Books', 'nav.studio': 'Studio', 'nav.templates': 'Templates', 'nav.profile': 'Profile',
  'nav.create': 'Create', 'nav.export': 'Exports', 'splash.skip': 'Skip',
  'create.title': 'What shall we create?', 'create.ai': 'Book with AI', 'create.blank': 'Blank book', 'create.template': 'From template', 'create.import': 'Import file',
  'home.greeting.morning': 'Good morning', 'home.greeting.day': 'Good afternoon', 'home.greeting.evening': 'Good evening', 'home.greeting.night': 'Good night',
  'home.hero1.badge': 'Create books with AI', 'home.hero1.title': 'Turn your idea into a book',
  'home.hero1.text': 'Create books, articles or presentations with artificial intelligence.', 'home.hero1.cta': 'Create with AI',
  'home.qa.new': 'New book', 'home.qa.studio': 'AI Studio', 'home.qa.templates': 'Templates', 'home.qa.cover': 'Cover',
  'home.qa.library': 'My library', 'home.qa.exports': 'Exports', 'home.qa.import': 'Import', 'home.qa.settings': 'Settings',
  'home.continue': 'Continue editing', 'home.recent': 'Recent books', 'home.favorites': 'Favorite books', 'home.quick': 'Quick start',
  'home.stats': 'Statistics', 'home.empty.title': 'Create your first book',
  'books.title': 'My library', 'books.tab.all': 'All', 'books.tab.drafts': 'Drafts', 'books.tab.completed': 'Completed',
  'books.tab.favorites': 'Favorites', 'books.tab.recent': 'Recent', 'books.tab.trash': 'Trash',
  'profile.title': 'Profile', 'profile.settings': 'Settings', 'profile.language': 'Interface language', 'profile.theme': 'Theme',
  'profile.theme.system': 'System', 'profile.theme.light': 'Light', 'profile.theme.dark': 'Dark', 'profile.about': 'About Bookly', 'profile.privacy': 'Privacy',
  'export.title': 'Export center', 'templates.title': 'Templates', 'studio.title': 'AI Studio', 'editor.chapters': 'Chapters',
};
export default en;
