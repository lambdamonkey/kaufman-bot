export const LANGUAGE_SWITHER_CONFIG = 'LANGUAGE_SWITHER_CONFIG';

export interface LanguageSwitherConfig {
  title: string;
  name: string;
  descriptions: string;
  usage: string[];
  spyWords: string[];
  removeWords?: string[];
  category: string;
}
