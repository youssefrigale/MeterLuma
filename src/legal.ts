import type { Settings } from './model';

export const LEGAL_VERSION = '1.1-providers-7';
// Revision 6 still covers history-only Claude and the existing Codex/Cursor connections.
export const hasProviderConsent = (settings: Pick<Settings, 'legalVersion'>) => [LEGAL_VERSION, '1.1-providers-6'].includes(settings.legalVersion);
export const hasClaudeUsageConsent = (settings: Pick<Settings, 'legalVersion' | 'claudeLive'>) => settings.legalVersion === LEGAL_VERSION && settings.claudeLive === true;
