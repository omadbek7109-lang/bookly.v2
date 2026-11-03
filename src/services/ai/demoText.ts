/**
 * DemoTextAIProvider — deterministic, offline sample-content generator.
 *
 * It produces realistic-looking structured content so every AI workflow can be exercised in
 * Phase 1. It is NOT a language model. Replace via `setTextProvider()` in Phase 2.
 */
import { createBlock, type Block, type BookCategory, type BookLanguage, type WritingTone } from '../../models/book';
import { escapeHtml } from '../../utils/inline';
import { sleep, type BookBrief, type BookOutline, type ChapterRequest, type TextAIProvider, type TextOptions } from './types';

// ------------------------------------------------------------------ helpers

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, arr: T[]): T { return arr[Math.floor(r() * arr.length) % arr.length]; }

function shuffle<T>(r: () => number, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const cap = (s: string) => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s);
const lower = (s: string) => (s ? s.charAt(0).toLocaleLowerCase() + s.slice(1) : s);
const fill = (tpl: string, v: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');

export function splitSentences(text: string): string[] {
  return text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+(?=[\p{Lu}0-9"“«(])/u).filter(Boolean);
}

// ------------------------------------------------------------------ language packs

interface Pack {
  titleSuffix: string[];
  subtitle: string[];
  description: string;
  outline: Record<'nonfiction' | 'fiction' | 'children', string[]>;
  opener: string[];
  body: string[];
  sectionTitles: string[];
  listIntro: string[];
  points: string[];
  quotes: { text: string; cite: string }[];
  closer: string[];
  continue: string[];
  expand: string[];
  intro: string[];
  conclusion: string[];
  tablesHead: [string, string, string];
  tableRows: [string, string, string][];
  storyOpen: string[];
  storyBody: string[];
  connectors: string[];
  tone: Record<WritingTone, { prefix: string[]; suffix: string[] }>;
}

const UZ: Pack = {
  titleSuffix: ['asoslari', 'bo‘yicha to‘liq qo‘llanma', 'sirlari', ': noldan natijagacha', 'amalda'],
  subtitle: ['Amaliy qo‘llanma va real misollar', 'Bosqichma-bosqich yo‘l xaritasi', 'Har kun uchun foydali bilimlar', 'Yangi boshlovchilar uchun aniq tushuntirishlar'],
  description: '“{title}” — {topic} mavzusini {audience} uchun tushunarli va amaliy tarzda yorituvchi kitob. Unda asosiy tushunchalar, real hayotiy misollar va darhol qo‘llash mumkin bo‘lgan qadamlar jamlangan.',
  outline: {
    nonfiction: [
      'Kirish: {topic} nima va nega muhim', '{Topic}ning asosiy tushunchalari', 'Qisqacha tarix va bugungi holat', 'Birinchi qadamlar: qayerdan boshlash kerak',
      'Kundalik hayotda {topic}', 'Keng tarqalgan xatolar va ulardan qochish', 'Samarali usullar va vositalar', 'Real hayotiy misollar va tahlil',
      'Rejalashtirish va maqsad qo‘yish', 'Natijani o‘lchash va baholash', 'Ilg‘or strategiyalar', 'Jamoa va hamjamiyat bilan ishlash',
      'Raqamli davrda {topic}', 'Motivatsiya va barqaror odatlar', 'Savollar va javoblar', 'Kelajak istiqbollari', 'Amaliy mashqlar to‘plami',
      'Shaxsiy yo‘l xaritasi', 'Mutaxassislar tavsiyalari', 'Xulosa va keyingi qadamlar',
    ],
    fiction: [
      'Boshlanish', 'Kutilmagan xabar', 'Birinchi qadam', 'Eski sir', 'Yo‘lda', 'Ishonch sinovi', 'Bo‘ron oldidan', 'Burilish nuqtasi', 'Yo‘qotish',
      'Yangi ittifoq', 'Qorong‘i tun', 'Haqiqat yuzaga chiqadi', 'Hal qiluvchi tanlov', 'Qaytish', 'Yangi tong', 'Uzoq xotiralar', 'So‘nggi sinov', 'Uyga yo‘l', 'Epilog',
    ],
    children: [
      'Sehrli tong', 'Yangi do‘st', 'Bog‘dagi sir', 'Rangli sarguzasht', 'Kichik qahramon', 'Yulduzlar sanog‘i', 'Do‘stlik kuchi', 'Katta bayram', 'Uyquga ketish vaqti',
      'Yomg‘irli kun', 'Daryo bo‘yida', 'Mehribon ayiqcha', 'Kitoblar shahri', 'Oxirgi sahifa',
    ],
  },
  opener: [
    '{Topic} haqida gap ketganda, ko‘pchilik avvalo murakkab nazariyalarni tasavvur qiladi. Aslida esa bu bob “{chapter}” mavzusini oddiy va hayotiy misollar orqali ochib beradi.',
    'Ushbu bobda biz “{chapter}” masalasini chuqurroq ko‘rib chiqamiz. Maqsad — {audience} uchun aniq, tushunarli va amalda qo‘llash mumkin bo‘lgan bilim berish.',
    'Har bir katta natija kichik, lekin to‘g‘ri qadamdan boshlanadi. “{chapter}” aynan shu qadamlarni ko‘rsatib beradi va {topic} bo‘yicha mustahkam poydevor yaratadi.',
  ],
  body: [
    'Tajriba shuni ko‘rsatadiki, {topic} sohasida muvaffaqiyatga erishganlar ko‘pincha murakkab usullarni emas, balki izchil va oddiy odatlarni tanlaydi.',
    'Bu yondashuvning eng muhim jihati — har bir qarorni aniq maqsad bilan bog‘lash. Maqsad aniq bo‘lsa, keraksiz harakatlar o‘z-o‘zidan kamayadi.',
    'Ko‘p hollarda muammo bilim yetishmasligida emas, balki bilimni amalda qo‘llash tizimi yo‘qligida bo‘ladi. Shuning uchun quyida aniq qadamlarni ko‘rib chiqamiz.',
    'Misol uchun, kuniga atigi o‘n besh daqiqa ajratish bir oy ichida sezilarli o‘zgarish beradi. Muhimi — davomiylik va natijani kuzatib borish.',
    'Shuni yodda tutish kerakki, har bir inson va vaziyat o‘ziga xos. Quyidagi tavsiyalarni o‘z sharoitingizga moslab qo‘llang.',
    '{Topic} bo‘yicha zamonaviy tadqiqotlar ham shu fikrni tasdiqlaydi: kichik, ammo muntazam qadamlar uzoq muddatda eng katta natijani beradi.',
    'Bu bosqichda savol berishdan qo‘rqmang. Nima uchun? Qanday qilib? Qachon? — kabi savollar mavzuni chuqurroq tushunishga yordam beradi.',
    'Amaliyot davomida xatolar bo‘lishi tabiiy. Ular sizning o‘sishingizdagi eng qimmatli tajriba manbai hisoblanadi.',
  ],
  sectionTitles: ['Asosiy g‘oya', 'Nima uchun bu muhim?', 'Amaliy qadamlar', 'Real misol', 'Muhim jihatlar', 'Qisqacha tahlil'],
  listIntro: ['Quyidagi asosiy qoidalarni yodda tuting:', 'Boshlash uchun eng muhim qadamlar:', 'Bu bobdan olinadigan asosiy saboqlar:'],
  points: [
    'Aniq va o‘lchanadigan maqsad qo‘ying', 'Har kuni kichik bo‘lsa ham qadam tashlang', 'Natijalaringizni yozib boring', 'Tajribali odamlardan maslahat so‘rang',
    'Xatolardan saboq oling va davom eting', 'Vaqtni rejalashtirishni odat qiling', 'Oddiydan murakkabga qarab harakat qiling', 'Har hafta natijani qayta ko‘rib chiqing',
    'Asosiy tushunchalarni o‘z so‘zlaringiz bilan tushuntirib ko‘ring', 'Bilimni boshqalar bilan ulashing',
  ],
  quotes: [
    { text: 'Ming chaqirimlik yo‘l ham bir qadamdan boshlanadi.', cite: 'Lao Szi' },
    { text: 'Bilim — eng katta boylik, uni hech kim tortib ololmaydi.', cite: 'Xalq maqoli' },
    { text: 'Ilm olish — beshikdan to qabrgacha.', cite: 'Hikmatli so‘z' },
    { text: 'Sabr tagi — sariq oltin.', cite: 'O‘zbek xalq maqoli' },
  ],
  closer: [
    'Xulosa qilib aytganda, “{chapter}” bobida ko‘rib chiqilgan g‘oyalar keyingi boblar uchun mustahkam asos bo‘lib xizmat qiladi.',
    'Keyingi bobga o‘tishdan oldin, bu yerda o‘rgangan bir g‘oyani bugunoq amalda sinab ko‘ring — bilim faqat qo‘llanganda kuchga kiradi.',
    'Endi asosiy tushunchalar aniq bo‘ldi. Keyingi bobda ularni yanada chuqurroq va amaliyroq tarzda davom ettiramiz.',
  ],
  continue: [
    'Shu bilan birga, bu jarayonda sabr va izchillik hal qiluvchi ahamiyatga ega.',
    'Bundan tashqari, olingan natijalarni muntazam tahlil qilish keyingi qadamlarni aniqroq belgilashga yordam beradi.',
    'Aynan shu sababli ko‘plab mutaxassislar oddiy, lekin barqaror tizim yaratishni tavsiya qiladi.',
    'Keyingi bosqichda bu bilimlarni real vaziyatlarda qo‘llashni ko‘rib chiqamiz.',
  ],
  expand: [
    'Buni yaxshiroq tushunish uchun kundalik hayotdan oddiy misolni ko‘rib chiqaylik.',
    'Bu fikrning ahamiyati shundaki, u nafaqat nazariy, balki amaliy jihatdan ham o‘z tasdig‘ini topgan.',
    'Shuningdek, bu yondashuv vaqt va kuchni tejash imkonini beradi.',
    'Natijada inson o‘z maqsadlariga ishonch bilan va bosqichma-bosqich yaqinlashadi.',
  ],
  intro: [
    'Ushbu bob {context} mavzusiga bag‘ishlangan. Unda biz asosiy tushunchalarni oddiy til bilan tushuntiramiz, real misollarni ko‘rib chiqamiz va amaliy tavsiyalar beramiz. Bob oxirida siz o‘rgangan bilimlarni darhol qo‘llashga tayyor bo‘lasiz.',
  ],
  conclusion: [
    'Xulosa qilib aytganda, {context} bo‘yicha ko‘rib chiqilgan g‘oyalar kundalik qarorlarimizni ongliroq qabul qilishga yordam beradi. Eng muhimi — kichik qadamlardan boshlash va izchil davom etish. Keyingi bobda bu poydevor ustiga yangi bilimlarni quramiz.',
  ],
  tablesHead: ['Bosqich', 'Nima qilish kerak', 'Natija'],
  tableRows: [
    ['1-hafta', 'Asosiy tushunchalarni o‘rganish', 'Aniq tasavvur'],
    ['2-hafta', 'Kichik amaliy mashqlar', 'Birinchi natijalar'],
    ['3-hafta', 'Xatolarni tahlil qilish', 'Mustahkam ko‘nikma'],
    ['4-hafta', 'Tizimni sozlash', 'Barqaror odat'],
  ],
  storyOpen: [
    'Tong otar-otmas shahar ustida yengil tuman suzib yurardi. {Hero} derazadan tashqariga qarab, bugun hayotida nimadir o‘zgarishini his qildi.',
    'Qishloq chetidagi eski uyda chiroq hali ham yonib turardi. {Hero} qo‘lidagi xatni uchinchi marta o‘qib chiqdi-yu, hech narsaga ishonolmadi.',
    'Bozor shovqini orasida {hero} birdan tanish ovozni eshitdi. Yillar o‘tgan bo‘lsa-da, bu ovozni hech qachon unutmagan edi.',
  ],
  storyBody: [
    'Atrofdagilar hech narsani sezmagandek o‘z ishlari bilan band edi. Faqat {hero} uchun vaqt go‘yo bir lahzaga to‘xtab qolgandi.',
    '— Endi orqaga yo‘l yo‘q, — dedi u o‘ziga-o‘zi pichirlab va chuqur nafas oldi.',
    'Shamol daraxt barglarini shitirlatar, uzoqdan qo‘ng‘iroq sadosi eshitilardi. Har bir tovush unga nimanidir eslatardi.',
    'U yo‘lda davom etar ekan, xayolida bolalik xotiralari jonlandi: onasining mehribon ovozi, hovlidagi o‘rik daraxti va kechki choy.',
    'Qo‘rquv va qiziqish bir-biri bilan kurashardi. Ammo yuragining tub-tubida u to‘g‘ri yo‘lda ekanini bilardi.',
    'Kun botib, osmon to‘q binafsha rangga kirdi. Bu oqshom uning hayotidagi eng uzun oqshom bo‘lishi aniq edi.',
  ],
  connectors: ['Shuningdek,', 'Bundan tashqari,', 'Aslida,', 'Boshqacha aytganda,', 'Muhimi,'],
  tone: {
    educational: { prefix: ['Keling, buni oddiy qilib tushuntiraylik.'], suffix: ['Bu qoidani yodda saqlang.'] },
    professional: { prefix: ['Amaliy nuqtai nazardan,'], suffix: ['Bu yondashuv samaradorlikni oshiradi.'] },
    academic: { prefix: ['Tadqiqotlar shuni ko‘rsatadiki,'], suffix: ['Mazkur xulosa ilmiy adabiyotlarda ham qayd etilgan.'] },
    creative: { prefix: ['Tasavvur qiling:'], suffix: ['Va aynan shu lahzada hammasi o‘zgaradi.'] },
    informal: { prefix: ['Ochig‘ini aytsam,'], suffix: ['Oddiy-ku, to‘g‘rimi?'] },
    storytelling: { prefix: ['Bir paytlar shunday voqea bo‘lgan edi.'], suffix: ['O‘sha kundan beri bu saboq hech qachon unutilmadi.'] },
  },
};

const EN: Pack = {
  titleSuffix: [': The Complete Guide', 'Essentials', 'in Practice', ': From Zero to Results', 'Made Simple'],
  subtitle: ['A practical guide with real examples', 'A step-by-step roadmap', 'Useful knowledge for every day', 'Clear explanations for beginners'],
  description: '“{title}” explains {topic} for {audience} in a clear, practical way, combining core ideas, real-life examples and steps you can apply right away.',
  outline: {
    nonfiction: ['Introduction: why {topic} matters', 'Core concepts of {topic}', 'A short history and the present', 'First steps: where to begin', '{Topic} in everyday life',
      'Common mistakes and how to avoid them', 'Effective methods and tools', 'Real-world case studies', 'Planning and goal setting', 'Measuring results', 'Advanced strategies',
      'Working with teams and communities', '{Topic} in the digital age', 'Motivation and lasting habits', 'Questions and answers', 'Looking ahead', 'Practice exercises',
      'Your personal roadmap', 'Expert advice', 'Conclusion and next steps'],
    fiction: ['The Beginning', 'An Unexpected Letter', 'The First Step', 'An Old Secret', 'On the Road', 'A Test of Trust', 'Before the Storm', 'The Turning Point', 'Loss',
      'A New Alliance', 'The Dark Night', 'The Truth Comes Out', 'The Decisive Choice', 'Return', 'A New Dawn', 'Distant Memories', 'The Final Trial', 'The Way Home', 'Epilogue'],
    children: ['A Magical Morning', 'A New Friend', 'The Garden Secret', 'A Colorful Adventure', 'The Little Hero', 'Counting Stars', 'The Power of Friendship', 'The Big Celebration',
      'Time for Bed', 'A Rainy Day', 'By the River', 'The Kind Little Bear', 'The City of Books', 'The Last Page'],
  },
  opener: ['When people think about {topic}, they often imagine complicated theory. This chapter, “{chapter}”, shows that it can be explained through simple, everyday examples.',
    'In this chapter we take a closer look at “{chapter}”. The goal is to give {audience} knowledge that is clear and immediately useful.'],
  body: ['Experience shows that people who succeed with {topic} rarely rely on complex tricks; they rely on consistent, simple habits.',
    'The key is to connect every decision to a clear goal. When the goal is clear, unnecessary effort disappears on its own.',
    'Often the problem is not a lack of knowledge but the lack of a system for applying it. That is why we will look at concrete steps below.',
    'For example, setting aside just fifteen minutes a day produces a noticeable change within a month. What matters is consistency.',
    'Keep in mind that every person and situation is different. Adapt the recommendations below to your own circumstances.',
    'Mistakes along the way are natural. They are one of the most valuable sources of experience for growth.'],
  sectionTitles: ['The core idea', 'Why it matters', 'Practical steps', 'A real example', 'Key points'],
  listIntro: ['Keep these key rules in mind:', 'The most important first steps:', 'Key takeaways from this chapter:'],
  points: ['Set a clear, measurable goal', 'Take a small step every day', 'Write down your results', 'Ask experienced people for advice', 'Learn from mistakes and keep going',
    'Plan your time', 'Move from simple to complex', 'Review your progress every week'],
  quotes: [{ text: 'A journey of a thousand miles begins with a single step.', cite: 'Lao Tzu' }, { text: 'An investment in knowledge pays the best interest.', cite: 'Benjamin Franklin' }],
  closer: ['In summary, the ideas from “{chapter}” form a solid foundation for the chapters ahead.', 'Before moving on, try one idea from this chapter today — knowledge becomes power only when applied.'],
  continue: ['At the same time, patience and consistency play a decisive role in this process.', 'In addition, regularly reviewing results helps define the next steps more precisely.',
    'That is exactly why many experts recommend building a simple but sustainable system.'],
  expand: ['To understand this better, consider a simple example from everyday life.', 'What makes this idea important is that it has been confirmed in practice, not only in theory.',
    'As a result, a person moves toward their goals step by step and with confidence.'],
  intro: ['This chapter is dedicated to {context}. We explain the core ideas in plain language, look at real examples and finish with practical recommendations you can apply immediately.'],
  conclusion: ['In conclusion, the ideas discussed about {context} help us make more conscious everyday decisions. Start small, stay consistent, and build on this foundation in the next chapter.'],
  tablesHead: ['Stage', 'What to do', 'Result'],
  tableRows: [['Week 1', 'Learn the core concepts', 'A clear picture'], ['Week 2', 'Small practical exercises', 'First results'], ['Week 3', 'Analyse mistakes', 'Solid skills'], ['Week 4', 'Tune the system', 'A lasting habit']],
  storyOpen: ['A light mist drifted over the city as dawn broke. {Hero} looked out of the window and felt that something in life was about to change.',
    'In the old house at the edge of the village the lamp was still burning. {Hero} read the letter for the third time and still could not believe it.'],
  storyBody: ['Everyone around seemed busy with their own affairs. Only for {hero} did time seem to stop for a moment.', '“There is no way back now,” {hero} whispered and took a deep breath.',
    'The wind rustled the leaves and a distant bell could be heard. Every sound reminded {hero} of something.', 'Fear and curiosity fought each other, yet deep down {hero} knew this was the right path.'],
  connectors: ['Moreover,', 'In addition,', 'In fact,', 'In other words,', 'Importantly,'],
  tone: {
    educational: { prefix: ['Let us explain this simply.'], suffix: ['Remember this rule.'] },
    professional: { prefix: ['From a practical standpoint,'], suffix: ['This approach increases efficiency.'] },
    academic: { prefix: ['Research indicates that'], suffix: ['This conclusion is also supported in the literature.'] },
    creative: { prefix: ['Imagine this:'], suffix: ['And in that very moment, everything changes.'] },
    informal: { prefix: ['Honestly,'], suffix: ['Simple, right?'] },
    storytelling: { prefix: ['Once upon a time, something like this happened.'], suffix: ['And that lesson was never forgotten.'] },
  },
};

const RU: Pack = {
  ...EN,
  titleSuffix: [': полное руководство', ': основы', 'на практике', ': от нуля до результата'],
  subtitle: ['Практическое руководство с реальными примерами', 'Пошаговая дорожная карта', 'Понятные объяснения для начинающих'],
  description: '«{title}» — книга, которая понятно и практично раскрывает тему «{topic}» для читателей: {audience}. В ней собраны ключевые идеи, примеры из жизни и конкретные шаги.',
  outline: {
    ...EN.outline,
    nonfiction: ['Введение: почему {topic} важно', 'Основные понятия', 'Краткая история и современность', 'Первые шаги', 'В повседневной жизни', 'Типичные ошибки',
      'Эффективные методы и инструменты', 'Реальные примеры', 'Планирование и цели', 'Измерение результатов', 'Продвинутые стратегии', 'Работа в команде',
      'В цифровую эпоху', 'Мотивация и привычки', 'Вопросы и ответы', 'Перспективы', 'Практические упражнения', 'Личная дорожная карта', 'Советы экспертов', 'Заключение'],
  },
  opener: ['Когда речь заходит о теме «{topic}», многие представляют сложную теорию. Эта глава — «{chapter}» — объясняет её на простых жизненных примерах.',
    'В этой главе мы подробно рассмотрим вопрос «{chapter}». Цель — дать понятные и полезные знания.'],
  body: ['Опыт показывает, что успеха добиваются не сложными приёмами, а последовательными простыми привычками.',
    'Главное — связать каждое решение с ясной целью. Когда цель понятна, лишние действия исчезают сами собой.',
    'Часто проблема не в нехватке знаний, а в отсутствии системы их применения. Поэтому ниже мы рассмотрим конкретные шаги.',
    'Например, всего пятнадцать минут в день дают заметный результат уже через месяц. Важна регулярность.'],
  sectionTitles: ['Главная идея', 'Почему это важно', 'Практические шаги', 'Пример из жизни'],
  listIntro: ['Запомните основные правила:', 'Самые важные первые шаги:'],
  points: ['Поставьте ясную и измеримую цель', 'Делайте маленький шаг каждый день', 'Записывайте результаты', 'Учитесь на ошибках', 'Планируйте своё время'],
  quotes: [{ text: 'Дорога в тысячу ли начинается с первого шага.', cite: 'Лао-цзы' }],
  closer: ['Итак, идеи главы «{chapter}» станут прочной основой для следующих глав.'],
  continue: ['При этом терпение и последовательность играют решающую роль.', 'Кроме того, регулярный анализ результатов помогает точнее определить следующие шаги.'],
  expand: ['Чтобы лучше понять это, рассмотрим простой пример из повседневной жизни.', 'В результате человек уверенно и шаг за шагом приближается к цели.'],
  intro: ['Эта глава посвящена теме: {context}. Мы объясним основные идеи простым языком и дадим практические рекомендации.'],
  conclusion: ['Подводя итог, идеи по теме «{context}» помогают принимать более осознанные решения. Начните с малого и двигайтесь последовательно.'],
  tablesHead: ['Этап', 'Что делать', 'Результат'],
  tableRows: [['1-я неделя', 'Изучить основы', 'Ясное понимание'], ['2-я неделя', 'Практические упражнения', 'Первые результаты'], ['3-я неделя', 'Анализ ошибок', 'Устойчивый навык']],
  connectors: ['Кроме того,', 'Более того,', 'На самом деле,', 'Иначе говоря,'],
};

const PACKS: Record<BookLanguage, Pack> = { uz: UZ, en: EN, ru: RU };
const HEROES: Record<BookLanguage, string[]> = { uz: ['Malika', 'Jasur', 'Dilnoza', 'Sardor', 'Nodira'], en: ['Emma', 'Daniel', 'Lily', 'Sam'], ru: ['Анна', 'Иван', 'Мария'] };

function kind(c: BookCategory): 'nonfiction' | 'fiction' | 'children' {
  return c === 'fiction' ? 'fiction' : c === 'children' ? 'children' : 'nonfiction';
}

const SPELLING: [RegExp, string][] = [
  [/\bbulsa\b/gi, 'bo‘lsa'], [/\bbuladi\b/gi, 'bo‘ladi'], [/\bbulib\b/gi, 'bo‘lib'], [/\buchun\s+uchun\b/gi, 'uchun'], [/\bkerek\b/gi, 'kerak'],
  [/\bxozir\b/gi, 'hozir'], [/\bxam\b/gi, 'ham'], [/\bqilish\s+qilish\b/gi, 'qilish'], [/\bkitop\b/gi, 'kitob'], [/\btugri\b/gi, 'to‘g‘ri'],
  [/\bmumkun\b/gi, 'mumkin'], [/\bammo,?\s+lekin\b/gi, 'ammo'], [/\bteh\b/gi, 'the'], [/\brecieve\b/gi, 'receive'], [/\bdefinately\b/gi, 'definitely'],
];

const SYNONYMS: [RegExp, string][] = [
  [/\bmuhim\b/g, 'ahamiyatli'], [/\bkatta\b/g, 'ulkan'], [/\bkichik\b/g, 'kichkina'], [/\byaxshi\b/g, 'samarali'], [/\bjuda\b/g, 'nihoyatda'],
  [/\bammo\b/g, 'biroq'], [/\bchunki\b/g, 'sababi'], [/\bko‘p\b/g, 'ko‘plab'], [/\bimportant\b/g, 'essential'], [/\bbig\b/g, 'significant'],
  [/\bgood\b/g, 'effective'], [/\bvery\b/g, 'remarkably'], [/\bbut\b/g, 'however,'],
];

const TRANSLATE: Record<string, Record<string, string>> = {
  'uz>en': { kitob: 'book', bob: 'chapter', muhim: 'important', bilim: 'knowledge', maqsad: 'goal', va: 'and', uchun: 'for', bu: 'this', har: 'every', kun: 'day', yaxshi: 'good', katta: 'big', kichik: 'small', natija: 'result', qadam: 'step', vaqt: 'time', hayot: 'life', inson: 'person', odat: 'habit', ish: 'work' },
  'en>uz': { book: 'kitob', chapter: 'bob', important: 'muhim', knowledge: 'bilim', goal: 'maqsad', and: 'va', for: 'uchun', this: 'bu', every: 'har', day: 'kun', good: 'yaxshi', big: 'katta', small: 'kichik', result: 'natija', step: 'qadam', time: 'vaqt', life: 'hayot', person: 'inson', habit: 'odat', work: 'ish' },
  'uz>ru': { kitob: 'книга', bob: 'глава', muhim: 'важно', bilim: 'знание', maqsad: 'цель', va: 'и', uchun: 'для', bu: 'это', har: 'каждый', kun: 'день', natija: 'результат', qadam: 'шаг', vaqt: 'время', hayot: 'жизнь' },
  'en>ru': { book: 'книга', chapter: 'глава', important: 'важно', knowledge: 'знание', goal: 'цель', and: 'и', for: 'для', this: 'это', day: 'день', result: 'результат', step: 'шаг', time: 'время', life: 'жизнь' },
};

function detectLang(text: string): BookLanguage {
  if (/[а-яё]/i.test(text)) return 'ru';
  if (/[o‘g‘ʻ]|\b(va|uchun|bilan|bu|ham)\b/i.test(text) && /‘|ʻ|\b(va|uchun|bilan)\b/.test(text)) return 'uz';
  return /\b(the|and|is|of|to)\b/i.test(text) ? 'en' : 'uz';
}

// ------------------------------------------------------------------ provider

export class DemoTextAIProvider implements TextAIProvider {
  readonly id = 'demo-text';
  readonly isDemo = true;

  /** Base latency per call in ms (tests set this to 0). */
  constructor(private latency = 650) {}

  private wait(signal?: AbortSignal, factor = 1) {
    return sleep(Math.round(this.latency * factor * (0.7 + Math.random() * 0.6)), signal);
  }

  async generateBookOutline(brief: BookBrief, signal?: AbortSignal): Promise<BookOutline> {
    await this.wait(signal, 1.6);
    const p = PACKS[brief.language] ?? UZ;
    const r = rng(hash(brief.topic + brief.category + brief.tone));
    const topic = brief.topic.trim().replace(/[.!?]+$/, '');
    const vars = { topic: lower(topic), Topic: cap(topic) };
    const title = brief.title?.trim() || cap(`${topic} ${pick(r, p.titleSuffix)}`.replace(/\s+:/, ':'));
    const k = kind(brief.category);
    const pool = p.outline[k];
    const n = Math.max(1, Math.min(20, brief.chapters));
    let titles: string[];
    if (k === 'nonfiction') {
      const first = pool[0];
      const last = pool[pool.length - 1];
      const middle = shuffle(r, pool.slice(1, -1)).slice(0, Math.max(0, n - 2));
      titles = n === 1 ? [first] : [first, ...middle, last].slice(0, n);
    } else {
      titles = pool.slice(0, n);
      while (titles.length < n) titles.push(`${pool[titles.length % pool.length]} ${Math.floor(titles.length / pool.length) + 1}`);
    }
    const audience = brief.audience?.trim() || (brief.language === 'en' ? 'every reader' : brief.language === 'ru' ? 'широкий круг читателей' : 'keng kitobxonlar');
    return {
      title,
      subtitle: pick(r, p.subtitle),
      description: brief.description?.trim() || fill(p.description, { ...vars, title, audience }),
      chapters: titles.map((t, i) => ({
        title: fill(t, vars),
        summary: fill(pick(rng(hash(t) + i), p.opener), { ...vars, chapter: fill(t, vars), audience }).split('. ')[0] + '.',
      })),
    };
  }

  async generateChapter({ brief, outline, index }: ChapterRequest, signal?: AbortSignal): Promise<Block[]> {
    await this.wait(signal, 2);
    const p = PACKS[brief.language] ?? UZ;
    const r = rng(hash(`${brief.topic}|${index}|${outline.chapters[index]?.title}`));
    const chapter = outline.chapters[index]?.title ?? `${index + 1}`;
    const topic = brief.topic.trim().replace(/[.!?]+$/, '');
    const audience = brief.audience?.trim() || (brief.language === 'en' ? 'readers' : 'kitobxonlar');
    const heroName = pick(rng(hash(brief.topic)), HEROES[brief.language] ?? HEROES.uz);
    const v = { topic: lower(topic), Topic: cap(topic), chapter, audience, hero: heroName, Hero: heroName };
    const para = (tpl: string) => createBlock('paragraph', { html: escapeHtml(fill(tpl, v)) });
    const tone = p.tone[brief.tone] ?? p.tone.educational;
    const blocks: Block[] = [];

    if (kind(brief.category) !== 'nonfiction') {
      blocks.push(para(pick(r, p.storyOpen)));
      for (const s of shuffle(r, p.storyBody).slice(0, 4)) blocks.push(para(s));
      if (index > 0 && r() > 0.5) blocks.push(createBlock('divider'));
      blocks.push(para(pick(r, p.storyBody)));
      return blocks;
    }

    blocks.push(createBlock('paragraph', { html: `<b>${escapeHtml(tone.prefix[0])}</b> ${escapeHtml(fill(pick(r, p.opener), v))}` }));
    const sections = shuffle(r, p.sectionTitles).slice(0, 2);
    const body = shuffle(r, p.body);
    blocks.push(createBlock('heading', { level: 2, html: escapeHtml(sections[0]) }));
    blocks.push(para(`${body[0]} ${body[1]}`));
    blocks.push(para(body[2]));
    blocks.push(createBlock('paragraph', { html: escapeHtml(pick(r, p.listIntro)) }));
    blocks.push(createBlock('list', { ordered: r() > 0.5, items: shuffle(r, p.points).slice(0, 4).map(escapeHtml) }));
    if (r() > 0.4) {
      const q = pick(r, p.quotes);
      blocks.push(createBlock('quote', { html: escapeHtml(q.text), cite: q.cite }));
    }
    blocks.push(createBlock('heading', { level: 2, html: escapeHtml(sections[1]) }));
    blocks.push(para(`${body[3]} ${body[4] ?? ''}`.trim()));
    if (['education', 'business', 'guide', 'academic', 'finance', 'technology'].includes(brief.category) && index % 2 === 1) {
      blocks.push(createBlock('table', { header: true, rows: [p.tablesHead, ...p.tableRows] }));
    }
    blocks.push(createBlock('paragraph', { html: `${escapeHtml(fill(pick(r, p.closer), v))} <i>${escapeHtml(tone.suffix[0])}</i>` }));
    return blocks;
  }

  async continueText(text: string, opts: TextOptions = {}): Promise<string> {
    await this.wait(opts.signal);
    const p = PACKS[opts.language ?? detectLang(text)];
    const r = rng(hash(text));
    return shuffle(r, p.continue).slice(0, 2).join(' ');
  }

  async rewriteText(text: string, opts: TextOptions = {}): Promise<string> {
    await this.wait(opts.signal);
    const p = PACKS[opts.language ?? detectLang(text)];
    let out = text;
    for (const [re, rep] of SYNONYMS) out = out.replace(re, rep);
    const s = splitSentences(out);
    if (s.length > 1) {
      const r = rng(hash(text));
      s[1] = `${pick(r, p.connectors)} ${lower(s[1])}`;
    }
    const result = s.join(' ');
    return result === text ? `${p.connectors[3]} ${lower(text)}` : result;
  }

  async expandText(text: string, opts: TextOptions = {}): Promise<string> {
    await this.wait(opts.signal, 1.3);
    const p = PACKS[opts.language ?? detectLang(text)];
    const r = rng(hash(text) + 7);
    return `${text.trim()} ${shuffle(r, p.expand).slice(0, 2).join(' ')}`;
  }

  async summarizeText(text: string, opts: TextOptions = {}): Promise<string> {
    await this.wait(opts.signal);
    const s = splitSentences(text);
    if (s.length <= 1) {
      const words = text.split(/\s+/);
      return words.length > 12 ? words.slice(0, Math.ceil(words.length * 0.6)).join(' ').replace(/[,;:]$/, '') + '.' : text;
    }
    const keep = Math.max(1, Math.round(s.length * 0.4));
    const ranked = s.map((x, i) => ({ x, i, score: x.length + (i === 0 ? 1000 : 0) })).sort((a, b) => b.score - a.score).slice(0, keep).sort((a, b) => a.i - b.i);
    return ranked.map((x) => x.x).join(' ');
  }

  async improveGrammar(text: string, opts: TextOptions = {}): Promise<string> {
    await this.wait(opts.signal, 0.8);
    let t = text
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([,.!?;:])/g, '$1')
      .replace(/([,.!?;:])(?=[\p{L}])/gu, '$1 ')
      .replace(/\b(\p{L}+)\s+\1\b/giu, '$1')
      .replace(/([oOgG])['`ʻ’](?=\p{L}|\s|$)/gu, '$1‘');
    t = t.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase());
    if (!/[.!?…»"”]$/.test(t.trim())) t = t.trim() + '.';
    return t.trim();
  }

  async fixSpelling(text: string, opts: TextOptions = {}): Promise<string> {
    await this.wait(opts.signal, 0.8);
    let t = text.replace(/([oOgG])['`ʻ’](?=\p{L})/gu, '$1‘');
    for (const [re, rep] of SPELLING) t = t.replace(re, (m) => (m[0] === m[0].toUpperCase() ? cap(rep) : rep));
    return t;
  }

  async changeTone(text: string, tone: WritingTone, opts: TextOptions = {}): Promise<string> {
    await this.wait(opts.signal);
    const p = PACKS[opts.language ?? detectLang(text)];
    const t = p.tone[tone];
    let body = text.trim();
    if (tone === 'informal') body = body.replace(/\bSiz\b/g, 'Sen').replace(/\bsiz\b/g, 'sen');
    if (tone === 'professional' || tone === 'academic') body = body.replace(/\bsen\b/g, 'siz').replace(/!+/g, '.');
    return `${t.prefix[0]} ${lower(body)} ${t.suffix[0]}`.replace(/\s+/g, ' ').trim();
  }

  async translateText(text: string, target: BookLanguage, opts: TextOptions = {}): Promise<string> {
    await this.wait(opts.signal, 1.2);
    const src = detectLang(text);
    if (src === target) return text;
    const dict = TRANSLATE[`${src}>${target}`] ?? {};
    const out = text.replace(/[\p{L}‘’]+/gu, (w) => {
      const tr = dict[w.toLowerCase()];
      if (!tr) return w;
      return w[0] === w[0].toUpperCase() ? cap(tr) : tr;
    });
    return `[DEMO ${src.toUpperCase()}→${target.toUpperCase()}] ${out}`;
  }

  async generateChapterTitles(context: string, count: number, opts: TextOptions = {}): Promise<string[]> {
    await this.wait(opts.signal);
    const lang = opts.language ?? detectLang(context);
    const p = PACKS[lang];
    const topic = context.trim() || (lang === 'en' ? 'this topic' : 'mavzu');
    const r = rng(hash(context));
    return shuffle(r, p.outline.nonfiction).slice(0, count).map((t) => fill(t, { topic: lower(topic), Topic: cap(topic) }));
  }

  async generateIntroduction(context: string, opts: TextOptions = {}): Promise<string> {
    await this.wait(opts.signal, 1.2);
    const p = PACKS[opts.language ?? detectLang(context)];
    return fill(p.intro[0], { context: `“${context.trim()}”` });
  }

  async generateConclusion(context: string, opts: TextOptions = {}): Promise<string> {
    await this.wait(opts.signal, 1.2);
    const p = PACKS[opts.language ?? detectLang(context)];
    return fill(p.conclusion[0], { context: `“${context.trim()}”` });
  }
}
