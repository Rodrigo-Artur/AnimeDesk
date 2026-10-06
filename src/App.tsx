import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Compass,
  Download,
  Home,
  Library,
  Link2,
  Play,
  Plus,
  Search,
  Settings,
  Sparkles,
  Star,
  Tv,
  Upload,
  X,
} from 'lucide-react';
import './App.css';
import { ExternalMappingsPanel } from './components/ExternalMappingsPanel';
import { loadWatchHistory } from './db/database';
import { getAppState, setAppState } from './services/appState';
import { getDiscoverHome } from './services/discover';
import type { DiscoverMedia } from './services/discover';
import { getMediaDetails, searchAnime, searchManga } from './services/jikan';
import { parseMalExportXml, readMalExportFile } from './services/malImport';
import type { MalImportPreview } from './services/malImport';
import {
  getAutostartEnabled,
  sendNativeTestNotification,
  setAutostartEnabled,
} from './services/native';
import { isTauriRuntime } from './services/platform';
import {
  getReleaseAlertLeadMinutes,
  getReleaseAlertsEnabled,
  setReleaseAlertLeadMinutes,
  setReleaseAlertsEnabled,
} from './services/preferences';
import { plannedStreamingProviders } from './services/providers';
import { startReleaseWatcher } from './services/releaseWatcher';
import { getWeeklySchedule } from './services/schedule';
import {
  computeAnimeDeskStats,
  formatHistoryUnit,
  parseWatchHistoryDate,
} from './services/stats';
import { useEnrichmentStore } from './store/enrichment';
import { useLibraryStore } from './store/library';
import { useUiStore } from './store/ui';
import type { Media } from './types/media';

type Page = 'home' | 'library' | 'stats' | 'agenda' | 'explore' | 'integrations' | 'settings';

const navItems: Array<{ id: Page; label: string; icon: typeof Home }> = [
  { id: 'home', label: 'Início', icon: Home },
  { id: 'library', label: 'Minha lista', icon: Library },
  { id: 'stats', label: 'Estatísticas', icon: BarChart3 },
  { id: 'agenda', label: 'Agenda', icon: CalendarDays },
  { id: 'explore', label: 'Explorar', icon: Compass },
  { id: 'integrations', label: 'Integrações', icon: Link2 },
  { id: 'settings', label: 'Configurações', icon: Settings },
];

function MediaCard({
  media,
  reasons,
}: {
  media: Media;
  reasons?: string[];
}) {
  const add = useLibraryStore((state) => state.add);
  const openMedia = useUiStore((state) => state.openMedia);
  const exists = useLibraryStore((state) =>
    state.entries.some((entry) => entry.media.malId === media.malId && entry.media.type === media.type),
  );

  return (
    <article className="media-card" onClick={() => openMedia(media)}>
      <div className="poster-wrap">
        {media.imageUrl ? <img src={media.imageUrl} alt="" /> : <div className="poster-fallback" />}
        {media.score ? (
          <span className="score-badge"><Star size={13} fill="currentColor" /> {media.score}</span>
        ) : null}
      </div>
      <div className="media-card-body">
        <h3 title={media.titleEnglish ?? media.title}>{media.titleEnglish || media.title}</h3>
        <p>
          {media.year ?? '—'} · {media.type === 'manga'
            ? (media.chapters ? `${media.chapters} caps` : 'Em publicação')
            : (media.episodes ? `${media.episodes} eps` : 'Em exibição')}
        </p>
        {reasons && reasons.length > 0 && (
          <div className="recommendation-reasons">
            {reasons.slice(0, 2).map((reason) => (
              <span key={reason}><Sparkles size={11} /> {reason}</span>
            ))}
          </div>
        )}
        <button
          className={exists ? 'button added' : 'button'}
          onClick={(event) => {
            event.stopPropagation();
            add(media, 'planned');
          }}
          disabled={exists}
        >
          {exists ? 'Na lista' : <><Plus size={15} /> Adicionar</>}
        </button>
      </div>
    </article>
  );
}

