import { useMemo } from 'react';
import { ArrowRight, BookOpenCheck, Check, Circle, FileText, Sparkles } from 'lucide-react';
import './study.css';

export type StudyStageId = 'background' | 'gap' | 'question' | 'method' | 'findings' | 'contribution';
export type StudySource = { id: string; page: number; text: string; section?: string };

const stages: Array<{ id: StudyStageId; title: string; goal: string; check: string; patterns: RegExp }> = [
  { id: 'background', title: '研究背景', goal: '作者在研究什么现象？为什么值得研究？', check: '这项研究关注的现象是什么，为什么重要？', patterns: /family conflict|adolescen|emotional arousal|emotional reactivity|family relationship/i },
  { id: 'gap', title: '已有不足', goal: '作者认为此前研究还没有解释什么？', check: '作者指出了什么尚未解决的问题？', patterns: /little attention|few studies|less is known|limited research|gap|remain unclear|not been|understudied|however/i },
  { id: 'question', title: '研究问题', goal: '作者具体想检验哪些变量之间的关系？', check: '作者想回答的核心问题是什么？', patterns: /current study|this study|we (exam|investigat|hypothes|propos)|aim(ed)? to|research question|hypothes/i },
  { id: 'method', title: '研究方法', goal: '弄清样本、冲突讨论情境、三类测量指标和分析方式。', check: '作者如何测量青少年的情绪唤起？研究中比较或关联了哪些指标？', patterns: /participant|sample|procedure|discussion|cortisol|fundamental frequency|self.report|measure|analysis|coded/i },
  { id: 'findings', title: '主要发现', goal: '区分每个指标的结果，以及它们之间的关联。', check: '数据直接显示了哪些关系？结果是否支持作者的判断？', patterns: /result|findings|significant|associated|association|higher|greater|variability|time.to.peak/i },
  { id: 'contribution', title: '贡献与局限', goal: '作者如何解释发现？结论适用范围有哪些限制？', check: '作者认为研究贡献是什么？有哪些局限或未解决的问题？', patterns: /implication|contribut|limitation|future|caution|suggest|discussion|generaliz/i },
];

export function studyQuestionFor(stageId: StudyStageId) {
  return stages.find(item => item.id === stageId)?.check || stages[0].check;
}

const methodItems = [
  { title: '研究对象与样本', pattern: /participant|sample|boy|girl|adolescent|recruit/i },
  { title: '研究情境与流程', pattern: /discussion|conflict|procedure|parent|task|session/i },
  { title: '测量指标', pattern: /fundamental frequency|cortisol|self.report|negative emotion|measure|rating/i },
  { title: '数据处理', pattern: /aggregate|coded|coding|time.to.peak|variability|data reduction/i },
  { title: '分析方法', pattern: /analysis|model|regression|correlat|predict|multilevel/i },
];

const excerpt = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 170);

