export type FigurePage = { page: number; text: string; blocks?:Array<{id:string;text:string;kind:string;hidden?:boolean;figureCrop?:[number,number,number,number]}> };
export type FigureReference = { id: string; page: number; label: string; caption: string; blockId?:string; crop?:[number,number,number,number]; mentions:Array<{id:string;page:number;text:string}> };

export function findFigureReferences(pages: FigurePage[]): FigureReference[] {
  const found = new Map<string, FigureReference>();
  for (const page of pages) {
    const blocks=page.blocks?.filter(block=>!block.hidden) || page.text.split(/\r?\n/).map((text,index)=>({id:`${page.page}-${index}`,text,kind:'unknown',figureCrop:undefined}));
    for (const block of blocks) {
      const match = block.text.match(/^((?:(?:Extended Data|Supplementary)\s+)?(?:Figure|Fig\.?|Table)\s*\d+(?:[A-Za-z](?=[\s:.\-–—]|$))?)\s*[:.\-–—]?\s*(.*)$/i);
      if (!match) continue;
      if (/^(?:shows?|presents?|illustrates?|summari[sz]es?|reports?|depicts?|provides?|demonstrates?|indicates?|lists?|displays?|compares?|contains?|is\b|was\b|can\b|note\s*:)/i.test(match[2])) continue;
      const standaloneLabel = !match[2].trim();
      if (block.kind !== 'unknown' && block.kind !== 'caption' && !standaloneLabel) continue;
      const label = match[1].replace(/\s+/g, ' ').replace(/\.$/, '');
      const id = label.toLowerCase().replace(/fig\.?\s*/,'figure ').replace(/\s+/g,' ').replace(/[a-z]$/,'');
      const previous=found.get(id);
      if (!previous || (!previous.crop && block.figureCrop)) found.set(id, { id, page: page.page, label, caption:match[2].replace(/\s+/g,' ').trim(),blockId:block.id,crop:block.figureCrop,mentions:[] });
    }
  }
  for(const figure of found.values()){
    const number=figure.label.match(/\d+/)?.[0];
    const kind=/table/i.test(figure.label)?'Table':'(?:Figure|Fig\\.?)';
    const pattern=new RegExp(`\\b${kind}\\s*${number}(?!\\d)`,'i');
    for(const page of pages)for(const block of page.blocks || [])if(!block.hidden && block.kind!=='caption' && block.text.length>40 && pattern.test(block.text))figure.mentions.push({id:block.id,page:page.page,text:block.text});
  }
  return [...found.values()];
}
