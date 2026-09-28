import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  ArrowDown, ArrowRight, BarChart3, BookOpen, Check, CheckCheck, ChevronDown, ChevronLeft,
  ChevronRight, CircleHelp, Clock3, FileText, Folder, FolderOpen, FolderPlus, Highlighter, Languages, Library, LoaderCircle,
  MessageCircle, PanelRightClose, PanelRightOpen, Plus, Save, Search, Settings2, SlidersHorizontal, Sparkles,
  Trash2, Upload, X, Zap,
} from 'lucide-react';
import './styles.css';
import './library.css';
import './library-tweaks.css';
import { StudyRoadmap, type StudyStageId, type StudySource } from './features/study/StudyRoadmap';
import { findFigureReferences, type FigureReference } from './features/reader/figureReferences';
import { FigureStudyPanel } from './features/reader/FigureStudyPanel';
import { StudyNotesPanel } from './features/notes/StudyNotesPanel';
import { AssistantChatPanel } from './features/assistant/AssistantChatPanel';
import { AssistantTranslatePanel } from './features/assistant/AssistantTranslatePanel';
import { api, apiUrl } from './api';
import { MarkdownContent } from './components/MarkdownContent';
import { BrandMark } from './components/BrandMark';
import { AppButton } from './components/AppButton';
import { SelectMenu } from './components/SelectMenu';
import './design-system.css';
import './responsive.css';
import './markdown.css';
import './features/assistant/assistant.css';

const PdfPageViewer = lazy(() => import('./PdfPageViewer'));

type Paragraph = { id: string; page: number; text: string; section?: string };
type Paper = { id: string; title: string; author: string; filename: string; pageCount: number; groupId?: string | null; noteCount?: number; pages: Array<{ page: number; text: string; paragraphs: string[] }> };
type PaperGroup = { id: string; name: string; paperCount: number; createdAt: string };
type Provider = { id: string; name: string; kind: 'openai-compatible'; baseUrl: string; model: string; protocol?: 'chat-completions' | 'responses'; hasApiKey: boolean; apiKey: string };
type Note = { id: string; paperId: string; paperTitle?: string; page: number; passage: string; firstAttempt: string; revisedUnderstanding: string; uncertainty?: string; stageId?: StudyStageId; kind?: 'learning' | 'ai' | 'highlight'; aiAnswer?: string; highlightColor?: 'yellow' | 'blue' | 'green'; createdAt: string; updatedAt: string };
type GlossaryTerm = { id: string; paperId: string; term: string; meaning: string; passage: string; page: number; createdAt: string };
type Turn = { id: string; page: number; action: 'hint' | 'explain' | 'check'; passage: string; answer: string; createdAt: string; provider: string; mode?: 'provider' | 'demo'; question?: string };
type ProviderSnapshot = { activeProviderId: string | null; providers: Provider[] };

const makeParagraphs = (paper: Paper): Paragraph[] => {
  let section = '';
  const heading = /^(abstract|introduction|method|participants|procedures|measures|data reduction and analysis|results|discussion|limitations|summary and future directions|hypotheses)$/i;
  return paper.pages.flatMap(page => page.paragraphs.map((text, index) => {
    if (heading.test(text.trim())) section = text.trim();
    return { id: `${page.page}-${index}`, page: page.page, text, section };
  }));
};
const snippet = (text: string) => text.replace(/\s+/g, ' ').slice(0, 110);
const progressFor = (notes: Note[], paper?: Paper) => !paper || !paper.pageCount ? 0 : Math.min(100, Math.round(new Set(notes.map(note => note.page)).size / paper.pageCount * 100));

