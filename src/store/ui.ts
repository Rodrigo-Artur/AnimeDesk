import { create } from 'zustand';
import type { Media } from '../types/media';

type UiStore = {
  selectedMedia: Media | null;
  openMedia: (media: Media) => void;
  closeMedia: () => void;
};

export const useUiStore = create<UiStore>((set) => ({
  selectedMedia: null,
  openMedia: (media) => set({ selectedMedia: media }),
  closeMedia: () => set({ selectedMedia: null }),
}));
