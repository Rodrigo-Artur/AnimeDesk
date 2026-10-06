import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link2, ShieldCheck, Trash2 } from 'lucide-react';
import {
  canonicalMalProvider,
  forgetExternalId,
  knownExternalMappings,
  normalizeProviderName,
  rememberExternalId,
} from '../services/normalizer';
import { isTauriRuntime } from '../services/platform';
import { useLibraryStore } from '../store/library';

const KNOWN_PROVIDERS = [
  'kitsu',
  'tmdb',
  'crunchyroll',
  'netflix',
  'primevideo',
  'disneyplus',
  'max',
  'anilist',
] as const;

function mediaKey(type: 'anime' | 'manga', malId: number) {
  return `${type}:${malId}`;
}

function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    kitsu: 'Kitsu',
    tmdb: 'TMDB',
    crunchyroll: 'Crunchyroll',
    netflix: 'Netflix',
    primevideo: 'Prime Video',
    disneyplus: 'Disney+',
    max: 'Max',
    anilist: 'AniList',
    'myanimelist/anime': 'MyAnimeList Anime',
    'myanimelist/manga': 'MyAnimeList Manga',
  };
  return labels[provider] ?? provider;
}

export function ExternalMappingsPanel() {
  const native = isTauriRuntime();
  const entries = useLibraryStore((state) => state.entries);
  const setExternalIds = useLibraryStore((state) => state.setExternalIds);

  const [selectedKey, setSelectedKey] = useState('');
  const [provider, setProvider] = useState('kitsu');
  const [externalId, setExternalId] = useState('');
  const [message, setMessage] = useState('');
  const [busyKey, setBusyKey] = useState('');

  const selectedEntry =
    entries.find((entry) => mediaKey(entry.media.type, entry.media.malId) === selectedKey)
    ?? entries[0];

  const activeKey = selectedEntry
    ? mediaKey(selectedEntry.media.type, selectedEntry.media.malId)
    : '';

  const mappings = useQuery({
    queryKey: ['external-mappings', activeKey],
    queryFn: () => knownExternalMappings(selectedEntry!.media),
    enabled: native && Boolean(selectedEntry),
    staleTime: 0,
  });

  const addMapping = async () => {
    if (!selectedEntry) return;

    const cleanProvider = normalizeProviderName(provider, selectedEntry.media.type);
    const cleanExternalId = externalId.trim();

    if (!provider.trim() || cleanProvider === 'unknown') {
      setMessage('Informe o provider.');
      return;
    }

    if (!cleanExternalId) {
      setMessage('Informe o ID externo.');
      return;
    }

    if (cleanProvider === canonicalMalProvider(selectedEntry.media.type)) {
      setMessage('O MAL ID canônico é gerenciado automaticamente pelo AnimeDesk.');
      return;
    }

    setBusyKey('add');
    setMessage('');

    try {
      const enriched = await rememberExternalId(
        selectedEntry.media,
        cleanProvider,
        cleanExternalId,
        { confidence: 1, verified: true },
      );

      const synchronized = await setExternalIds(
        selectedEntry.media.malId,
        selectedEntry.media.type,
        enriched.externalIds ?? {},
      );

      if (!synchronized) {
        throw new Error('O mapping foi salvo, mas a biblioteca em memória não pôde ser sincronizada.');
      }

      setExternalId('');
      setMessage(`${providerLabel(cleanProvider)} vinculado com sucesso.`);
      await mappings.refetch();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar o mapping.',
      );
    } finally {
      setBusyKey('');
    }
  };

  const removeMapping = async (mappingProvider: string, mappingExternalId: string) => {
    if (!selectedEntry) return;

    const normalizedProvider = normalizeProviderName(
      mappingProvider,
      selectedEntry.media.type,
    );

    if (normalizedProvider === canonicalMalProvider(selectedEntry.media.type)) {
      setMessage('O MAL ID canônico não pode ser removido.');
      return;
    }

    const operationKey = `remove:${normalizedProvider}:${mappingExternalId}`;
    setBusyKey(operationKey);
    setMessage('');

    try {
      await forgetExternalId(
        selectedEntry.media,
        normalizedProvider,
        mappingExternalId,
      );

      const nextIds = { ...(selectedEntry.media.externalIds ?? {}) };
      delete nextIds[normalizedProvider];

      const synchronized = await setExternalIds(
        selectedEntry.media.malId,
        selectedEntry.media.type,
        nextIds,
      );

      if (!synchronized) {
        throw new Error('O mapping foi removido, mas a biblioteca em memória não pôde ser sincronizada.');
      }

      setMessage(`${providerLabel(normalizedProvider)} removido.`);
      await mappings.refetch();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível remover o mapping.',
      );
    } finally {
      setBusyKey('');
    }
  };

  return (
    <section className="mapping-panel">
      <div className="mapping-panel-head">
        <div className="mapping-icon"><Link2 size={18} /></div>
        <div>
          <span>IDENTIDADE EXTERNA</span>
          <h2>Mappings por provider</h2>
          <p>
            Inspecione e confirme IDs externos usados para reconciliar a mesma obra entre serviços.
            O MAL ID é canônico e protegido.
          </p>
        </div>
      </div>

      {!native && (
        <div className="mapping-empty">
          A edição de mappings está disponível no aplicativo desktop Tauri.
        </div>
      )}

      {native && entries.length === 0 && (
        <div className="mapping-empty">
          Adicione ou importe títulos para começar a mapear IDs externos.
        </div>
      )}

      {native && selectedEntry && (
        <>
          <div className="mapping-toolbar">
            <label>
              <span>Obra</span>
              <select
                value={activeKey}
                onChange={(event) => {
                  setSelectedKey(event.target.value);
                  setMessage('');
                }}
              >
                {entries.map((entry) => (
                  <option
                    key={mediaKey(entry.media.type, entry.media.malId)}
                    value={mediaKey(entry.media.type, entry.media.malId)}
                  >
                    {entry.media.titleEnglish || entry.media.title} · {entry.media.type} · MAL {entry.media.malId}
                  </option>
                ))}
              </select>
            </label>

            <div className="mapping-add-form">
              <label>
                <span>Provider</span>
                <input
                  list="animedesk-mapping-providers"
                  value={provider}
                  onChange={(event) => setProvider(event.target.value)}
                  placeholder="kitsu"
                />
                <datalist id="animedesk-mapping-providers">
                  {KNOWN_PROVIDERS.map((item) => (
                    <option value={item} key={item} />
                  ))}
                </datalist>
              </label>
              <label>
                <span>ID externo</span>
                <input
                  value={externalId}
                  onChange={(event) => setExternalId(event.target.value)}
                  placeholder="Ex.: 46474"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void addMapping();
                    }
                  }}
                />
              </label>
              <button
                className="button"
                disabled={busyKey === 'add'}
                onClick={() => void addMapping()}
              >
                {busyKey === 'add' ? 'Salvando…' : 'Adicionar mapping'}
              </button>
            </div>
          </div>

          {message && <div className="mapping-message">{message}</div>}

          <div className="mapping-list">
            {mappings.isLoading && <div className="loading">Lendo mappings do SQLite…</div>}
            {mappings.isError && (
              <div className="mapping-empty">Não foi possível carregar os mappings desta obra.</div>
            )}

            {mappings.data?.map((mapping) => {
              const operationKey = `remove:${mapping.provider}:${mapping.externalId}`;
              return (
                <article
                  className={mapping.canonical ? 'mapping-row canonical' : 'mapping-row'}
                  key={`${mapping.provider}:${mapping.externalId}`}
                >
                  <div className="mapping-provider">
                    <strong>{providerLabel(mapping.provider)}</strong>
                    <span>{mapping.provider}</span>
                  </div>
                  <code>{mapping.externalId}</code>
                  <div className="mapping-badges">
                    {mapping.canonical && <span className="canonical-badge">CANÔNICO</span>}
                    {mapping.verified && (
                      <span className="verified-badge">
                        <ShieldCheck size={12} /> VERIFICADO
                      </span>
                    )}
                    {!mapping.verified && (
                      <span>{Math.round((mapping.confidence ?? 0) * 100)}% confiança</span>
                    )}
                  </div>
                  <button
                    className="mapping-remove"
                    title={mapping.canonical ? 'MAL ID canônico protegido' : 'Remover mapping'}
                    disabled={mapping.canonical || busyKey === operationKey}
                    onClick={() => void removeMapping(mapping.provider, mapping.externalId)}
                  >
                    <Trash2 size={15} />
                  </button>
                </article>
              );
            })}

            {!mappings.isLoading && !mappings.isError && mappings.data?.length === 0 && (
              <div className="mapping-empty">Nenhum mapping externo conhecido.</div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
