import type { LibraryEntry, Media, ReleaseItem } from '../types/media';

export interface CatalogProvider {
  name: string;
  searchAnime(query: string): Promise<Media[]>;
}

export interface ScheduleProvider {
  name: string;
  getUpcoming(from: Date, to: Date): Promise<ReleaseItem[]>;
}

export interface StreamingProvider {
  name: string;
  capabilities: {
    history: boolean;
    watchlist: boolean;
    progress: boolean;
    automaticSync: boolean;
  };
  connect?(): Promise<void>;
  importLibrary?(): Promise<LibraryEntry[]>;
}

export const plannedStreamingProviders = [
  { name: 'Crunchyroll', stage: 'planned', note: 'Sessão/API interna isolada em provider.' },
  { name: 'Netflix', stage: 'planned', note: 'Importação oficial do histórico CSV.' },
  { name: 'Prime Video', stage: 'planned', note: 'Importação de histórico/exportação local.' },
  { name: 'Disney+', stage: 'research', note: 'Integração experimental.' },
  { name: 'Max', stage: 'research', note: 'Integração experimental.' },
] as const;
