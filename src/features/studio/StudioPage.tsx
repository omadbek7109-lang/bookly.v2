import { useState } from 'react';
import { useLibrary, useSettings } from '../../app/AppContext';
import { navigate, routes } from '../../app/router';
import { Icon, type IconName } from '../../components/Icon';
import { ListRow, PageHeader, Segmented, Sheet } from '../../components/ui';
import { TemplatesView } from '../templates/TemplatesPage';

export default function StudioPage() {
  const { t } = useSettings();
  const { books } = useLibrary();
  const [tab, setTab] = useState<'tools' | 'templates'>('tools');
  const [pick, setPick] = useState<null | 'editor' | 'reader'>(null);
  const live = books.filter((b) => !b.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);

  const tools: { icon: IconName; title: string; text: string; run: () => void; tone: string; testId: string }[] = [
    { icon: 'list', title: t('studio.wizard'), text: t('studio.wizardDesc'), run: () => navigate(routes.create()), tone: 'violet', testId: 'tool-wizard' },
    { icon: 'feather', title: t('studio.write'), text: t('studio.writeDesc'), run: () => (live.length === 1 ? navigate(routes.editor(live[0].id)) : setPick('editor')), tone: 'indigo', testId: 'tool-write' },
    { icon: 'image', title: t('studio.cover'), text: t('studio.coverDesc'), run: () => navigate(routes.cover()), tone: 'blue', testId: 'tool-cover' },
    { icon: 'download', title: t('studio.export'), text: t('studio.exportDesc'), run: () => navigate(routes.export()), tone: 'rose', testId: 'tool-export' },
    { icon: 'upload', title: t('studio.import'), text: t('studio.importDesc'), run: () => navigate(routes.import()), tone: 'amber', testId: 'tool-import' },
    { icon: 'bookOpen', title: t('studio.reader'), text: t('studio.readerDesc'), run: () => setPick('reader'), tone: 'teal', testId: 'tool-reader' },
  ];

  return (
    <div className="page studio">
      <PageHeader title={t('studio.title')} subtitle={t('studio.subtitle')} />
      <Segmented value={tab} onChange={setTab} label={t('studio.title')} options={[{ value: 'tools', label: t('studio.tab.tools'), icon: 'sliders' }, { value: 'templates', label: t('studio.tab.templates'), icon: 'layout' }]} />
      {tab === 'tools' ? (
        <div className="tool-grid">
          {tools.map((x) => (
            <button key={x.title} type="button" className="tool-card glass" onClick={x.run} data-testid={x.testId}>
              <span className={`quick-icon tone-${x.tone}`}><Icon name={x.icon} size={24} /></span>
              <span className="tool-text"><strong>{x.title}</strong><small>{x.text}</small></span>
              <Icon name="chevronRight" size={18} className="muted" />
            </button>
          ))}
        </div>
      ) : <TemplatesView />}

      <Sheet open={!!pick} onClose={() => setPick(null)} title={live.length ? t('home.chooseBook') : t('home.chooseBookEmpty')} size="sm">
        <div className="list">
          {live.map((b) => <ListRow key={b.id} icon="book" title={b.title} subtitle={t('common.chapters', { n: b.chapters.length })}
            onClick={() => { setPick(null); navigate(pick === 'reader' ? routes.reader(b.id) : routes.editor(b.id)); }} />)}
          {!live.length && <ListRow icon="list" title={t('create.wizard')} onClick={() => { setPick(null); navigate(routes.create()); }} />}
        </div>
      </Sheet>
    </div>
  );
}