function App() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [groups, setGroups] = useState<PaperGroup[]>([]);
  const [groupFilter, setGroupFilter] = useState<'all' | 'ungrouped' | string>('all');
  const [paper, setPaper] = useState<Paper | null>(null);
  const [paragraphs, setParagraphs] = useState<Paragraph[]>([]);
  const [activeParagraph, setActiveParagraph] = useState<Paragraph | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [allTerms, setAllTerms] = useState<GlossaryTerm[]>([]);
  const [allNotes, setAllNotes] = useState<Note[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [attempt, setAttempt] = useState('');
  const [revised, setRevised] = useState('');
  const [uncertainty, setUncertainty] = useState('');
  const [assistantTab, setAssistantTab] = useState<'tutor' | 'roadmap' | 'figures' | 'notes'>('tutor');
  const [assistantMode, setAssistantMode] = useState<'tutor' | 'chat' | 'translate'>('tutor');
  const [studyStage, setStudyStage] = useState<StudyStageId>('background');
  const [studyQuestion, setStudyQuestion] = useState<string | null>(null);
  const [selectedFigureId, setSelectedFigureId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [assistantCollapsed, setAssistantCollapsed] = useState(false);
  const [chatToolbarActionsTarget, setChatToolbarActionsTarget] = useState<HTMLElement | null>(null);
  const chatToolbarActionsRef = useCallback((element: HTMLDivElement | null) => setChatToolbarActionsTarget(element), []);
  const [mobileFocus, setMobileFocus] = useState<'reader' | 'assistant'>('reader');
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [readerMode, setReaderMode] = useState<'text' | 'pdf'>('text');
  const [readerSettingsOpen, setReaderSettingsOpen] = useState(false);
  const [readerFontSize, setReaderFontSize] = useState(() => Number(localStorage.getItem('paperbridge:reader-font-size')) || 17);
  const [readerLineHeight, setReaderLineHeight] = useState(() => Number(localStorage.getItem('paperbridge:reader-line-height')) || 1.8);
  const [readerFont, setReaderFont] = useState<'serif' | 'sans'>(() => localStorage.getItem('paperbridge:reader-font') === 'sans' ? 'sans' : 'serif');
  const [standaloneNotes, setStandaloneNotes] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingPaper, setLoadingPaper] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const revisionRef = useRef<HTMLTextAreaElement>(null);

  const activeIndex = activeParagraph ? paragraphs.findIndex(p => p.id === activeParagraph.id) : -1;
  const activePage = currentPage;
  const pageParagraphs = useMemo(() => paragraphs.filter(p => p.page === activePage), [paragraphs, activePage]);
  const currentPageIndex = paper?.pages.findIndex(p => p.page === activePage) ?? -1;
  const currentRawPage = currentPageIndex >= 0 ? paper?.pages[currentPageIndex] : undefined;
  const figureReferences = useMemo(() => findFigureReferences(paper?.pages || []), [paper]);
  const progress = progressFor(notes, paper || undefined);
  // Responses are stored per paper; only surface answers tied to the passage in focus.
  const activeTurns = useMemo(() => turns.filter(turn =>
    turn.page === activeParagraph?.page && turn.passage === activeParagraph?.text
  ), [turns, activeParagraph]);
  const savedNote = notes.find(n => (n.kind || 'learning') === 'learning' && n.page === activePage && (n.passage === activeParagraph?.text || Boolean(activeParagraph?.text.includes(n.passage))));
  const visiblePapers = papers.filter(item => {
    const inGroup = groupFilter === 'all' || (groupFilter === 'ungrouped' ? !item.groupId : item.groupId === groupFilter);
    const matchesQuery = item.title.toLowerCase().includes(query.toLowerCase()) || item.filename.toLowerCase().includes(query.toLowerCase());
    return inGroup && matchesQuery;
  });

  async function reloadPapers() {
    const data = await api<Array<Paper>>('/api/papers');
    setPapers(data);
    return data;
  }
  async function reloadGroups() {
    const data = await api<PaperGroup[]>('/api/groups');
    setGroups(data);
    return data;
  }
  async function reloadAllNotes() {
    const data = await api<Note[]>('/api/notes');
    setAllNotes(data);
    return data;
  }
  async function reloadAllTerms() {
    const data = await api<GlossaryTerm[]>('/api/terms');
    setAllTerms(data);
    return data;
  }
  async function reloadProviders() {
    const data = await api<ProviderSnapshot>('/api/providers');
    setProviders(data.providers);
    setActiveProviderId(data.activeProviderId);
  }
  async function openPaper(id: string) {
    setLoadingPaper(true);
    setMessage('');
    try {
      const data = await api<Paper>(`/api/papers/${id}`);
      localStorage.setItem('paperbridge:last-paper-id', id);
      setPaper(data);
      const allParagraphs = makeParagraphs(data);
      setParagraphs(allParagraphs);
      const storedPage = Number(localStorage.getItem(`paperbridge:last-page:${id}`));
      const restoredParagraph = allParagraphs.find(item => item.page === storedPage) || allParagraphs[0] || null;
      setActiveParagraph(restoredParagraph);
      setCurrentPage(restoredParagraph?.page || 1);
      setAttempt(''); setRevised(''); setUncertainty(''); setTurns([]);
      setAssistantTab('tutor');
      setAssistantCollapsed(false);
      setMobileFocus('reader');
      const [learning, paperTerms] = await Promise.all([
        api<{ notes: Note[]; turns: Turn[] }>(`/api/papers/${id}/learning`),
        api<GlossaryTerm[]>(`/api/papers/${id}/terms`),
      ]);
      setNotes(learning.notes); setTurns(learning.turns);
      setTerms(paperTerms);
      const firstSaved = learning.notes.find(note => note.page === allParagraphs[0]?.page && note.passage === allParagraphs[0]?.text);
      if (firstSaved) { setAttempt(firstSaved.firstAttempt); setRevised(firstSaved.revisedUnderstanding); setUncertainty(firstSaved.uncertainty || ''); if (firstSaved.stageId) setStudyStage(firstSaved.stageId); }
      return data;
    } catch (error) { setMessage((error as Error).message); }
    finally { setLoadingPaper(false); setLibraryOpen(false); }
  }
  useEffect(() => {
    Promise.all([reloadPapers(), reloadProviders(), reloadGroups(), reloadAllNotes(), reloadAllTerms()]).then(([loaded]) => {
      if (loaded[0]) {
        const lastPaperId = localStorage.getItem('paperbridge:last-paper-id');
        const paperToRestore = loaded.find(item => item.id === lastPaperId) || loaded[0];
        void openPaper(paperToRestore.id);
      } else localStorage.removeItem('paperbridge:last-paper-id');
    }).catch(error => setMessage((error as Error).message));
  }, []);
  useEffect(() => {
    if (paper) localStorage.setItem(`paperbridge:last-page:${paper.id}`, String(currentPage));
  }, [paper?.id, currentPage]);
  useEffect(() => {
    localStorage.setItem('paperbridge:reader-font-size', String(readerFontSize));
    localStorage.setItem('paperbridge:reader-line-height', String(readerLineHeight));
    localStorage.setItem('paperbridge:reader-font', readerFont);
  }, [readerFontSize, readerLineHeight, readerFont]);


  async function uploadFile(file?: File) {
    if (!file) return;
    const form = new FormData(); form.append('file', file);
    if (groupFilter !== 'all' && groupFilter !== 'ungrouped') form.append('groupId', groupFilter);
    setUploading(true); setMessage('');
    try {
      const uploaded = await api<Paper>('/api/papers', { method: 'POST', body: form });
      await Promise.all([reloadPapers(), reloadGroups(), reloadAllNotes()]);
      await openPaper(uploaded.id);
      setMessage('论文已解析，可以开始精读。');
    } catch (error) { setMessage((error as Error).message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  function selectParagraph(target: Paragraph) {
    setActiveParagraph(target);
    setCurrentPage(target.page);
    const saved = notes.find(note => note.page === target.page && (note.passage === target.text || target.text.includes(note.passage)));
    setAttempt(saved?.firstAttempt || ''); setRevised(saved?.revisedUnderstanding || ''); setUncertainty(saved?.uncertainty || '');
    if (saved?.stageId) setStudyStage(saved.stageId);
  }
  function selectRoadmapSource(source: StudySource) {
    const target = paragraphs.find(item => item.id === source.id);
    if (target) { selectParagraph(target); setReaderMode('text'); }
  }
  function returnToOriginal() {
    if (!activeParagraph) return;
    setReaderMode('text');
    setAssistantTab('tutor');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const node = document.querySelector<HTMLElement>(`[data-paragraph-id="${CSS.escape(activeParagraph.id)}"]`);
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
  }
  function openFigureReference(reference: FigureReference, showTutor = false) {
    const target = paragraphs.find(item => item.page === reference.page && new RegExp(reference.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(item.text))
      || paragraphs.find(item => item.page === reference.page && /\b(?:figure|fig\.?|table)\s*\d+/i.test(item.text))
      || paragraphs.find(item => item.page === reference.page);
    if (target) selectParagraph(target);
    else setActiveParagraph(null);
    setCurrentPage(reference.page);
    setSelectedFigureId(reference.id);
    setReaderMode('pdf');
    if (showTutor) {
      setStudyStage('findings');
      setStudyQuestion(`图表精读（${reference.label}）：请先根据 PDF 原图记录图题、坐标轴/列标题、比较对象和你观察到的结果，再用图题及正文核对。区分图中直接显示的数据与作者的解释；若涉及变量关联，不要直接写成因果。`);
      setAttempt(''); setRevised(''); setUncertainty(''); setTurns([]);
      setAssistantTab('tutor');
    }
  }
  function askTutorAboutFigure(reference: FigureReference) {
    openFigureReference(reference, true);
  }
  function navigatePage(page: number) {
    if (!paper || page < 1 || page > paper.pageCount) return;
    setCurrentPage(page);
    const first = paragraphs.find(paragraph => paragraph.page === page);
    setActiveParagraph(first || null);
    setAttempt(''); setRevised(''); setUncertainty('');
  }
  function openChatCitation(page: number) {
    navigatePage(page);
    setReaderMode('text');
    setMobileFocus('reader');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const target = paragraphs.find(item => item.page === page);
      if (target) document.querySelector<HTMLElement>(`[data-paragraph-id="${CSS.escape(target.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
  }
  function openFigureStudy() {
    setAssistantCollapsed(false);
    setMobileFocus('assistant');
    setAssistantTab('figures');
  }
  function changeAssistantView(value: string) {
    if (value.startsWith('tutor:')) {
      setAssistantTab('tutor');
      setAssistantMode(value.slice('tutor:'.length) as 'tutor' | 'chat' | 'translate');
      return;
    }
    if (value === 'figures') { openFigureStudy(); return; }
    if (value === 'notes') void reloadAllNotes();
    setAssistantTab(value as 'roadmap' | 'notes');
  }
  async function askTutor(action: Turn['action'], question?: string) {
    if (!paper || !activeParagraph) return;
    setLoadingAction(action); setMessage('');
    try {
      const turn = await api<Turn & { mode: 'provider' | 'demo' }>('/api/assistant/turn', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paperId: paper.id, page: activeParagraph.page, passage: activeParagraph.text, learnerAttempt: attempt, action, question }),
      });
      setTurns(existing => [turn, ...existing]);
      if (turn.mode === 'demo') setMessage('当前为演示模式。连接 AI 供应商后可获得针对原文的逐句反馈。');
    } catch (error) { setMessage((error as Error).message); }
    finally { setLoadingAction(null); }
  }
  async function saveNote() {
    if (!paper || !activeParagraph) return;
    try {
      const note = await api<Note>(`/api/papers/${paper.id}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId: savedNote?.id, page: activePage, passage: activeParagraph.text, firstAttempt: attempt, revisedUnderstanding: revised, uncertainty, stageId: savedNote?.stageId || studyStage }),
      });
      setNotes(existing => savedNote ? existing.map(item => item.id === note.id ? note : item) : [note, ...existing]);
      void reloadAllNotes();
      setMessage('学习记录已保存。');
    } catch (error) { setMessage((error as Error).message); }
  }
  async function saveAIAnswer(turn: Turn) {
    if (!paper) return;
    try {
      const note = await api<Note>(`/api/papers/${paper.id}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: turn.page, passage: turn.passage, kind: 'ai', aiAnswer: turn.answer, revisedUnderstanding: '', firstAttempt: '' }),
      });
      setNotes(existing => [note, ...existing.filter(item => item.id !== note.id)]);
      void reloadAllNotes();
      setMessage('AI 回答已收藏到这篇文献的笔记。');
    } catch (error) { setMessage((error as Error).message); }
  }
  async function saveAITranslation(answer: string, targetLanguage: string) {
    if (!paper || !activeParagraph) return;
    try {
      const note = await api<Note>(`/api/papers/${paper.id}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: activeParagraph.page, passage: activeParagraph.text, kind: 'ai', aiAnswer: `### AI 翻译（${targetLanguage}）\n\n${answer}`, revisedUnderstanding: '', firstAttempt: '' }),
      });
      setNotes(existing => [note, ...existing.filter(item => item.id !== note.id)]);
      void reloadAllNotes();
      setMessage('AI 译文已收藏到这篇文献的笔记。');
    } catch (error) { setMessage((error as Error).message); }
  }
  async function markParagraph(color: Note['highlightColor'] = 'yellow') {
    if (!paper || !activeParagraph) return;
    if (notes.some(note => note.kind === 'highlight' && note.page === activeParagraph.page && note.passage === activeParagraph.text)) { setMessage('这段原文已经标注，可在笔记中找到。'); return; }
    try {
      const note = await api<Note>(`/api/papers/${paper.id}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: activeParagraph.page, passage: activeParagraph.text, kind: 'highlight', highlightColor: color, firstAttempt: '', revisedUnderstanding: '' }),
      });
      setNotes(existing => [note, ...existing.filter(item => item.id !== note.id)]);
      void reloadAllNotes();
      setMessage('原文重点已标注，可在这篇文献的笔记中回看。');
    } catch (error) { setMessage((error as Error).message); }
  }
  async function saveGlossaryTerm(turn: Turn) {
    if (!paper) return;
    try {
      const term = await api<GlossaryTerm>(`/api/papers/${paper.id}/terms`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term: turn.passage, meaning: turn.answer, passage: turn.passage, page: turn.page }),
      });
      setTerms(current => [term, ...current.filter(item => item.id !== term.id)]);
      void reloadAllTerms();
      setMessage(`已将“${term.term}”保存到本篇论文的术语卡。`);
    } catch (error) { setMessage((error as Error).message); }
  }
  async function deleteGlossaryTerm(term: GlossaryTerm) {
    await api(`/api/terms/${term.id}`, { method: 'DELETE' });
    setTerms(current => current.filter(item => item.id !== term.id));
    void reloadAllTerms();
  }
  async function deleteNote(note: Note) {
    await api(`/api/notes/${note.id}`, { method: 'DELETE' });
    setNotes(existing => existing.filter(item => item.id !== note.id));
    void reloadAllNotes();
  }
  async function addGroup() {
    const name = window.prompt('新分组名称');
    if (!name?.trim()) return;
    try {
      const group = await api<PaperGroup>('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      await reloadGroups(); setGroupFilter(group.id); setMessage(`已创建分组「${group.name}」。`);
    } catch (error) { setMessage((error as Error).message); }
  }
  async function renameGroup(group: PaperGroup) {
    const name = window.prompt('修改分组名称', group.name);
    if (!name?.trim() || name.trim() === group.name) return;
    try {
      await api(`/api/groups/${group.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      await reloadGroups(); setMessage('分组名称已更新。');
    } catch (error) { setMessage((error as Error).message); }
  }
  async function removeGroup(group: PaperGroup) {
    if (!window.confirm(`删除分组「${group.name}」？组内文献会移到“未分组”，文献和笔记不会删除。`)) return;
    try {
      await api(`/api/groups/${group.id}`, { method: 'DELETE' });
      if (groupFilter === group.id) setGroupFilter('all');
      await Promise.all([reloadGroups(), reloadPapers()]); setMessage('分组已删除，文献已移到未分组。');
    } catch (error) { setMessage((error as Error).message); }
  }
  async function movePaperToGroup(paperId: string, groupId: string | null) {
    try {
      await api(`/api/papers/${paperId}/group`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupId }) });
      await Promise.all([reloadPapers(), reloadGroups()]); setMessage('文献分组已更新。');
    } catch (error) { setMessage((error as Error).message); }
  }
  async function deletePaper(item: Paper) {
    if (!window.confirm(`删除《${item.title}》？原 PDF 和这篇文献关联的笔记都会从本机移除。`)) return;
    try {
      await api(`/api/papers/${item.id}`, { method: 'DELETE' });
      const remaining = await reloadPapers();
      await Promise.all([reloadGroups(), reloadAllNotes()]);
      if (paper?.id === item.id) {
        setPaper(null); setParagraphs([]); setActiveParagraph(null); setNotes([]); setTurns([]);
        if (remaining[0]) void openPaper(remaining[0].id);
      }
      setMessage('文献及其本机学习记录已删除。');
    } catch (error) { setMessage((error as Error).message); }
  }
  async function openNote(note: Note) {
    const opened = await openPaper(note.paperId);
    if (!opened) return;
    const target = makeParagraphs(opened).find(p => p.page === note.page && (p.text === note.passage || p.text.includes(note.passage) || note.passage.includes(p.text.slice(0, 48))));
    if (target) { setActiveParagraph({ ...target, text: note.passage }); setCurrentPage(target.page); }
    setAttempt(note.firstAttempt); setRevised(note.revisedUnderstanding); setUncertainty(note.uncertainty || ''); if (note.stageId) setStudyStage(note.stageId); setAssistantTab('tutor'); setReaderMode('text');
    if (note.kind === 'ai') setTurns([{ id: `saved-${note.id}`, page: note.page, action: 'explain', passage: note.passage, answer: note.aiAnswer || note.revisedUnderstanding, createdAt: note.createdAt, provider: '已收藏的 AI 回答' }]);
  }
  async function openTerm(term: GlossaryTerm) {
    const opened = await openPaper(term.paperId);
    if (!opened) return;
    const target = makeParagraphs(opened).find(p => p.page === term.page && (p.text.toLowerCase().includes(term.term.toLowerCase()) || p.text.includes(term.passage.slice(0, 32))));
    if (target) { setActiveParagraph({ ...target, text: term.passage }); setCurrentPage(target.page); setReaderMode('text'); }
    else { setActiveParagraph(null); setCurrentPage(term.page); setReaderMode('pdf'); }
    setAssistantTab('tutor');
  }
  async function chooseProvider(providerId: string | null) {
    try {
      await api('/api/providers/active', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId }) });
      setActiveProviderId(providerId);
    } catch (error) { setMessage((error as Error).message); }
  }
  function selectText() {
    const selection = window.getSelection()?.toString().trim();
    if (selection && selection.length > 2 && selection.length < 12_000) {
      const containing = paragraphs.find(p => p.text.includes(selection.slice(0, Math.min(50, selection.length))));
      if (containing) { setActiveParagraph({ ...containing, text: selection }); setCurrentPage(containing.page); setAttempt(''); setRevised(''); setUncertainty(''); }
    }
  }

  const activeSection = currentRawPage?.text.match(/\b(Abstract|Introduction|Method|Participants|Procedures|Measures|Results|Discussion|Limitations|References)\b/i)?.[0] || 'Introduction';
  const renderResponseCard = (turn: Turn, compact = false) => <div className={`response-card ${turn.mode === 'demo' ? 'demo-response' : ''} ${compact ? 'response-card-compact' : ''}`} key={turn.id}><div className="response-heading"><span className="ai-badge"><Sparkles size={12} />{turn.action === 'hint' ? '学习提示' : turn.action === 'explain' ? '句子拆解 / 术语解释' : '理解核对'}</span><span className="source-citation"><FileText size={12} />第 {turn.page} 页{compact ? '' : ' · 当前段落'}</span></div><div className="response-copy"><MarkdownContent>{turn.answer}</MarkdownContent></div><div className="response-foot"><span>{turn.provider}</span><button disabled={notes.some(note => note.kind === 'ai' && note.paperId === paper?.id && note.page === turn.page && note.aiAnswer === turn.answer)} onClick={() => void saveAIAnswer(turn)}><Save size={12} />{notes.some(note => note.kind === 'ai' && note.paperId === paper?.id && note.page === turn.page && note.aiAnswer === turn.answer) ? '已收藏' : '收藏 AI 回答'}</button>{turn.action === 'explain' && turn.mode === 'provider' && turn.passage.length <= 120 && turn.passage.split(/\s+/).length <= 8 && <button disabled={terms.some(term => term.paperId === paper?.id && term.term.toLowerCase() === turn.passage.toLowerCase())} onClick={() => void saveGlossaryTerm(turn)}><Save size={12} />存为术语卡</button>}<button onClick={() => { setRevised(revised || attempt); revisionRef.current?.focus(); }}><ArrowDown size={12} />写下修订理解</button></div></div>;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => { setStandaloneNotes(false); setLibraryOpen(false); }} aria-label="返回溯页精读工作区"><span className="brand-mark"><BrandMark size={29} /></span><span className="brand-wordmark"><strong>溯页</strong><small>论文精读</small></span></button>
        <nav className="topnav" aria-label="主导航">
          <button className={libraryOpen ? 'nav-item active' : 'nav-item'} onClick={() => { setStandaloneNotes(false); setLibraryOpen(!libraryOpen); }}><Library size={15} /> 我的论文</button>
          <button className={!libraryOpen && !standaloneNotes ? 'nav-item active' : 'nav-item'} onClick={() => { setStandaloneNotes(false); setLibraryOpen(false); setAssistantCollapsed(false); setMobileFocus('reader'); setAssistantTab('tutor'); }}><BookOpen size={15} /> 精读工作区</button>
          <button className={standaloneNotes ? 'nav-item active' : 'nav-item'} onClick={() => { setLibraryOpen(false); setStandaloneNotes(true); void Promise.all([reloadAllNotes(), reloadAllTerms()]); }}><FileText size={15} /> 学习笔记</button>
        </nav>
        <div className="top-actions">
          {paper && <div className="provider-menu-anchor"><button className="provider-quick" onClick={() => setProviderMenuOpen(!providerMenuOpen)}><span className={`status-dot ${activeProviderId ? 'connected' : ''}`} />{providers.find(p => p.id === activeProviderId)?.name || '演示模式'}<ChevronDown size={13} /></button>{providerMenuOpen && <div className="provider-menu"><span className="eyebrow">AI PROVIDER</span><button className={!activeProviderId ? 'provider-menu-option current' : 'provider-menu-option'} onClick={() => { void chooseProvider(null); setProviderMenuOpen(false); }}><span className={`status-dot ${!activeProviderId ? 'connected' : ''}`} />演示模式 {!activeProviderId && <Check size={13} />}</button>{providers.map(provider => <button key={provider.id} className={activeProviderId === provider.id ? 'provider-menu-option current' : 'provider-menu-option'} onClick={() => { void chooseProvider(provider.id); setProviderMenuOpen(false); }}><span className={`status-dot ${activeProviderId === provider.id ? 'connected' : ''}`} />{provider.name}<small>{provider.model}</small>{activeProviderId === provider.id && <Check size={13} />}</button>)}<button className="provider-menu-settings" onClick={() => { setProviderMenuOpen(false); setSettingsOpen(true); }}><Settings2 size={13} />管理供应商</button></div>}</div>}
          <button className="icon-button mobile-notes-nav" title="学习笔记" onClick={() => { setLibraryOpen(false); setStandaloneNotes(true); void Promise.all([reloadAllNotes(), reloadAllTerms()]); }}><FileText size={17} /></button>
          <button className="icon-button" title="搜索论文" onClick={() => { setStandaloneNotes(false); setLibraryOpen(true); }}><Search size={17} /></button>
          <button className="icon-button" title="AI 供应商设置" onClick={() => setSettingsOpen(true)}><Settings2 size={18} /></button>
          <div className="avatar">Z</div>
        </div>
      </header>

      {libraryOpen && <div className="library-backdrop"><aside className="library-manager">
        <header className="library-manager-header"><div><span className="eyebrow">PAPER LIBRARY</span><h2>我的论文</h2><p>按主题整理文献，笔记始终归属于对应论文。</p></div><button className="icon-button" title="返回精读工作区" onClick={() => setLibraryOpen(false)}><X size={18} /></button></header>
        <div className="library-manager-body"><nav className="group-sidebar"><span className="group-sidebar-label">文献分组</span>
          <button className={`group-nav-item ${groupFilter === 'all' ? 'selected' : ''}`} onClick={() => setGroupFilter('all')}><Library size={15} /><span>全部文献</span><b>{papers.length}</b></button>
          <button className={`group-nav-item ${groupFilter === 'ungrouped' ? 'selected' : ''}`} onClick={() => setGroupFilter('ungrouped')}><Folder size={15} /><span>未分组</span><b>{papers.filter(item => !item.groupId).length}</b></button>
          <div className="group-divider" />
          {groups.map(group => <div className={`group-nav-row ${groupFilter === group.id ? 'selected' : ''}`} key={group.id}><button className="group-nav-item" onClick={() => setGroupFilter(group.id)}><FolderOpen size={15} /><span>{group.name}</span><b>{group.paperCount}</b></button><div className="group-row-actions"><button title="重命名分组" onClick={() => void renameGroup(group)}>···</button><button title="删除分组" onClick={() => void removeGroup(group)}><Trash2 size={12} /></button></div></div>)}
          <button className="create-group-button" onClick={() => void addGroup()}><FolderPlus size={15} />新建分组</button>
        </nav>
        <section className="library-main"><div className="library-main-toolbar"><div><span className="eyebrow">{groupFilter === 'all' ? 'ALL PAPERS' : groupFilter === 'ungrouped' ? 'UNGROUPED' : 'COLLECTION'}</span><h3>{groupFilter === 'all' ? '全部文献' : groupFilter === 'ungrouped' ? '未分组文献' : groups.find(group => group.id === groupFilter)?.name || '文献分组'}</h3></div><button className="primary-button library-import" onClick={() => fileRef.current?.click()} disabled={uploading}><Upload size={14} />{uploading ? '正在导入…' : '导入 PDF'}</button></div>
          <label className="search-box"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索标题或文件名" /></label>
          <div className="library-main-list">{visiblePapers.map(item => <article key={item.id} className={`library-record ${paper?.id === item.id ? 'selected' : ''}`}><button className="library-record-open" onClick={() => void openPaper(item.id)}><span className="pdf-icon"><FileText size={18} /></span><span className="library-paper-text"><strong>{item.title}</strong><small>{item.filename} · {item.pageCount} 页 · {item.noteCount || 0} 条笔记</small></span>{paper?.id === item.id && <span className="record-current"><Check size={12} />正在阅读</span>}</button><div className="library-record-actions"><SelectMenu className="group-picker" label={`移动《${item.title}》到分组`} value={item.groupId || ''} options={[{ value: '', label: '未分组' }, ...groups.map(group => ({ value: group.id, label: group.name }))]} onChange={groupId => void movePaperToGroup(item.id, groupId || null)} leadingIcon={<Folder size={15} />} /><button className="delete-paper-button" onClick={() => void deletePaper(item)} title="删除文献及其笔记"><Trash2 size={14} />删除</button></div></article>)}{visiblePapers.length === 0 && <div className="library-empty"><div className="welcome-icon"><Library size={20} /></div><strong>{query ? '没有找到匹配的文献' : '这个分组还没有文献'}</strong><p>导入 PDF，或者把文献移动到这个分组。</p><button className="subtle-button" onClick={() => fileRef.current?.click()}><Plus size={14} />导入 PDF</button></div>}</div>
        </section></div>
      </aside></div>}
      <input ref={fileRef} className="visually-hidden" type="file" accept="application/pdf,.pdf" onChange={e => void uploadFile(e.target.files?.[0])} />

      {standaloneNotes ? <main className="standalone-notes-page"><header className="standalone-page-header"><div><span className="eyebrow">YOUR READING NOTES</span><h1>学习笔记</h1><p>按文献整理你的理解、AI 收藏和原文重点。</p></div><button className="standalone-back-button" onClick={() => { setStandaloneNotes(false); setAssistantTab('tutor'); setMobileFocus('reader'); }}><ChevronLeft size={16} />返回精读工作区</button></header><StudyNotesPanel papers={papers} notes={allNotes} terms={allTerms} onOpenPaper={id => { setStandaloneNotes(false); void openPaper(id); }} onOpenNote={note => { setStandaloneNotes(false); void openNote(note); }} onDeleteNote={note => { void deleteNote(note); }} onOpenTerm={term => { setStandaloneNotes(false); void openTerm(term); }} onDeleteTerm={term => { void deleteGlossaryTerm(term); }} /></main> : <main className={`workspace ${assistantCollapsed ? 'assistant-collapsed' : ''} mobile-focus-${mobileFocus}`}>
        <nav className="mobile-workspace-switch" aria-label="工作区视图"><button className={mobileFocus === 'reader' ? 'active' : ''} onClick={() => setMobileFocus('reader')}><BookOpen size={15} />原文阅读</button><button className={mobileFocus === 'assistant' ? 'active' : ''} onClick={() => { setAssistantCollapsed(false); setMobileFocus('assistant'); }}><Sparkles size={15} />学习助手</button></nav>
        <section className="reader-pane">
          {paper ? <>
            <div className="breadcrumb"><button onClick={() => setLibraryOpen(true)}>我的论文</button><ChevronRight size={13} /><span className="crumb-section">{activeSection}</span><ChevronRight size={13} /><span className="crumb-title">{paper.title}</span><span className="page-indicator">p. {activePage} / {paper.pageCount}</span></div>
            <div className="reader-toolbar"><div className="paper-meta"><span className="journal-tag">RESEARCH ARTICLE</span><span>{paper.pageCount} 页 · 原文图表可查看</span></div><div className="reader-tools">{assistantCollapsed && <button className="reader-tool-button" onClick={() => { setAssistantCollapsed(false); setMobileFocus('assistant'); }} title="展开学习助手"><PanelRightOpen size={14} />学习助手</button>}<div className="reader-mode-switch"><button className={readerMode === 'text' ? 'active' : ''} onClick={() => setReaderMode('text')}>文字精读</button><button className={readerMode === 'pdf' ? 'active' : ''} onClick={() => setReaderMode('pdf')}>PDF 原页</button></div><div className="reader-settings-anchor"><button className="reader-tool-button" aria-expanded={readerSettingsOpen} onClick={() => setReaderSettingsOpen(value => !value)} title="调整正文显示"><SlidersHorizontal size={14} />阅读设置</button>{readerSettingsOpen && <div className="reader-settings-popover"><div className="reader-settings-title"><strong>阅读设置</strong><button aria-label="关闭阅读设置" onClick={() => setReaderSettingsOpen(false)}><X size={14} /></button></div><label className="reader-size-setting"><span>字号 <b>{readerFontSize}px</b></span><div><button aria-label="减小字号" onClick={() => setReaderFontSize(value => Math.max(14, value - 1))}>A−</button><input type="range" min="14" max="24" step="1" value={readerFontSize} onChange={event => setReaderFontSize(Number(event.target.value))} aria-label="正文大小" /><button aria-label="增大字号" onClick={() => setReaderFontSize(value => Math.min(24, value + 1))}>A+</button></div></label><label className="reader-select-setting"><span>字体</span><SelectMenu className="reader-select-menu" label="正文字体" value={readerFont} options={[{ value: 'serif', label: '衬线体 · 适合长文' }, { value: 'sans', label: '无衬线体 · 清晰简洁' }]} onChange={value => setReaderFont(value as 'serif' | 'sans')} /></label><label className="reader-select-setting"><span>行距</span><SelectMenu className="reader-select-menu" label="正文行距" value={String(readerLineHeight)} options={[{ value: '1.6', label: '紧凑' }, { value: '1.8', label: '舒适' }, { value: '2', label: '宽松' }]} onChange={value => setReaderLineHeight(Number(value))} /></label></div>}</div><button className="reader-tool-button" onClick={openFigureStudy} title="在助手栏打开图表精读"><BarChart3 size={15} />图表精读</button></div></div>
            {readerMode === 'text' ? <article className={`paper-page paper-font-${readerFont}`} style={{ '--reader-font-size': `${readerFontSize}px`, '--reader-line-height': readerLineHeight } as React.CSSProperties} onMouseUp={selectText}>
              <div className="paper-topline"><span>{paper.filename}</span><span>p. {activePage}</span></div>
              {currentPageIndex === 0 && <h1 className="paper-title">{paper.title}</h1>}
              {currentPageIndex === 0 && paper.author && <p className="paper-authors">{paper.author}</p>}
              {currentPageIndex === 0 && <div className="first-page-label">从英文原文开始 · 选择段落查看学习提示</div>}
              {pageParagraphs.length ? pageParagraphs.map((paragraph, index) => { const marked = notes.find(note => note.kind === 'highlight' && note.page === paragraph.page && (note.passage === paragraph.text || paragraph.text.includes(note.passage))); const paint = (text: string) => { if (!marked?.passage || !text.includes(marked.passage)) return text; const start = text.indexOf(marked.passage); return <>{text.slice(0, start)}<mark className={`paper-mark paper-mark-${marked.highlightColor || 'yellow'}`}>{marked.passage}</mark>{text.slice(start + marked.passage.length)}</>; }; return <p key={paragraph.id} data-paragraph-id={paragraph.id} onClick={() => { if (!window.getSelection()?.toString().trim()) selectParagraph(paragraph); }} className={`paper-paragraph ${activeParagraph?.id === paragraph.id ? 'paragraph-active' : ''}`}><span className="paragraph-index">{String(index + 1).padStart(2, '0')}</span>{paint(paragraph.text)}</p>; }) : <div className="page-empty"><FileText size={23} /><p>这页没有提取到可读文本。</p><small>如果 PDF 是扫描件，需要先进行 OCR。</small></div>}
              <div className="page-footer"><span>溯页 · 原文阅读</span><span>{activePage}</span></div>
            </article> : <div className="paper-pdf-scroll"><Suspense fallback={<div className="pdf-loading"><LoaderCircle className="spin" size={19} />正在载入 PDF 阅读器…</div>}><PdfPageViewer file={apiUrl(`/api/papers/${paper.id}/file`)} pageNumber={activePage} /></Suspense></div>}
            <div className="reader-footer"><div className="reading-progress"><span>学习进度</span><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><b>{progress}%</b></div><div className="page-controls"><button className="page-button" disabled={activePage <= 1} onClick={() => navigatePage(activePage - 1)}><ChevronLeft size={15} />上一页</button><span>{activePage} / {paper.pageCount}</span><button className="page-button" disabled={activePage >= paper.pageCount} onClick={() => navigatePage(activePage + 1)}>下一页<ChevronRight size={15} /></button></div></div>
          </> : <div className="welcome-reader"><div className="welcome-icon"><BookOpen size={25} /></div><span className="eyebrow">READ WITH INTENTION</span><h1>把论文读懂，<br /><em>而不是读完。</em></h1><p>导入一篇英文论文，从原文开始。先写下你的理解，再用 AI 提示逐步核对。</p><button className="primary-button" onClick={() => fileRef.current?.click()} disabled={uploading}><Upload size={16} />{uploading ? '正在解析论文…' : '导入第一篇论文'}</button><div className="feature-row"><span><Check size={14} /> 原文优先</span><span><Check size={14} /> 可核对页码</span><span><Check size={14} /> 笔记本地保存</span></div></div>}
        </section>

        <aside className={`tutor-pane ${assistantTab === 'tutor' && assistantMode === 'chat' ? 'chat-mode-active' : ''}`}>
          <div className={`tutor-nav-row ${assistantTab === 'tutor' && assistantMode === 'chat' ? 'chat-nav-row' : ''}`}><SelectMenu className="assistant-master-picker" label="切换学习功能" value={assistantTab === 'tutor' ? `tutor:${assistantMode}` : assistantTab} options={[{ value: 'tutor:tutor', label: '论文精读' }, { value: 'tutor:chat', label: '通用对话' }, { value: 'tutor:translate', label: 'AI 翻译' }, { value: 'roadmap', label: '论文主线' }, { value: 'figures', label: '图表精读' }, { value: 'notes', label: `我的笔记 · ${allNotes.length}`}]} onChange={changeAssistantView} leadingIcon={assistantTab === 'roadmap' ? <BookOpen size={16} /> : assistantTab === 'figures' ? <BarChart3 size={16} /> : assistantTab === 'notes' ? <FileText size={16} /> : assistantMode === 'chat' ? <MessageCircle size={16} /> : assistantMode === 'translate' ? <Languages size={16} /> : <Sparkles size={16} />} />{assistantTab === 'tutor' && assistantMode === 'chat' && <div className="chat-toolbar-actions-slot" ref={chatToolbarActionsRef} />}<button className="tutor-collapse-button" title="收起学习助手" aria-label="收起学习助手" onClick={() => { setAssistantCollapsed(true); setMobileFocus('reader'); }}><PanelRightClose size={16} /></button></div>
          {assistantTab === 'tutor' ? <div className="tutor-content">
            {assistantMode === 'chat' ? <AssistantChatPanel paperId={paper?.id || null} paperTitle={paper?.title} paperPageCount={paper?.pageCount} onOpenCitation={openChatCitation} actionsTarget={chatToolbarActionsTarget} /> : assistantMode === 'translate' ? <AssistantTranslatePanel paperId={paper?.id || null} page={activeParagraph?.page || activePage} passage={activeParagraph?.text || ''} onSave={saveAITranslation} /> : !paper ? <div className="tutor-empty"><div className="tutor-empty-icon"><Sparkles size={18} /></div><h3>从一段原文开始</h3><p>导入论文后，选中左侧段落。你可以先复述，再请求提示、句子拆解或理解核对。</p><div className="empty-steps"><span><b>01</b>读原文</span><span><b>02</b>写理解</span><span><b>03</b>再问 AI</span></div><button className="subtle-button" onClick={() => fileRef.current?.click()}><Plus size={15} /> 导入一篇论文</button></div> : !activeParagraph ? <div className="tutor-empty"><h3>本页没有可选段落</h3><p>换到有文本的页面，或检查这是不是扫描版 PDF。</p></div> : <>
              <div className="selection-card"><div className="selection-label"><span>当前段落</span><span>第 {activePage} 页 · {activeIndex + 1}/{paragraphs.length}</span></div><p>“{snippet(activeParagraph.text)}{activeParagraph.text.length > 110 ? '…' : ''}”</p><div className="selection-actions"><AppButton variant="text" onClick={returnToOriginal}>回到原文 <ArrowRight size={15} /></AppButton><AppButton variant="soft" onClick={() => void markParagraph()}><Highlighter size={15} />重点标注</AppButton></div></div>
              <div className="attempt-card"><div className="field-label"><span>我的理解</span><span className="optional-tag">先试着写</span></div><textarea ref={textAreaRef} value={attempt} onChange={e => setAttempt(e.target.value)} placeholder="这段主要在说……作者这样写是为了……" rows={4} /><div className="field-foot"><span>用你自己的话，不需要完美</span><span>{attempt.length}/1000</span></div></div>
              <div className="action-row"><button className="tutor-action" disabled={!activeParagraph || loadingAction !== null} onClick={() => void askTutor('hint')}><CircleHelp size={15} />给我提示</button><button className="tutor-action" disabled={!activeParagraph || loadingAction !== null} onClick={() => void askTutor('explain')}><MessageCircle size={15} />拆解句子</button><button className="tutor-action action-primary" disabled={!activeParagraph || !attempt.trim() || loadingAction !== null} onClick={() => void askTutor('check', studyQuestion || undefined)}><CheckCheck size={15} />核对理解</button></div>
              <div className="response-area">
                {loadingAction && <div className="loading-card"><LoaderCircle size={17} className="spin" /><span>{loadingAction === 'hint' ? '正在准备提示…' : loadingAction === 'explain' ? '正在拆解原文…' : '正在核对你的理解…'}</span></div>}
                {!loadingAction && activeTurns.length === 0 && <div className="response-placeholder"><div className="placeholder-icon"><Zap size={16} /></div><div><strong>先读这一段，再请 AI 补充</strong><p>这里只显示与当前原文段落对应的回答，方便你逐条回到出处核对。</p></div></div>}
                {!loadingAction && activeTurns.slice(0, 1).map(turn => renderResponseCard(turn))}
                {!loadingAction && activeTurns.length > 1 && <details className="response-history"><summary>查看这段的其他回答 <span>{activeTurns.length - 1}</span></summary><div>{activeTurns.slice(1).map(turn => renderResponseCard(turn, true))}</div></details>}
              </div>
              <div className="revision-card"><div className="field-label"><span>修订后的理解</span><span className="optional-tag">保存到笔记</span></div><textarea ref={revisionRef} value={revised} onChange={e => setRevised(e.target.value)} placeholder="现在你会怎样解释这段？和刚才相比，改了什么？" rows={3} /><details className="uncertainty-input"><summary>记下仍不确定的地方（可选）</summary><textarea value={uncertainty} onChange={e => setUncertainty(e.target.value)} placeholder="例如：我还不确定这个测量指标如何计算……" rows={2} /></details><div className="revision-actions"><button className="save-note" onClick={() => void saveNote()} disabled={!attempt.trim() && !revised.trim() && !uncertainty.trim()}><Save size={14} />{savedNote ? '更新学习记录' : '保存学习记录'}</button><span>{savedNote ? '已保存过' : '只有你可以查看'}</span></div></div>
              <div className="tutor-bottom-tip"><Clock3 size={13} />读懂比读快更重要 · 完成一段后再继续</div><div className="tutor-bottom-tip"><CircleHelp size={12} />使用已连接 AI 时，当前段落、页码和你的理解会发送到所选供应商</div>
            </>}
          </div> : assistantTab === 'roadmap' ? <StudyRoadmap paragraphs={paragraphs} activeStage={studyStage} onStageChange={stage => { setStudyStage(stage); setStudyQuestion(null); }} onSelectSource={selectRoadmapSource} onContinue={goal => { setStudyQuestion(goal); setAssistantTab('tutor'); requestAnimationFrame(() => textAreaRef.current?.focus()); }} /> : assistantTab === 'figures' ? <FigureStudyPanel references={figureReferences} selectedId={selectedFigureId} currentPage={activePage} onOpenReference={reference => openFigureReference(reference)} onAskTutor={askTutorAboutFigure} /> : <StudyNotesPanel papers={papers} notes={allNotes} terms={allTerms} onOpenPaper={id => { void openPaper(id); }} onOpenNote={note => { void openNote(note); }} onDeleteNote={note => { void deleteNote(note); }} onOpenTerm={term => { void openTerm(term); }} onDeleteTerm={term => { void deleteGlossaryTerm(term); }} />}
        </aside>
      </main>}
      {message && <div className={`toast ${message.includes('失败') || message.includes('不能') || message.includes('找不到') ? 'toast-error' : ''}`}><span>{message}</span><button onClick={() => setMessage('')}><X size={14} /></button></div>}
      {loadingPaper && <div className="loading-overlay"><LoaderCircle className="spin" size={24} /><span>正在打开论文…</span></div>}
      {settingsOpen && <ProviderSettings providers={providers} activeId={activeProviderId} onClose={() => setSettingsOpen(false)} onRefresh={reloadProviders} onSelect={chooseProvider} />}
    </div>
  );
}

