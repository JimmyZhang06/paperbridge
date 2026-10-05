export type PdfBlockKind = 'heading' | 'paragraph' | 'caption' | 'reference' | 'other' | 'title' | 'authors' | 'abstract' | 'metadata' | 'affiliation';
export type PdfTextBlock = {
  id: string;
  kind: PdfBlockKind;
  headingLevel?: 1 | 2 | 3;
  text: string;
  fontSize?: number;
  runs?: Array<{ text: string; bold?: boolean; italic?: boolean; vertical?: 'super' | 'sub' }>;
  /** Normalized x, y, width and height in page coordinates (0–1). */
  bbox: [number, number, number, number];
  /** Estimated normalized area occupied by the visual immediately around a figure/table caption. */
  figureCrop?: [number, number, number, number];
  confidence: number;
  source: 'text-layer' | 'ocr';
  hidden?: boolean;
  originalText?: string;
  originalRuns?: PdfTextBlock['runs'];
  manualFigureCrop?: [number,number,number,number];
};
export type SourceAnchor = {
  paperId: string;
  fileHash: string;
  extractionRevision: string;
  pageIndex: number;
  blockId?: string;
  quote?: { exact: string; prefix: string; suffix: string };
  /** Rectangles in normalized, unrotated page coordinates, top-left origin. */
  rects?: Array<[number, number, number, number]>;
};
export type SourceEvidence = { id: string; page: number; text: string; section: string; anchor: SourceAnchor };
export type PdfPageQuality = {
  status: 'good' | 'needs-review' | 'low-text' | 'empty';
  characterCount: number;
  textItemCount: number;
  warnings: string[];
};
export type PaperPage = {
  page: number;
  text: string;
  paragraphs?: string[];
  blocks?: PdfTextBlock[];
  quality?: PdfPageQuality;
};
export type PdfExtractionSummary = {
  engine: string;
  quality: 'good' | 'partial';
  warnings: string[];
  lowTextPages: number[];
  reviewPages?: number[];
  doi?: string;
};

export type Paper = {
  id: string;
  title: string;
  author: string;
  filename: string;
  fileKey: string;
  createdAt: string;
  groupId: string | null;
  pageCount: number;
  pages: PaperPage[];
  extraction?: PdfExtractionSummary;
  metadataCorrected?: boolean;
  fileHash?: string;
  extractionRevision?: string;
  completedStages?: string[];
};

export type PaperGroup = { id: string; name: string; createdAt: string };

export type ProviderConfig = {
  id: string;
  name: string;
  kind: 'openai-compatible';
  baseUrl: string;
  model: string;
  protocol?: 'chat-completions' | 'responses';
  apiKey: string;
  enabled: boolean;
};

export type LearningNote = {
  id: string;
  paperId: string;
  page: number;
  passage: string;
  firstAttempt: string;
  revisedUnderstanding: string;
  uncertainty?: string;
  stageId?: string;
  kind?: 'learning' | 'ai' | 'highlight';
  aiAnswer?: string;
  highlightColor?: 'yellow' | 'blue' | 'green';
  createdAt: string;
  updatedAt: string;
  anchor?: SourceAnchor;
  tags?: string[];
  originMessageId?: string;
};

export type GlossaryTerm = {
  id: string;
  paperId: string;
  term: string;
  meaning: string;
  passage: string;
  page: number;
  createdAt: string;
  anchor?: SourceAnchor;
};

export type StudyTurn = {
  id: string;
  paperId: string;
  page: number;
  action: 'hint' | 'explain' | 'check';
  passage: string;
  answer: string;
  createdAt: string;
  provider: string;
  anchor?: SourceAnchor;
};

export type AssistantChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  provider?: string;
  mode?: 'provider' | 'demo';
  paperId?: string;
  paperTitle?: string;
  paperPageCount?: number;
  paperScope?: 'full-paper';
  page?: number;
  sources?: SourceEvidence[];
  status?: 'complete' | 'interrupted' | 'failed';
};

export type AssistantConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AssistantChatMessage[];
};

export type Store = {
  papers: Paper[];
  groups: PaperGroup[];
  providers: ProviderConfig[];
  activeProviderId: string | null;
  notes: LearningNote[];
  terms: GlossaryTerm[];
  turns: StudyTurn[];
  conversations: AssistantConversation[];
};
