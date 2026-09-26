export type FigurePage = { page: number; text: string };
export type FigureReference = { id: string; page: number; label: string; caption: string };

export function findFigureReferences(pages: FigurePage[]): FigureReference[] {
  const found = new Map<string, FigureReference>();
  for (const page of pages) {
    const lines = page.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^((?:Figure|Fig\.?|Table)\s*\d+[A-Za-z]?)\s*[:.\-–—]?\s*(.*)$/i);
      if (!match) continue;
      const label = match[1].replace(/\s+/g, ' ').replace(/\.$/, '');
      const next = match[2] || lines[index + 1] || '';
      const id = `${label.toLowerCase()}-${page.page}`;
      if (!found.has(id)) found.set(id, { id, page: page.page, label, caption: `${match[2]} ${next === match[2] ? '' : next}`.replace(/\s+/g, ' ').trim().slice(0, 220) });
    }
  }
  return [...found.values()];
}
