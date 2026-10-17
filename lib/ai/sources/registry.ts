import 'server-only';
import type { SourceEntry } from './types';
import { loadClassicsSources } from './adapters/classics';
import { loadTianjiSources } from './adapters/tianji';
import { loadNihaiSources } from './adapters/nihai';
import { loadHemingSources } from './adapters/heming';

let cache: SourceEntry[] | null = null;

export function getAllSources(): SourceEntry[] {
  if (!cache) {
    cache = [
      ...loadTianjiSources(),
      ...loadClassicsSources(),
      ...loadNihaiSources(),
      ...loadHemingSources(),
    ].sort((a, b) => a.id.localeCompare(b.id));
  }
  return cache;
}
