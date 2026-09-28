export type PaperPage = { page: number; text: string };

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
};

export type GlossaryTerm = {
  id: string;
  paperId: string;
  term: string;
  meaning: string;
  passage: string;
  page: number;
  createdAt: string;
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