function MediaDetailsModal({ media }: { media: Media }) {
  const closeMedia = useUiStore((state) => state.closeMedia);
  const openMedia = useUiStore((state) => state.openMedia);
  const add = useLibraryStore((state) => state.add);
  const cacheCover = useLibraryStore((state) => state.cacheCover);
  const [coverMessage, setCoverMessage] = useState('');
  const entry = useLibraryStore((state) =>
    state.entries.find((item) => item.media.malId === media.malId && item.media.type === media.type),
  );
  const details = useQuery({
    queryKey: ['media-details', media.type, media.malId],
    queryFn: () => getMediaDetails(media),
    staleTime: 1000 * 60 * 60,
  });

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMedia();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closeMedia]);

  const item = details.data ?? media;
  const displayImageUrl = entry?.media.imageUrl ?? item.imageUrl;
  const coverIsLocal = Boolean(
    entry?.media.imageUrl &&
      (entry.media.imageUrl.startsWith('asset:') || entry.media.imageUrl.includes('asset.localhost')),
  );
  const total = item.type === 'manga' ? item.chapters : item.episodes;
  const unit = item.type === 'manga' ? 'capítulos' : 'episódios';
  const creators = item.type === 'manga'
    ? details.data?.authors ?? []
    : details.data?.studios ?? [];

  return (
    <div className="detail-overlay" onMouseDown={closeMedia}>
      <section className="detail-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="detail-close" onClick={closeMedia} aria-label="Fechar detalhes"><X size={19} /></button>

        <div className="detail-hero">
          <div className="detail-poster">
            {displayImageUrl ? <img src={displayImageUrl} alt="" /> : <div className="poster-fallback" />}
          </div>
          <div className="detail-summary">
            <span className="detail-kind">{item.type === 'manga' ? 'MANGÁ' : 'ANIME'} · MAL #{item.malId}</span>
            <h2>{item.titleEnglish || item.title}</h2>
            {item.titleEnglish && item.titleEnglish !== item.title && <p className="detail-original-title">{item.title}</p>}

            <div className="detail-badges">
              {item.score ? <span><Star size={13} fill="currentColor" /> {item.score}</span> : null}
              {item.year ? <span>{item.year}</span> : null}
              {total ? <span>{total} {unit}</span> : null}
              {item.status ? <span>{item.status}</span> : null}
            </div>

            <div className="detail-genres">
              {item.genres.map((genre) => <span key={genre}>{genre}</span>)}
            </div>

            {entry ? (
              <div className="detail-library-actions">
                <div className="detail-progress-card">
                  <div>
                    <span>SEU PROGRESSO</span>
                    <strong>{entry.progress} / {total ?? '?'} {unit}</strong>
                  </div>
                  <b>{entry.status === 'watching' ? 'Assistindo' : entry.status === 'reading' ? 'Lendo' : entry.status === 'planned' ? 'Planejado' : entry.status === 'completed' ? 'Concluído' : entry.status === 'paused' ? 'Pausado' : 'Abandonado'}</b>
                </div>
                <button
                  className={coverIsLocal ? 'button added' : 'button secondary'}
                  disabled={coverIsLocal}
                  onClick={async () => {
                    setCoverMessage('Baixando capa…');
                    const success = await cacheCover(entry.media.malId, entry.media.type);
                    setCoverMessage(success ? 'Capa salva localmente.' : 'Não foi possível baixar a capa.');
                  }}
                >
                  <Download size={15} /> {coverIsLocal ? 'Capa offline' : 'Salvar capa offline'}
                </button>
                {coverMessage && <small className="detail-cover-message">{coverMessage}</small>}
              </div>
            ) : (
              <button className="button detail-add" onClick={() => add(item, 'planned')}><Plus size={16} /> Adicionar à minha lista</button>
            )}
          </div>
        </div>

        {details.isFetching && <div className="detail-loading">Carregando informações completas…</div>}
        {details.isError && <div className="detail-error">Alguns detalhes não puderam ser carregados agora.</div>}

        <div className="detail-content">
          <div className="detail-main-column">
            <section>
              <span className="detail-section-label">SINOPSE</span>
              <p className="detail-synopsis">{item.synopsis || 'Sinopse não disponível.'}</p>
            </section>

            {details.data?.relations && details.data.relations.length > 0 && (
              <section>
                <span className="detail-section-label">RELAÇÕES</span>
                <div className="relation-groups">
                  {details.data.relations.map((relation) => (
                    <div className="relation-group" key={relation.relation}>
                      <strong>{relation.relation}</strong>
                      <div>
                        {relation.entries.map((related) => (
                          <button
                            key={`${related.type}-${related.malId}`}
                            onClick={() => openMedia({
                              id: related.malId,
                              malId: related.malId,
                              type: related.type,
                              title: related.name,
                              genres: [],
                            })}
                          >
                            {related.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="detail-meta">
            <div><span>Tipo</span><strong>{item.type === 'manga' ? 'Mangá' : 'Anime'}</strong></div>
            <div><span>{item.type === 'manga' ? 'Autores' : 'Estúdio'}</span><strong>{creators.length ? creators.join(', ') : '—'}</strong></div>
            {details.data?.rank ? <div><span>Ranking MAL</span><strong>#{details.data.rank}</strong></div> : null}
            {details.data?.popularity ? <div><span>Popularidade</span><strong>#{details.data.popularity}</strong></div> : null}
            {details.data?.members ? <div><span>Membros</span><strong>{details.data.members.toLocaleString('pt-BR')}</strong></div> : null}
            {details.data?.favorites ? <div><span>Favoritos</span><strong>{details.data.favorites.toLocaleString('pt-BR')}</strong></div> : null}
          </aside>
        </div>
      </section>
    </div>
  );
}

function DiscoveryShelf({
  eyebrow,
  title,
  description,
  items,
  showReasons = false,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  items: DiscoverMedia[];
  showReasons?: boolean;
}) {
  if (!items.length) return null;

  return (
    <section className="section discover-shelf">
      <div className="section-title">
        <div>
          <span>{eyebrow}</span>
          <h2>{title}</h2>
          {description && <p className="section-description">{description}</p>}
        </div>
      </div>
      <div className="media-grid">
        {items.slice(0, 6).map((media) => (
          <MediaCard
            key={`${media.type}-${media.malId}`}
            media={media}
            reasons={showReasons ? media.recommendationReasons : undefined}
          />
        ))}
      </div>
    </section>
  );
}

function HomePage() {
  const entries = useLibraryStore((state) => state.entries);
  const inProgress = entries.filter(
    (entry) => entry.status === 'watching' || entry.status === 'reading',
  );
  const librarySignature = entries
    .map((entry) => [
      entry.media.type,
      entry.media.malId,
      entry.status,
      entry.score ?? '',
      entry.progress,
      entry.media.genres.join(','),
      (entry.media.studios ?? []).join(','),
    ].join(':'))
    .sort()
    .join('|');

  const discover = useQuery({
    queryKey: ['discover-home', librarySignature],
    queryFn: () => getDiscoverHome(entries),
    staleTime: 1000 * 60 * 20,
  });

  const hasDiscovery = Boolean(
    discover.data && (
      discover.data.trending.length ||
      discover.data.seasonal.length ||
      discover.data.popular.length ||
      discover.data.topRated.length ||
      discover.data.upcoming.length
    ),
  );

  return (
    <>
      <section className="hero">
        <div>
          <span className="eyebrow">ANIMEDESK · BETA</span>
          <h1>Seu universo de anime e mangá em um só lugar.</h1>
          <p>Acompanhe episódios, capítulos, lançamentos e descubra novas obras sem depender de uma única plataforma.</p>
        </div>
        <div className="hero-orbit">
          <div className="orbit-core"><Play fill="currentColor" /></div>
          <span className="orbit-dot one" />
          <span className="orbit-dot two" />
        </div>
      </section>

      <div className="stats-grid">
        <div className="stat"><span>Em andamento</span><strong>{inProgress.length}</strong><Tv /></div>
        <div className="stat"><span>Na biblioteca</span><strong>{entries.length}</strong><Library /></div>
        <div className="stat"><span>Planejados</span><strong>{entries.filter((e) => e.status === 'planned').length}</strong><Clock3 /></div>
        <div className="stat accent"><span>Alertas hoje</span><strong>0</strong><Bell /></div>
      </div>

      {inProgress.length > 0 && (
        <section className="section">
          <div className="section-title"><div><span>RETOMAR</span><h2>Continue de onde parou</h2></div></div>
          <div className="continue-list">
            {inProgress.slice(0, 4).map((entry) => (
              <div className="continue-item" key={`${entry.media.type}-${entry.media.malId}`}>
                {entry.media.imageUrl && <img src={entry.media.imageUrl} alt="" />}
                <div>
                  <strong>{entry.media.titleEnglish || entry.media.title}</strong>
                  <span>{entry.media.type === 'manga' ? 'Capítulo' : 'Episódio'} {entry.progress + 1}</span>
                </div>
                <ChevronRight size={18} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section discover-status">
        <div className="section-title">
          <div>
            <span>DESCOBRIR</span>
            <h2>Descoberta inteligente</h2>
            <p className="section-description">
              Tendências, temporada, popularidade e recomendações locais combinadas com MAL ID.
            </p>
          </div>
          <small>
            {discover.isFetching
              ? 'Atualizando recomendações…'
              : discover.data
                ? `Fonte ativa: ${discover.data.provider}`
                : 'Aguardando dados'}
          </small>
        </div>

        {discover.isLoading && <div className="loading">Montando sua vitrine de descoberta…</div>}
        {discover.isError && (
          <div className="empty">Não foi possível carregar as recomendações agora.</div>
        )}
        {!discover.isLoading && !discover.isError && !hasDiscovery && (
          <div className="empty">Nenhuma recomendação foi encontrada agora. Tente atualizar em alguns minutos.</div>
        )}
        {discover.data && discover.data.partialFailures.length > 0 && hasDiscovery && (
          <div className="discover-warning">
            Algumas listas não responderam, então o AnimeDesk usou os fallbacks disponíveis.
          </div>
        )}
      </section>

      {discover.data && (
        <>
          <DiscoveryShelf
            eyebrow={entries.length ? 'PARA VOCÊ' : 'PARA COMEÇAR'}
            title={entries.length ? 'Recomendados para você' : 'Recomendações para começar'}
            description={entries.length
              ? 'Ranking local que considera seus gêneros, notas, status da biblioteca, qualidade pública, popularidade e recência.'
              : 'Enquanto sua biblioteca está vazia, o AnimeDesk combina qualidade, popularidade e recência.'}
            items={discover.data.recommendations}
            showReasons
          />

          <DiscoveryShelf
            eyebrow="EM ALTA"
            title="Tendências agora"
            description="Obras que estão concentrando mais atenção no momento."
            items={discover.data.trending}
          />

          <DiscoveryShelf
            eyebrow="TEMPORADA"
            title="Destaques desta temporada"
            description="Animes da temporada atual priorizados por interesse da comunidade."
            items={discover.data.seasonal}
          />

          <DiscoveryShelf
            eyebrow="POPULARIDADE"
            title="Mais populares"
            description="Títulos com grande base de usuários e interesse acumulado."
            items={discover.data.popular}
          />

          <DiscoveryShelf
            eyebrow="QUALIDADE"
            title="Melhor avaliados"
            description="Títulos com notas públicas altas; o recomendador reduz o peso de obras já presentes na sua lista."
            items={discover.data.topRated}
          />

          <DiscoveryShelf
            eyebrow="EM BREVE"
            title="Próximas estreias"
            description="Animes marcados como próximos lançamentos, ordenados pela data de estreia."
            items={discover.data.upcoming}
          />
        </>
      )}
    </>
  );
}

function LibraryPage() {
  const entries = useLibraryStore((state) => state.entries);
  const increment = useLibraryStore((state) => state.incrementProgress);
  const setStatus = useLibraryStore((state) => state.setStatus);
  const remove = useLibraryStore((state) => state.remove);
  const openMedia = useUiStore((state) => state.openMedia);

  if (!entries.length) return <EmptyState icon={Library} title="Sua biblioteca está vazia" text="Explore o catálogo e adicione seu primeiro anime ou mangá." />;

  return (
    <section className="section page-section">
      <div className="page-heading"><div><span>SUA COLEÇÃO</span><h1>Minha lista</h1></div><strong>{entries.length} títulos</strong></div>
      <div className="library-list">
        {entries.map((entry) => (
          <article className="library-row" key={`${entry.media.type}-${entry.media.malId}`} onClick={() => openMedia(entry.media)}>
            {entry.media.imageUrl ? <img src={entry.media.imageUrl} alt="" /> : <div className="mini-poster" />}
            <div className="library-info">
              <h3>{entry.media.titleEnglish || entry.media.title}</h3>
              <p>{entry.media.genres.slice(0, 3).join(' · ') || (entry.media.type === 'manga' ? 'Mangá' : 'Anime')}</p>
              {(() => {
                const total = entry.media.type === 'manga' ? entry.media.chapters : entry.media.episodes;
                const unit = entry.media.type === 'manga' ? 'capítulos' : 'episódios';
                const width = total ? Math.min(100, (entry.progress / total) * 100) : 0;
                return (
                  <>
                    <div className="progress-track"><span style={{ width: `${width}%` }} /></div>
                    <small>{entry.progress} / {total ?? '?'} {unit}</small>
                  </>
                );
              })()}
            </div>
            <select
              value={entry.status}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setStatus(entry.media.malId, entry.media.type, event.target.value as typeof entry.status)}
            >
              {entry.media.type === 'manga' ? <option value="reading">Lendo</option> : <option value="watching">Assistindo</option>}
              <option value="planned">{entry.media.type === 'manga' ? 'Quero ler' : 'Quero assistir'}</option>
              <option value="completed">Concluído</option>
              <option value="paused">Pausado</option>
              <option value="dropped">Abandonado</option>
            </select>
            <button
              className="icon-button"
              title={entry.media.type === 'manga' ? 'Avançar capítulo' : 'Avançar episódio'}
              onClick={(event) => {
                event.stopPropagation();
                increment(entry.media.malId, entry.media.type);
              }}
            ><Plus size={18} /></button>
            <button
              className="text-danger"
              onClick={(event) => {
                event.stopPropagation();
                remove(entry.media.malId, entry.media.type);
              }}
            >Remover</button>
          </article>
        ))}
      </div>
    </section>
  );
}

function StatsPage() {
  const entries = useLibraryStore((state) => state.entries);
  const native = isTauriRuntime();
  const history = useQuery({
    queryKey: ['watch-history'],
    queryFn: () => loadWatchHistory(500),
    enabled: native,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const historyItems = history.data ?? [];
  const stats = computeAnimeDeskStats(entries, historyItems);
  const maxMonthly = Math.max(1, ...stats.monthlyActivity.map((item) => item.count));
  const maxGenre = Math.max(1, ...stats.topGenres.map((item) => item.count));
  const maxProvider = Math.max(1, ...stats.providerActivity.map((item) => item.count));
  const providerLabels = new Map(
    stats.providerActivity.map((item) => [item.provider, item.label]),
  );

  return (
    <section className="section page-section stats-page">
      <div className="page-heading">
        <div>
          <span>SEU HISTÓRICO LOCAL</span>
          <h1>Histórico e estatísticas</h1>
        </div>
        <button
          className="button secondary"
          disabled={!native || history.isFetching}
          onClick={() => void history.refetch()}
        >
          <Clock3 size={16} /> {history.isFetching ? 'Atualizando…' : 'Atualizar histórico'}
        </button>
      </div>

      <div className="stats-summary-grid">
        <article className="stats-summary-card">
          <span>BIBLIOTECA</span>
          <strong>{stats.totalTitles}</strong>
          <small>{stats.animeTitles} anime · {stats.mangaTitles} mangá</small>
        </article>
        <article className="stats-summary-card">
          <span>CONCLUÍDOS</span>
          <strong>{stats.completedTitles}</strong>
          <small>{stats.activeTitles} em andamento · {stats.plannedTitles} planejados</small>
        </article>
        <article className="stats-summary-card">
          <span>EPISÓDIOS</span>
          <strong>{stats.episodesProgress.toLocaleString('pt-BR')}</strong>
          <small>progresso total atual em anime</small>
        </article>
        <article className="stats-summary-card">
          <span>CAPÍTULOS</span>
          <strong>{stats.chaptersProgress.toLocaleString('pt-BR')}</strong>
          <small>progresso total atual em mangá</small>
        </article>
        <article className="stats-summary-card accent">
          <span>HORAS ESTIMADAS</span>
          <strong>{stats.estimatedWatchHours.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}h</strong>
          <small>estimativa usando 24 min por episódio</small>
        </article>
        <article className="stats-summary-card">
          <span>SUA NOTA MÉDIA</span>
          <strong>{stats.averageUserScore?.toFixed(1) ?? '—'}</strong>
          <small>{stats.scoredTitles} título(s) avaliados</small>
        </article>
      </div>

      <div className="analytics-grid">
        <section className="analytics-card activity-card">
          <div className="analytics-card-head">
            <div>
              <span>ATIVIDADE</span>
              <h2>Últimos 6 meses</h2>
            </div>
            <small>{stats.historyEvents} evento(s) registrado(s)</small>
          </div>
          <div className="activity-chart">
            {stats.monthlyActivity.map((month) => {
              const height = month.count
                ? Math.max(8, Math.round((month.count / maxMonthly) * 100))
                : 3;
              return (
                <div className="activity-column" key={month.key}>
                  <strong>{month.count}</strong>
                  <div className="activity-track">
                    <span style={{ height: `${height}%` }} />
                  </div>
                  <small>{month.label}</small>
                </div>
              );
            })}
          </div>
          <p className="analytics-note">
            A linha do tempo conta somente eventos registrados pelo AnimeDesk ou por providers futuros.
            Progresso importado do MAL entra nos totais acima, mas não gera histórico retroativo.
          </p>
        </section>

        <section className="analytics-card">
          <div className="analytics-card-head">
            <div>
              <span>PREFERÊNCIAS</span>
              <h2>Gêneros na sua biblioteca</h2>
            </div>
          </div>
          {stats.topGenres.length ? (
            <div className="rank-list">
              {stats.topGenres.map((genre) => (
                <div className="rank-row" key={genre.name}>
                  <div><strong>{genre.name}</strong><span>{genre.count}</span></div>
                  <div className="rank-track">
                    <span style={{ width: `${Math.max(4, (genre.count / maxGenre) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="analytics-empty">Adicione títulos enriquecidos para mapear seus gêneros.</div>
          )}
        </section>

        <section className="analytics-card">
          <div className="analytics-card-head">
            <div>
              <span>ORIGEM</span>
              <h2>Eventos por provider</h2>
            </div>
          </div>
          {stats.providerActivity.length ? (
            <div className="rank-list">
              {stats.providerActivity.map((provider) => (
                <div className="rank-row" key={provider.provider}>
                  <div><strong>{provider.label}</strong><span>{provider.count}</span></div>
                  <div className="rank-track">
                    <span style={{ width: `${Math.max(4, (provider.count / maxProvider) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="analytics-empty">Nenhum evento de progresso foi registrado ainda.</div>
          )}
        </section>
      </div>

      <section className="analytics-card stats-history-card">
        <div className="analytics-card-head">
          <div>
            <span>LINHA DO TEMPO</span>
            <h2>Atividade recente</h2>
          </div>
          <small>{native ? 'SQLite · watch_history' : 'Disponível no app desktop'}</small>
        </div>

        {history.isLoading && <div className="loading">Carregando histórico local…</div>}
        {history.isError && (
          <div className="analytics-empty">Não foi possível ler o histórico local agora.</div>
        )}
        {!history.isLoading && !history.isError && historyItems.length === 0 && (
          <div className="analytics-empty">
            Seu histórico começa quando você avança episódios ou capítulos no AnimeDesk.
          </div>
        )}

        <div className="history-timeline">
          {historyItems.slice(0, 50).map((event) => {
            const date = parseWatchHistoryDate(event.watchedAt);
            const dateLabel = date
              ? date.toLocaleString('pt-BR', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : event.watchedAt;
            const providerLabel =
              providerLabels.get(event.provider) ||
              (event.provider === 'manual' ? 'AnimeDesk' : event.provider);

            return (
              <article className="history-row" key={event.id}>
                <div className="history-cover">
                  {event.imageUrl
                    ? <img src={event.imageUrl} alt="" />
                    : event.mediaType === 'manga'
                      ? <BookOpen size={18} />
                      : <Tv size={18} />}
                </div>
                <div className="history-main">
                  <strong>{event.mediaTitleEnglish || event.mediaTitle}</strong>
                  <span>{formatHistoryUnit(event)} · {providerLabel}</span>
                </div>
                <time>{dateLabel}</time>
              </article>
            );
          })}
        </div>
      </section>
    </section>
  );
}

function ExplorePage() {
  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');
  const [mediaType, setMediaType] = useState<'anime' | 'manga'>('anime');
  const results = useQuery({
    queryKey: ['catalog-search', mediaType, term],
    queryFn: () => mediaType === 'anime' ? searchAnime(term) : searchManga(term),
    enabled: term.length >= 2,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTerm(input.trim());
  };

  const changeType = (type: 'anime' | 'manga') => {
    setMediaType(type);
    if (term.length >= 2) setTerm(input.trim());
  };

  return (
    <section className="section page-section">
      <div className="page-heading">
        <div><span>MYANIMELIST · BUSCA DIRETA</span><h1>Explorar</h1></div>
        <div className="media-type-toggle">
          <button className={mediaType === 'anime' ? 'active' : ''} onClick={() => changeType('anime')}><Tv size={15} /> Animes</button>
          <button className={mediaType === 'manga' ? 'active' : ''} onClick={() => changeType('manga')}><BookOpen size={15} /> Mangás</button>
        </div>
      </div>
      <form className="search-box" onSubmit={submit}>
        <Search size={20} />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={mediaType === 'anime' ? 'Pesquise por Frieren, One Piece, Solo Leveling...' : 'Pesquise por Berserk, Vagabond, One Piece...'}
          autoFocus
        />
        <button type="submit">Pesquisar</button>
      </form>
      {!term && (
        <EmptyState
          icon={mediaType === 'anime' ? Tv : BookOpen}
          title={mediaType === 'anime' ? 'Encontre seu próximo anime' : 'Encontre seu próximo mangá'}
          text="No aplicativo desktop, a busca consulta diretamente o catálogo do MyAnimeList pelo backend nativo."
        />
      )}
      {results.isFetching && <div className="loading">Buscando no catálogo…</div>}
      {results.isError && (
        <div className="empty">
          Não foi possível pesquisar no MyAnimeList. {
            results.error instanceof Error ? results.error.message : String(results.error ?? '')
          }
        </div>
      )}
      {results.data && <div className="media-grid">{results.data.map((media) => <MediaCard key={`${media.type}-${media.malId}`} media={media} />)}</div>}
    </section>
  );
}

function AgendaPage() {
  const entries = useLibraryStore((state) => state.entries);
  const libraryKey = entries
    .filter((entry) => entry.media.type === 'anime')
    .map((entry) => `${entry.media.malId}:${entry.progress}`)
    .sort()
    .join(',');

  const schedule = useQuery({
    queryKey: ['weekly-schedule', libraryKey],
    queryFn: () => getWeeklySchedule(entries),
    staleTime: 1000 * 60 * 15,
  });

  const [agendaNow] = useState(() => new Date());
  const weekDays = useMemo(() => {
    const currentDay = agendaNow.getDay();
    const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay;
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(agendaNow);
      date.setHours(12, 0, 0, 0);
      date.setDate(agendaNow.getDate() + mondayOffset + index);
      return date;
    });
  }, [agendaNow]);

  const localDateKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  const allItems = schedule.data?.items ?? [];
  const libraryItems = allItems.filter((item) => item.inLibrary);
  const visibleItems = entries.some((entry) => entry.media.type === 'anime') && libraryItems.length > 0
    ? libraryItems
    : allItems.slice(0, 40);

  const grouped = new Map<string, typeof visibleItems>();
  for (const item of visibleItems) {
    const key = localDateKey(new Date(item.releaseAt));
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }

  const todayKey = localDateKey(agendaNow);

  return (
    <section className="section page-section">
      <div className="page-heading">
        <div>
          <span>
            LANÇAMENTOS · {schedule.data?.source ?? 'CARREGANDO'}
            {schedule.data?.cached ? ' · CACHE LOCAL' : ''}
          </span>
          <h1>Agenda semanal</h1>
        </div>
        <button className="button secondary" onClick={() => void schedule.refetch()} disabled={schedule.isFetching}>
          <CalendarDays size={16} /> {schedule.isFetching ? 'Atualizando…' : 'Atualizar agenda'}
        </button>
      </div>

      <div className="calendar-strip">
        {weekDays.map((date) => {
          const key = localDateKey(date);
          const count = grouped.get(key)?.length ?? 0;
          return (
            <div className={key === todayKey ? 'day active' : 'day'} key={key}>
              <span>{date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase()}</span>
              <strong>{String(date.getDate()).padStart(2, '0')}</strong>
              <i>{count || ''}</i>
            </div>
          );
        })}
      </div>

      {schedule.isError && (
        <div className="agenda-placeholder">
          <CalendarDays size={30} />
          <div><h3>Não foi possível atualizar a agenda</h3><p>Verifique sua conexão e tente novamente.</p></div>
        </div>
      )}

      {schedule.isFetching && !schedule.data && <div className="loading">Montando a agenda da semana…</div>}

      {!schedule.isFetching && schedule.data && visibleItems.length === 0 && (
        <div className="agenda-placeholder">
          <CalendarDays size={30} />
          <div><h3>Nenhum lançamento encontrado</h3><p>Adicione animes em exibição à sua lista ou atualize a agenda novamente.</p></div>
        </div>
      )}

      <div className="schedule-days">
        {weekDays.map((date) => {
          const key = localDateKey(date);
          const dayItems = grouped.get(key) ?? [];
          if (!dayItems.length) return null;

          return (
            <div className="schedule-day" key={key}>
              <div className="schedule-day-heading">
                <div>
                  <span>{date.toLocaleDateString('pt-BR', { weekday: 'long' })}</span>
                  <strong>{date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}</strong>
                </div>
                <small>{dayItems.length} lançamento(s)</small>
              </div>
              <div className="release-list">
                {dayItems.map((item) => {
                  const releaseDate = new Date(item.releaseAt);
                  return (
                    <article className={item.inLibrary ? 'release-row in-library' : 'release-row'} key={item.id}>
                      <div className="release-poster">
                        {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <Tv size={18} />}
                      </div>
                      <div className="release-main">
                        <div className="release-title-line">
                          <h3>{item.mediaTitle}</h3>
                          {item.inLibrary && <span>NA SUA LISTA</span>}
                        </div>
                        <p>
                          {item.episode ? `Episódio ${item.episode}` : 'Novo episódio'}
                          {' · '}
                          {item.airType === 'sub' ? 'Legendado' : item.airType === 'dub' ? 'Dublado' : 'Exibição original'}
                        </p>
                      </div>
                      <div className="release-time">
                        <strong>{releaseDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong>
                        <span>{item.provider}</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="muted schedule-note">
        {schedule.data?.cached
          ? `Exibindo a última agenda salva localmente (${schedule.data.source}). Tente atualizar quando a conexão voltar.`
          : schedule.data?.source === 'AnimeSchedule'
            ? 'Horários convertidos para America/Sao_Paulo usando AnimeSchedule.'
            : 'Usando Jikan como fallback. Configure VITE_ANIMESCHEDULE_TOKEN para horários e números de episódio mais precisos.'}
      </p>
    </section>
  );
}

function IntegrationsPage() {
  const entries = useLibraryStore((state) => state.entries);
  const importEntries = useLibraryStore((state) => state.importEntries);
  const enrichmentStatus = useEnrichmentStore((state) => state.status);
  const enrichmentTotal = useEnrichmentStore((state) => state.total);
  const enrichmentProcessed = useEnrichmentStore((state) => state.processed);
  const enrichmentCount = useEnrichmentStore((state) => state.enriched);
  const enrichmentCovers = useEnrichmentStore((state) => state.coversCached);
  const enrichmentFailures = useEnrichmentStore((state) => state.failures);
  const enrichmentCurrent = useEnrichmentStore((state) => state.currentTitle);
  const startEnrichment = useEnrichmentStore((state) => state.start);
  const cancelEnrichment = useEnrichmentStore((state) => state.cancel);
  const retryEnrichment = useEnrichmentStore((state) => state.retryFailed);
  const resetEnrichment = useEnrichmentStore((state) => state.reset);
  const [malPreview, setMalPreview] = useState<MalImportPreview | null>(null);
  const [malFileName, setMalFileName] = useState('');
  const [malImporting, setMalImporting] = useState(false);
  const [malMessage, setMalMessage] = useState('');

  const selectMalExport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setMalFileName(file.name);
    setMalMessage('');
    setMalPreview(null);

    try {
      const xml = await readMalExportFile(file);
      const preview = parseMalExportXml(xml);
      setMalPreview(preview);
    } catch (error) {
      setMalMessage(error instanceof Error ? error.message : 'Não foi possível ler o arquivo do MyAnimeList.');
    } finally {
      event.target.value = '';
    }
  };

  const confirmMalImport = async () => {
    if (!malPreview) return;
    setMalImporting(true);
    setMalMessage('');

    try {
      const result = await importEntries(malPreview.entries);
      const skipped = malPreview.skipped ? ` · ${malPreview.skipped} ignorado(s) no XML` : '';
      setMalMessage(
        `Importação concluída: ${result.added} novo(s), ${result.updated} atualizado(s), ${result.unchanged} sem mudanças${skipped}. Enriquecimento iniciado em segundo plano.`,
      );
      const importedEntries = malPreview.entries;
      setMalPreview(null);
      void startEnrichment(importedEntries);
    } catch (error) {
      setMalMessage(error instanceof Error ? error.message : 'A importação falhou ao salvar a biblioteca.');
    } finally {
      setMalImporting(false);
    }
  };

  return (
    <section className="section page-section">
      <div className="page-heading"><div><span>PROVIDERS</span><h1>Contas e integrações</h1></div></div>

      <div className="mal-import-panel">
        <div className="mal-import-head">
          <div className="service-icon">MAL</div>
          <div>
            <span>IMPORTAR BIBLIOTECA</span>
            <h2>Trazer lista do MyAnimeList</h2>
            <p>Selecione o arquivo exportado pelo MAL em formato .xml ou .xml.gz. Depois de salvar progresso, status e nota, o AnimeDesk enriquece os títulos em segundo plano com metadados e capas offline.</p>
          </div>
          <label className="button secondary mal-file-button">
            <Upload size={15} /> Selecionar arquivo
            <input
              type="file"
              accept=".xml,.gz,application/xml,text/xml,application/gzip"
              onChange={(event) => void selectMalExport(event)}
            />
          </label>
        </div>

        {malFileName && !malPreview && !malMessage && <div className="mal-import-state">Lendo {malFileName}…</div>}

        {malPreview && (
          <div className="mal-preview">
            <div>
              <strong>{malPreview.entries.length}</strong>
              <span>itens encontrados</span>
            </div>
            <div>
              <strong>{malPreview.animeCount}</strong>
              <span>animes</span>
            </div>
            <div>
              <strong>{malPreview.mangaCount}</strong>
              <span>mangás</span>
            </div>
            <div>
              <strong>{malPreview.username || '—'}</strong>
              <span>usuário no arquivo</span>
            </div>
            <button
              className="button"
              disabled={malImporting || enrichmentStatus === 'running'}
              onClick={() => void confirmMalImport()}
            >
              {malImporting ? 'Importando…' : `Importar ${malPreview.entries.length} itens`}
            </button>
          </div>
        )}

        {malMessage && <div className="mal-import-message">{malMessage}</div>}

        {(entries.length > 0 || enrichmentStatus !== 'idle') && (
          <div className="enrichment-panel">
            <div className="enrichment-head">
              <div>
                <span>ENRIQUECIMENTO AUTOMÁTICO</span>
                <h3>Metadados e capas da biblioteca</h3>
                <p>
                  Resolve MAL ID → Kitsu em lotes, preserva seu progresso/nota/status e salva capas localmente.
                </p>
              </div>
              <div className="enrichment-actions">
                {enrichmentStatus === 'running' ? (
                  <button className="button secondary" onClick={cancelEnrichment}>Cancelar</button>
                ) : (
                  <>
                    {enrichmentFailures.length > 0 && (
                      <button className="button secondary" onClick={() => void retryEnrichment()}>
                        Tentar falhas novamente
                      </button>
                    )}
                    <button
                      className="button"
                      disabled={!entries.length}
                      onClick={() => void startEnrichment(entries)}
                    >
                      {enrichmentStatus === 'completed' ? 'Enriquecer novamente' : 'Enriquecer biblioteca'}
                    </button>
                    {enrichmentStatus !== 'idle' && (
                      <button className="button secondary" onClick={resetEnrichment}>Limpar status</button>
                    )}
                  </>
                )}
              </div>
            </div>

            {enrichmentStatus !== 'idle' && (
              <div className="enrichment-body">
                <div className="enrichment-progress-row">
                  <strong>
                    {enrichmentStatus === 'running'
                      ? `Processando ${enrichmentProcessed} de ${enrichmentTotal}`
                      : enrichmentStatus === 'completed'
                        ? `Concluído: ${enrichmentProcessed} de ${enrichmentTotal}`
                        : `Cancelado em ${enrichmentProcessed} de ${enrichmentTotal}`}
                  </strong>
                  <span>{enrichmentTotal ? Math.round((enrichmentProcessed / enrichmentTotal) * 100) : 0}%</span>
                </div>
                <div className="enrichment-progress">
                  <span style={{
                    width: `${enrichmentTotal ? Math.min(100, (enrichmentProcessed / enrichmentTotal) * 100) : 0}%`,
                  }} />
                </div>

                {enrichmentCurrent && (
                  <div className="enrichment-current">Agora: {enrichmentCurrent}</div>
                )}

                <div className="enrichment-stats">
                  <div><strong>{enrichmentCount}</strong><span>enriquecidos</span></div>
                  <div><strong>{enrichmentCovers}</strong><span>capas offline</span></div>
                  <div><strong>{enrichmentFailures.length}</strong><span>falhas</span></div>
                </div>

                {enrichmentFailures.length > 0 && (
                  <details className="enrichment-errors">
                    <summary>Ver falhas ({enrichmentFailures.length})</summary>
                    <div>
                      {enrichmentFailures.slice(0, 30).map((failure) => (
                        <p key={`${failure.type}-${failure.malId}`}>
                          <strong>{failure.title}</strong>
                          <span>{failure.reason}</span>
                        </p>
                      ))}
                      {enrichmentFailures.length > 30 && (
                        <small>+ {enrichmentFailures.length - 30} falha(s) não exibida(s).</small>
                      )}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <ExternalMappingsPanel />

      <div className="integration-grid">
        <div className="integration-card live"><div className="service-icon">MAL</div><div><h3>MyAnimeList</h3><p>Busca direta no desktop, identidade MAL ID e importação da biblioteca por XML/XML.GZ.</p></div><span>ATIVO</span></div>
        <div className="integration-card live"><div className="service-icon">KI</div><div><h3>Kitsu</h3><p>Descoberta e enriquecimento automático de metadados/capas resolvidos a partir do MAL ID.</p></div><span>ATIVO</span></div>
        <div className="integration-card live"><div className="service-icon">AS</div><div><h3>AnimeSchedule</h3><p>Agenda precisa quando VITE_ANIMESCHEDULE_TOKEN estiver configurado; Jikan assume automaticamente sem token.</p></div><span>OPCIONAL</span></div>
        <div className="integration-card live"><div className="service-icon">DB</div><div><h3>SQLite local</h3><p>Biblioteca, progresso, histórico e migrations nativas pelo Tauri.</p></div><span>ATIVO</span></div>
        <div className="integration-card live"><div className="service-icon">WIN</div><div><h3>Windows</h3><p>System tray, autostart e notificações de lançamentos.</p></div><span>ATIVO</span></div>
        {plannedStreamingProviders.map((provider) => (
          <div className="integration-card" key={provider.name}>
            <div className="service-icon">{provider.name.slice(0, 2).toUpperCase()}</div>
            <div><h3>{provider.name}</h3><p>{provider.note}</p></div>
            <span>{provider.stage === 'planned' ? 'PLANEJADO' : 'PESQUISA'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsPage() {
  const native = isTauriRuntime();
  const [autostart, setAutostart] = useState(false);
  const [loadingAutostart, setLoadingAutostart] = useState(native);
  const [notificationMessage, setNotificationMessage] = useState('');
  const [releaseAlerts, setReleaseAlerts] = useState(true);
  const [alertLeadMinutes, setAlertLeadMinutesState] = useState(10);
  const [loadingReleasePreferences, setLoadingReleasePreferences] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      getReleaseAlertsEnabled(),
      getReleaseAlertLeadMinutes(),
    ]).then(([enabled, leadMinutes]) => {
      if (cancelled) return;
      setReleaseAlerts(enabled);
      setAlertLeadMinutesState(leadMinutes);
      setLoadingReleasePreferences(false);
    }).catch(() => {
      if (!cancelled) setLoadingReleasePreferences(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!native) return;

    void getAutostartEnabled().then((enabled) => {
      setAutostart(Boolean(enabled));
      setLoadingAutostart(false);
    });
  }, [native]);

  const toggleAutostart = async (checked: boolean) => {
    setLoadingAutostart(true);
    try {
      await setAutostartEnabled(checked);
      setAutostart(checked);
    } finally {
      setLoadingAutostart(false);
    }
  };

  const testNotification = async () => {
    setNotificationMessage('Testando…');
    const success = await sendNativeTestNotification();
    setNotificationMessage(success ? 'Notificação enviada.' : 'Não foi possível enviar a notificação.');
  };

  const toggleReleaseAlerts = async (enabled: boolean) => {
    setReleaseAlerts(enabled);
    await setReleaseAlertsEnabled(enabled);
  };

  const changeAlertLead = async (minutes: number) => {
    setAlertLeadMinutesState(minutes);
    await setReleaseAlertLeadMinutes(minutes);
  };

  return (
    <section className="section page-section">
      <div className="page-heading"><div><span>PREFERÊNCIAS</span><h1>Configurações</h1></div></div>
      <div className="settings-card">
        <label>
          <div><strong>Iniciar com o Windows</strong><span>Abre o AnimeDesk automaticamente após o login.</span></div>
          <input
            type="checkbox"
            checked={autostart}
            disabled={!native || loadingAutostart}
            onChange={(event) => void toggleAutostart(event.target.checked)}
          />
        </label>
        <label>
          <div><strong>Minimizar para bandeja</strong><span>Fechar a janela mantém o AnimeDesk ativo no tray.</span></div>
          <input type="checkbox" checked={native} disabled />
        </label>
        <label>
          <div><strong>Alertas de lançamentos</strong><span>Notifica quando um anime da sua lista estiver perto de lançar um novo episódio.</span></div>
          <input
            type="checkbox"
            checked={releaseAlerts}
            disabled={loadingReleasePreferences}
            onChange={(event) => void toggleReleaseAlerts(event.target.checked)}
          />
        </label>
        <div className="setting-action">
          <div><strong>Antecedência do alerta</strong><span>Quanto tempo antes do lançamento o AnimeDesk deve avisar.</span></div>
          <select
            className="settings-select"
            value={alertLeadMinutes}
            disabled={!releaseAlerts || loadingReleasePreferences}
            onChange={(event) => void changeAlertLead(Number(event.target.value))}
          >
            <option value={10}>10 minutos</option>
            <option value={30}>30 minutos</option>
            <option value={60}>1 hora</option>
          </select>
        </div>
        <div className="setting-action">
          <div><strong>Notificações nativas</strong><span>Use um alerta de teste para validar a integração com o Windows.</span></div>
          <div className="setting-action-buttons">
            {notificationMessage && <small>{notificationMessage}</small>}
            <button className="button secondary" disabled={!native} onClick={() => void testNotification()}>
              <Bell size={15} /> Testar
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function EmptyState({ icon: Icon, title, text }: { icon: typeof Search; title: string; text: string }) {
  return <div className="empty-state"><Icon size={34} /><h3>{title}</h3><p>{text}</p></div>;
}

export default function App() {
  const [page, setPage] = useState<Page>('home');
  const entries = useLibraryStore((state) => state.entries);
  const initializePersistence = useLibraryStore((state) => state.initializePersistence);
  const initialized = useLibraryStore((state) => state.initialized);
  const storageMode = useLibraryStore((state) => state.storageMode);
  const startEnrichment = useEnrichmentStore((state) => state.start);
  const selectedMedia = useUiStore((state) => state.selectedMedia);
  const pageLabel = useMemo(() => navItems.find((item) => item.id === page)?.label, [page]);

  useEffect(() => {
    void initializePersistence();
  }, [initializePersistence]);

  useEffect(() => {
    if (!initialized || !isTauriRuntime()) return;
    return startReleaseWatcher(() => useLibraryStore.getState().entries);
  }, [initialized]);

  useEffect(() => {
    if (!initialized || !isTauriRuntime()) return;
    if (useEnrichmentStore.getState().status !== 'idle') return;

    const missingStudios = useLibraryStore.getState().entries.filter(
      (entry) => entry.media.type === 'anime' && !(entry.media.studios?.length),
    );
    if (!missingStudios.length) return;

    const markerKey = 'animedesk-studio-backfill-v1';

    void (async () => {
      const alreadyAttempted = await getAppState(markerKey);
      if (alreadyAttempted) return;

      await startEnrichment(missingStudios);
      await setAppState(markerKey, new Date().toISOString());
    })();
  }, [initialized, startEnrichment]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Play size={18} fill="currentColor" /></div><div><strong>AnimeDesk</strong><span>TRACK · WATCH · READ</span></div></div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={page === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setPage(item.id)}><Icon size={19} /><span>{item.label}</span>{item.id === 'library' && entries.length > 0 && <b>{entries.length}</b>}</button>;
          })}
        </nav>
        <div className="sidebar-footer"><div className="sync-dot" /><div><strong>{storageMode === 'sqlite' ? 'SQLite nativo' : 'Dados locais'}</strong><span>{storageMode === 'sqlite' ? 'Persistência Tauri ativa' : 'Fallback do navegador'}</span></div></div>
      </aside>

      <main>
        <header className="topbar">
          <div><span className="breadcrumb">AnimeDesk /</span> {pageLabel}</div>
          <div className="top-actions"><button className="icon-button"><Bell size={18} /></button><button className="profile"><CircleUserRound size={22} /><span>Perfil local</span></button></div>
        </header>
        <div className="content">
          {page === 'home' && <HomePage />}
          {page === 'library' && <LibraryPage />}
          {page === 'stats' && <StatsPage />}
          {page === 'agenda' && <AgendaPage />}
          {page === 'explore' && <ExplorePage />}
          {page === 'integrations' && <IntegrationsPage />}
          {page === 'settings' && <SettingsPage />}
        </div>
      </main>
      {selectedMedia && <MediaDetailsModal media={selectedMedia} />}
    </div>
  );
}