const presets = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', protocol: 'responses' as const },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', protocol: 'chat-completions' as const },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', protocol: 'chat-completions' as const },
  { name: 'GrooRoute', baseUrl: 'https://grooroute.com', model: 'gpt-5.6-sol', protocol: 'responses' as const },
  { name: '自定义兼容服务', baseUrl: '', model: '', protocol: 'chat-completions' as const },
];

function ProviderSettings({ providers, activeId, onClose, onRefresh, onSelect }: { providers: Provider[]; activeId: string | null; onClose: () => void; onRefresh: () => Promise<void>; onSelect: (id: string | null) => Promise<void> }) {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [protocol, setProtocol] = useState<'chat-completions' | 'responses'>('chat-completions');
  const [apiKey, setApiKey] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [connectionPreview, setConnectionPreview] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  function preset(p: typeof presets[number]) { setName(p.name); setBaseUrl(p.baseUrl); setModel(p.model); setProtocol(p.protocol); setApiKey(''); setEditingId(null); setError(''); }
  function edit(p: Provider) {
    setName(p.name); setBaseUrl(p.baseUrl); setModel(p.model);
    const knownResponsesProvider = /(^|\.)grooroute\.com$/i.test(new URL(p.baseUrl).hostname);
    setProtocol(p.protocol || (knownResponsesProvider ? 'responses' : 'chat-completions'));
    setApiKey(''); setEditingId(p.id); setError(''); setSuccess('');
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setSuccess(''); setConnectionPreview('');
    try {
      await api('/api/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editingId, name, baseUrl, model, protocol, apiKey }) });
      await onRefresh(); setSuccess('供应商配置已保存。'); setEditingId(null); setName(''); setBaseUrl(''); setModel(''); setProtocol('chat-completions'); setApiKey('');
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!window.confirm('删除这个供应商配置？')) return;
    try { await api(`/api/providers/${id}`, { method: 'DELETE' }); await onRefresh(); setSuccess('供应商已删除。'); }
    catch (err) { setError((err as Error).message); }
  }
  async function test(id: string) {
    setTestingId(id); setError(''); setSuccess(''); setConnectionPreview('');
    try { const result = await api<{ preview: string }>(`/api/providers/${id}/test`, { method: 'POST' }); setSuccess('连接测试成功'); setConnectionPreview(result.preview); }
    catch (err) { setError((err as Error).message); }
    finally { setTestingId(null); }
  }

  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header className="modal-header"><div><span className="eyebrow">MODEL CONNECTIONS</span><h2 id="settings-title">AI 供应商设置</h2><p>选择现有配置，或添加一个 OpenAI 兼容接口。</p></div><button className="icon-button" onClick={onClose}><X size={18} /></button></header>
    <div className="settings-body"><div className="provider-section-title"><h3>已添加的供应商</h3><button className="demo-select" onClick={() => void onSelect(null)}><span className={`status-dot ${!activeId ? 'connected' : ''}`} />使用演示模式</button></div>
      {providers.length ? <div className="provider-list">{providers.map(provider => <div className={`provider-row ${activeId === provider.id ? 'provider-active' : ''}`} key={provider.id}><button className="provider-radio" disabled={!provider.hasApiKey} title={provider.hasApiKey ? '设为当前服务' : '请先编辑并填写 API Key'} onClick={() => void onSelect(provider.id)}>{activeId === provider.id && <i />}</button><div className="provider-info"><strong>{provider.name}<span className="provider-type">OpenAI 兼容</span></strong><small>{provider.model} · {provider.hasApiKey ? 'API Key 已保存' : '尚未设置 Key'}</small></div>{activeId === provider.id && <span className="active-label">当前使用</span>}<button className="text-button" onClick={() => edit(provider)}>编辑</button><button className="icon-button small danger" onClick={() => void remove(provider.id)} title="删除"><Trash2 size={14} /></button><button className="test-button" onClick={() => void test(provider.id)} disabled={testingId === provider.id || !provider.hasApiKey} title={!provider.hasApiKey ? '请先填写 API Key' : '测试连接'}>{testingId === provider.id ? <LoaderCircle className="spin" size={13} /> : <Zap size={13} />}测试</button></div>)}</div> : <div className="no-providers"><Sparkles size={15} /><span>还没有连接 AI 服务，可以先用演示模式体验阅读流程。</span></div>}
      <div className="add-provider-heading"><div><h3>{editingId ? '编辑供应商' : '添加供应商'}</h3><p>支持 Chat Completions 与 Responses API，可添加多个并随时切换。</p></div></div>
      <div className="preset-row">{presets.map(p => <button key={p.name} onClick={() => preset(p)} className={name === p.name ? 'preset-chip selected' : 'preset-chip'}>{p.name}</button>)}</div>
      <form className="provider-form" onSubmit={e => void save(e)}><label>显示名称<input required value={name} onChange={e => setName(e.target.value)} placeholder="例如：我的推理服务" /></label><label>兼容接口地址<input required type="url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" /></label><label>模型名称<input required value={model} onChange={e => setModel(e.target.value)} placeholder="填写服务商提供的模型 ID" /></label><label>接口协议<SelectMenu className="provider-select-menu" label="接口协议" value={protocol} options={[{ value: 'chat-completions', label: 'Chat Completions' }, { value: 'responses', label: 'Responses API' }]} onChange={value => setProtocol(value as 'chat-completions' | 'responses')} /><small className="key-format-note">按供应商的 API 文档选择；GrooRoute 使用 Responses API。</small></label><label><span className="provider-label-row"><span>API Key</span><span className="label-secondary">{editingId && providers.find(p => p.id === editingId)?.hasApiKey ? '留空则保留已保存的 Key' : '仅发送给你配置的服务端点'}</span></span><div className="secret-input"><input value={apiKey} onChange={e => setApiKey(e.target.value)} type={showKey ? 'text' : 'password'} placeholder={editingId && providers.find(p => p.id === editingId)?.hasApiKey ? '已保存；留空保持不变' : 'sk-…'} /><button type="button" onClick={() => setShowKey(!showKey)}>{showKey ? '隐藏' : '显示'}</button></div><small className="key-format-note">请粘贴服务商提供的原始 API Key（ASCII 字符）；不要粘贴错误提示或说明文字。</small></label>
        {error && <div className="form-message error-message">{error}</div>}{success && <div className="form-message success-message">{success}{connectionPreview && <MarkdownContent className="provider-preview-markdown">{connectionPreview}</MarkdownContent>}</div>}
        <div className="storage-note"><CircleHelp size={14} /><span>配置保存在本机的 <code>data/store.json</code>，API Key 未加密。仅将此服务绑定到可信的本机环境，并避免把配置文件提交到代码仓库。</span></div>
        <div className="form-actions">{editingId && <button className="cancel-button" type="button" onClick={() => { setEditingId(null); setName(''); setBaseUrl(''); setModel(''); setApiKey(''); }}>取消编辑</button>}<button className="primary-button save-provider" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}{editingId ? '保存修改' : '添加供应商'}</button></div>
      </form>
    </div></section></div>;
}

const rootWindow = window as Window & { paperBridgeRoot?: Root };
rootWindow.paperBridgeRoot ||= createRoot(document.getElementById('root')!);
rootWindow.paperBridgeRoot.render(<React.StrictMode><App /></React.StrictMode>);



