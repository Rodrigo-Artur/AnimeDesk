export type MediaType = 'anime' | 'manga';
export type LibraryStatus = 'watching' | 'reading' | 'planned' | 'completed' | 'paused' | 'dropped';

export interface Media {
  id: number;
  malId: number;
  type: MediaType;
  title: string;
  titleEnglish?: string | null;
  imageUrl?: string;
  score?: number | null;
  episodes?: number | null;
  chapters?: number | null;
  status?: string;
  synopsis?: string;
  genres: string[];
  year?: number | null;
  externalIds?: Record<string, string>;
}

export interface MediaRelationEntry {
  malId: number;
  type: MediaType;
  name: string;
}

export interface MediaRelation {
  relation: string;
  entries: MediaRelationEntry[];
}

export interface MediaDetails extends Media {
  rank?: number | null;
  popularity?: number | null;
  members?: number | null;
  favorites?: number | null;
  studios?: string[];
  authors?: string[];
  relations?: MediaRelation[];
  background?: string | null;
  trailerUrl?: string | null;
  url?: string | null;
}

export interface LibraryEntry {
  media: Media;
  status: LibraryStatus;
  progress: number;
  score?: number;
  updatedAt: string;
}

export interface ReleaseItem {
  id: string;
  mediaTitle: string;
  mediaMalId?: number;
  episode?: number;
  chapter?: number;
  releaseAt: string;
  provider: string;
  imageUrl?: string;
  airType?: string;
  inLibrary?: boolean;
}

export interface WatchHistoryEvent {
  id: number;
  mediaType: MediaType;
  mediaMalId: number;
  mediaTitle: string;
  mediaTitleEnglish?: string | null;
  imageUrl?: string;
  episode?: number | null;
  chapter?: number | null;
  provider: string;
  watchedAt: string;
  sourceEventId?: string | null;
}
