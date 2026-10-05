"""Local geometry extractor. Original PDFs are read only. NDJSON protocol on stdout."""
import json
import re
import sys
from pathlib import Path

def emit(value):
    print(json.dumps(value, ensure_ascii=True), flush=True)

def extract(filename):
    import pymupdf
    document = pymupdf.open(filename)
    if document.needs_pass:
        raise ValueError('PDF is password protected; unlock it locally before importing.')
    pages, warnings = [], []
    try:
        for page_index, page in enumerate(document):
            # Normalize rotations so all engines share unrotated top-left coordinates.
            if page.rotation:
                page.set_rotation(0)
            width, height = page.rect.width, page.rect.height
            textpage = None
            ocr = False
            if len(page.get_text().strip()) < 25:
                try:
                    textpage = page.get_textpage_ocr(language='eng', dpi=200, full=True)
                    ocr = True
                except Exception:
                    warnings.append(f'Page {page_index + 1}: OCR unavailable; install Tesseract language data to extract scanned text. Original PDF remains readable.')
            blocks = page.get_text('dict', textpage=textpage)['blocks']
            items = []
            for block in blocks:
                if block['type'] != 0:
                    continue
                for line in block['lines']:
                    if abs(line.get('dir', (1, 0))[1]) > 0.5:
                        continue
                    spans = line['spans']
                    for index, span in enumerate(spans):
                        x0, y0, x1, y1 = span['bbox']
                        font, flags = span['font'], span['flags']
                        items.append(dict(text=span['text'], x=x0, y=y0,
                            baseline=height-span['origin'][1], width=x1-x0, height=y1-y0,
                            fontSize=span['size'], fontName=font,
                            bold=bool(flags & 16) or bool(re.search('bold|black|heavy', font, re.I)),
                            italic=bool(flags & 2) or bool(re.search('italic|oblique', font, re.I)),
                            hasEOL=index == len(spans)-1))
            visuals = [pymupdf.Rect(image['bbox']) for image in page.get_image_info()]
            try:
                visuals.extend(page.cluster_drawings())
            except Exception:
                pass
            normalized = []
            for rect in visuals:
                rect = rect & page.rect
                if rect.is_empty:
                    continue
                if rect.width/width > 0.1 and rect.height/height > 0.05:
                    normalized.append([rect.x0/width, rect.y0/height, rect.width/width, rect.height/height])
            pages.append(dict(page=page_index+1, width=width, height=height, items=items, visuals=normalized, ocr=ocr))
            emit(dict(type='progress', page=page_index+1, total=len(document)))
        return dict(pages=pages, title=document.metadata.get('title') or '', author=document.metadata.get('author') or '', warnings=warnings)
    finally:
        document.close()

if __name__ == '__main__':
    try:
        filename = str(Path(sys.argv[1]).resolve(strict=True))
        emit(dict(type='result', result=extract(filename)))
    except Exception as error:
        emit(dict(type='error', error=str(error)))
        sys.exit(1)