export function StudyRoadmap({ paragraphs, activeStage, onStageChange, onSelectSource, onContinue }: {
  paragraphs: StudySource[];
  activeStage: StudyStageId;
  onStageChange: (stage: StudyStageId) => void;
  onSelectSource: (source: StudySource) => void;
  onContinue: (goal: string) => void;
}) {
  const stage = stages.find(item => item.id === activeStage) || stages[0];
  const evidence = useMemo(() => {
    const sectionFirst = stage.id === 'findings' ? paragraphs.filter(item => /results/i.test(item.section || ''))
      : stage.id === 'contribution' ? paragraphs.filter(item => /discussion|limitation|future/i.test(item.section || '')) : [];
    const matched = paragraphs.filter(item => stage.patterns.test(item.text));
    const prioritized = [...new Map([...sectionFirst, ...matched].map(item => [item.id, item])).values()];
    return prioritized.slice(0, 4);
  }, [paragraphs, stage]);
  const methods = useMemo(() => methodItems.map(item => ({
    ...item,
    source: paragraphs.find(paragraph => item.pattern.test(paragraph.text) && /method|participant|procedure|measure|analysis/i.test(paragraph.section || ''))
      || paragraphs.find(paragraph => item.pattern.test(paragraph.text)),
  })), [paragraphs]);
  const resultEvidence = useMemo(() => paragraphs.filter(item => /results/i.test(item.section || '') && /associated|significant|higher|greater|variability|cortisol|frequency|result/i.test(item.text)).slice(0, 3), [paragraphs]);
  const interpretationEvidence = useMemo(() => paragraphs.filter(item => /discussion|implication/i.test(item.section || '') && /suggest|interpret|implication|consistent|may|could|limitation|future/i.test(item.text)).slice(0, 2), [paragraphs]);

  return <div className="roadmap-content">
    <div className="roadmap-heading"><div><strong>论文主线</strong><span>从问题走到证据</span></div><span className="roadmap-current">{stages.findIndex(item => item.id === activeStage) + 1} / {stages.length}</span></div>
    <nav className="roadmap-stages" aria-label="论文主线阶段">
      {stages.map((item, index) => <button key={item.id} className={`roadmap-stage ${item.id === activeStage ? 'active' : ''}`} onClick={() => onStageChange(item.id)} aria-current={item.id === activeStage ? 'step' : undefined}>
        <span className="roadmap-stage-marker">{index < stages.findIndex(candidate => candidate.id === activeStage) ? <Check size={12} /> : <span>{index + 1}</span>}</span><span>{item.title}</span>
      </button>)}
    </nav>
    <section className="roadmap-focus">
      <div className="roadmap-focus-title"><BookOpenCheck size={16} /><div><span>当前要弄清</span><h3>{stage.goal}</h3></div></div>
      {activeStage === 'method' ? <div className="method-breakdown" aria-label="方法拆解">
        {methods.map(item => <div className="method-item" key={item.title}><span className="method-item-title">{item.title}</span>{item.source ? <button className="roadmap-evidence-link" onClick={() => onSelectSource(item.source!)}><FileText size={12} /><span>p. {item.source.page} · {excerpt(item.source.text)}</span><ArrowRight size={12} /></button> : <span className="method-not-found">尚未定位到文本证据</span>}</div>)}
      </div> : activeStage === 'findings' ? <div className="claim-evidence-breakdown">
        <div><h4>结果段落 · 数据显示</h4>{resultEvidence.length ? resultEvidence.map(item => <button key={item.id} className="roadmap-evidence-link" onClick={() => onSelectSource(item)}><FileText size={12} /><span>p. {item.page} · {excerpt(item.text)}</span><ArrowRight size={12} /></button>) : <p className="method-not-found">尚未定位到 Results 标题；可从下方原文线索核对。</p>}</div>
        <div><h4>讨论段落 · 作者解释</h4>{interpretationEvidence.length ? interpretationEvidence.map(item => <button key={item.id} className="roadmap-evidence-link" onClick={() => onSelectSource(item)}><FileText size={12} /><span>p. {item.page} · {excerpt(item.text)}</span><ArrowRight size={12} /></button>) : <p className="method-not-found">尚未定位到 Discussion 解释段落。</p>}</div>
        <p className="association-note">读结果时分别记录数据关系与作者解释。变量相关本身不等于因果关系。</p>
      </div> : <div className="roadmap-evidence-list">
        {evidence.length ? evidence.map(item => <button key={item.id} className="roadmap-evidence-link" onClick={() => onSelectSource(item)}><FileText size={12} /><span>p. {item.page} · {excerpt(item.text)}</span><ArrowRight size={12} /></button>) : <p className="roadmap-empty"><Circle size={12} />当前提取文本中没有找到明确线索，可在原文中选择相关段落继续。</p>}
      </div>}
      <button className="roadmap-continue" onClick={() => onContinue(stage.check)}><Sparkles size={14} />带着这个问题去理解核对</button>
    </section>
    <p className="roadmap-footnote">线索来自当前 PDF 的文本提取；点击页码回到原文自行核对。</p>
  </div>;
}
