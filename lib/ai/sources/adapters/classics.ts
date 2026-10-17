import 'server-only';
import { ALL_BOOKS } from '@/lib/classics';
import type { TopicKey } from '@/lib/ziwei/db-analysis';
import type { SourceEntry } from '../types';
import { defaultTopics, tagText } from '../tagger';

const TOPICS: TopicKey[] = ['overview', 'personality', 'love', 'career', 'wealth', 'family', 'home', 'spirit'];

export function loadClassicsSources(): SourceEntry[] {
  const entries: SourceEntry[] = [];
  for (const book of ALL_BOOKS) {
    book.chapters.forEach((chapter, chapterIdx) => {
      chapter.paragraphs.forEach(paragraph => {
        const tags = tagText(paragraph.text);
        entries.push({
          id: `classic:${book.slug}:${chapterIdx}:${paragraph.id}`,
          kind: 'classic',
          author: book.author,
          work: `《${book.title}》`,
          school: '古本',
          citation: `${book.title}·${chapter.title}`,
          text: paragraph.text,
          topics: defaultTopics(paragraph.text, TOPICS),
          stars: tags.stars,
          palaces: tags.palaces,
          patterns: [],
          hua: tags.hua,
          weight: 90,
        });
      });
    });
  }
  return entries;
}
