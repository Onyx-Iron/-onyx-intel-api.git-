export interface TextPage {
  page_number: number;
  text: string;
}

export interface TextExcerpt {
  page_number: number;
  excerpt: string;
}

function tokensOf(question: string): string[] {
  return [...new Set((question.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []))];
}

function snippet(text: string, tokens: string[]): string {
  const hay = text.toLowerCase();
  const at = tokens.map((token) => hay.indexOf(token)).filter((index) => index >= 0);
  const startAt = at.length > 0 ? Math.max(0, Math.min(...at) - 80) : 0;
  const slice = text.slice(startAt, startAt + 500).replace(/\s+/g, " ").trim();
  return startAt > 0 ? `…${slice}` : slice;
}

/** Rank stored page text by the words in the question and return the closest excerpts. */
export function excerptsForQuestion(pages: TextPage[], question: string, limit = 8): TextExcerpt[] {
  const tokens = tokensOf(question);
  if (tokens.length === 0) return [];
  return pages
    .map((page) => {
      const hay = page.text.toLowerCase();
      const hits = tokens.filter((token) => hay.includes(token)).length;
      return { page, hits };
    })
    .filter((row) => row.hits > 0 && row.page.text.trim())
    .sort((a, b) => b.hits - a.hits || a.page.page_number - b.page.page_number)
    .slice(0, limit)
    .map(({ page }) => ({
      page_number: page.page_number,
      excerpt: snippet(page.text, tokens),
    }));
}

export function formatExcerpts(excerpts: TextExcerpt[]): string {
  if (excerpts.length === 0) {
    return "The stored text on this document does not contain those words.";
  }
  return excerpts.map((row) => `Page ${row.page_number}: ${row.excerpt}`).join("\n\n");
}
