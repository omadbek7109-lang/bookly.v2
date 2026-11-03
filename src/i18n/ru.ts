import type { MessageKey } from './uz';

/** Russian (beta). Missing keys fall back to Uzbek. */
const ru: Partial<Record<MessageKey, string>> = {
  'common.save': 'Сохранить', 'common.saved': 'Сохранено', 'common.saving': 'Сохранение…', 'common.cancel': 'Отмена', 'common.close': 'Закрыть',
  'common.delete': 'Удалить', 'common.edit': 'Редактировать', 'common.open': 'Открыть', 'common.back': 'Назад', 'common.next': 'Далее',
  'common.prev': 'Назад', 'common.done': 'Готово', 'common.apply': 'Применить', 'common.accept': 'Принять', 'common.reject': 'Отклонить',
  'common.search': 'Поиск', 'common.seeAll': 'Все', 'common.loading': 'Загрузка…', 'common.rename': 'Переименовать',
  'common.duplicate': 'Дублировать', 'common.preview': 'Просмотр', 'common.export': 'Экспорт', 'common.restore': 'Восстановить',
  'common.favorite': 'Избранное', 'common.chapters': '{n} глав', 'common.words': '{n} слов', 'common.untitled': 'Книга без названия',
  'nav.home': 'Главная', 'nav.books': 'Книги', 'nav.studio': 'Студия', 'nav.templates': 'Шаблоны', 'nav.profile': 'Профиль',
  'nav.create': 'Создать', 'nav.export': 'Экспорт', 'splash.skip': 'Пропустить',
  'create.title': 'Что создадим?', 'create.ai': 'Книга с ИИ', 'create.blank': 'Пустая книга', 'create.template': 'Из шаблона', 'create.import': 'Импорт файла',
  'home.greeting.morning': 'Доброе утро', 'home.greeting.day': 'Добрый день', 'home.greeting.evening': 'Добрый вечер', 'home.greeting.night': 'Доброй ночи',
  'home.hero1.badge': 'Создание книг с ИИ', 'home.hero1.title': 'Превратите идею в книгу',
  'home.hero1.text': 'Создавайте книги, статьи и презентации с помощью ИИ.', 'home.hero1.cta': 'Создать с ИИ',
  'home.qa.new': 'Новая книга', 'home.qa.studio': 'AI Студия', 'home.qa.templates': 'Шаблоны', 'home.qa.cover': 'Обложка',
  'home.qa.library': 'Библиотека', 'home.qa.exports': 'Экспорт', 'home.qa.import': 'Импорт', 'home.qa.settings': 'Настройки',
  'home.continue': 'Продолжить', 'home.recent': 'Недавние книги', 'home.favorites': 'Избранные книги', 'home.quick': 'Быстрый старт',
  'home.stats': 'Статистика', 'home.empty.title': 'Создайте первую книгу',
  'books.title': 'Моя библиотека', 'books.tab.all': 'Все', 'books.tab.drafts': 'Черновики', 'books.tab.completed': 'Готовые',
  'books.tab.favorites': 'Избранное', 'books.tab.recent': 'Недавние', 'books.tab.trash': 'Корзина',
  'profile.title': 'Профиль', 'profile.settings': 'Настройки', 'profile.language': 'Язык интерфейса', 'profile.theme': 'Тема',
  'profile.theme.system': 'Системная', 'profile.theme.light': 'Светлая', 'profile.theme.dark': 'Тёмная', 'profile.about': 'О Bookly', 'profile.privacy': 'Конфиденциальность',
  'export.title': 'Центр экспорта', 'templates.title': 'Шаблоны', 'studio.title': 'AI Студия', 'editor.chapters': 'Главы',
};
export default ru;
