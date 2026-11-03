import { useState } from 'react';
import { useLibrary, useSettings } from '../../app/AppContext';
import { navigate, routes } from '../../app/router';
import { Icon, type IconName } from '../../components/Icon';
import { DemoBadge, ListRow, PageHeader, Segmented, Sheet } from '../../components/ui';
import { TemplatesView } from '../templates/TemplatesPage';

export default function StudioPage() {
  const { t } = useSettings();
  const { books } = useLibrary();
  const [tab, setTab] = useState<'tools' | 'templates'>('tools');
  const [pick, setPick] = useState<null | 'editor' | 'reader'>(null);
  const live = books.filter((b) => !b.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);

  const tools: { icon: IconName; title: string; text: string; run: () => void; demo?: boolean; tone: string }[] = [
    { icon: 'sparkles', title: t('studio.creator'), text: t('studio.creatorDesc'), run: () => navigate(routes.create()), demo: true, tone: 'violet' },
    { icon: 'feather', title: t('studio.assistant'), text: t('studio.assistantDesc'), run: () => (live.length === 1 ? navigate(routes.editor(live[0].id)) : setPick('editor')), demo: true, tone: 'indigo' },
    { icon: 'image', title: t('studio.cover'), text: t('studio.coverDesc'), run: () => navigate(routes.cover()), demo: true, tone: 'blue' },
    { icon: 'download', title: t('studio.export'), text: t('studio.exportDesc'), run: () => navigate(routes.export()), tone: 'rose' },
    { icon: 'upload', title: t('studio.import'), text: t('studio.importDesc'), run: () => navigate(routes.import()), tone: 'amber' },
    { icon: 'bookOpen', title: t('studio.reader'), text: t('studio.readerDesc'), run: () => setPick('reader'), tone: 'teal' },
  ];

  return (
    <div className="page studio">
      <PageHeader title={t('studio.title')} subtitle={t('studio.subtitle')} />
      <Segmented value={tab} onChange={setTab} label={t('studio.title')} options={[{ value: 'tools', label: t('studio.tab.tools'), icon: 'sparkles' }, { value: 'templates', label: t('studio.tab.templates'), icon: 'layout' }]} />
      {tab === 'tools' ? (
        <div className="tool-grid">
          {tools.map((x) => (
            <button key={x.title} type="button" className="tool-card glass" onClick={x.run}>
              <span className={`quick-icon tone-${x.tone}`}><Icon name={x.icon} size={24} /></span>
              <span className="tool-text"><strong>{x.title} {x.demo && <DemoBadge />}</strong><small>{x.text}</small></span>
              <Icon name="chevronRight" size={18} className="muted" />
            </button>
          ))}
        </div>
      ) : <TemplatesView />}

      <Sheet open={!!pick} onClose={() => setPick(null)} title={live.length ? t('home.chooseBook') : t('home.chooseBookEmpty')} size="sm">
        <div className="list">
          {live.map((b) => <ListRow key={b.id} icon="book" title={b.title} subtitle={t('common.chapters', { n: b.chapters.length })}
            onClick={() => { setPick(null); navigate(pick === 'reader' ? routes.reader(b.id) : routes.editor(b.id)); }} />)}
          {!live.length && <ListRow icon="sparkles" title={t('create.ai')} onClick={() => { setPick(null); navigate(routes.create()); }} />}
        </div>
      </Sheet>
    </div>
  );
}
