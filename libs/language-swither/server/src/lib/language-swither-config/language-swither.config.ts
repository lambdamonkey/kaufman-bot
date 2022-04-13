export const LANGUAGE_SWITHER_CONFIG = 'LANGUAGE_SWITHER_CONFIG';

export const DEFAULT_LANGUAGE = 'en';

export interface LanguageSwitherConfig {
  title: string;
  name: string;
  descriptions: string;
  usage: string[];
  spyWords: string[];
  removeWords?: string[];
  category: string;
}
