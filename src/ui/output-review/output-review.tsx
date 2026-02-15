import { h, render } from 'preact';
import { useState, useEffect } from 'preact/hooks';

// ============================================================
// Types (webview-isolated subset)
// ============================================================

interface WorkflowResult {
	status: string;
	finalDraft: string;
	citations: string[];
	kgUpdates: KGDelta[];
	evaluation: Evaluation | null;
	error?: string;
	nodesVisited: string[];
}

interface KGDelta {
	entityName: string;
	entityType: string;
	change: string;
	confidence: 'high' | 'medium' | 'low';
}

interface Evaluation {
	pass: boolean;
	score: number;
	format?: { pass: boolean; notes: string };
	beatCoverage?: { pass: boolean; coveredBeats: string[]; missedBeats: string[] };
	length?: { pass: boolean; wordCount: number; notes: string };
	tone?: { pass: boolean; notes: string };
	dialogue?: { pass: boolean; notes: string };
	suggestions?: string[];
}

type TabId = 'preview' | 'evaluation' | 'deltas' | 'citations';

declare const webviewApi: any;

// ============================================================
// Helpers
// ============================================================

function postMessage(type: string, payload?: any): Promise<any> {
	return webviewApi.postMessage({ type, payload });
}

// ============================================================
// Tab Bar
// ============================================================

function TabBar({ active, onChange }: { active: TabId; onChange: (t: TabId) => void }) {
	const tabs: { id: TabId; label: string }[] = [
		{ id: 'preview', label: 'Preview' },
		{ id: 'evaluation', label: 'Evaluation' },
		{ id: 'deltas', label: 'Canon Updates' },
		{ id: 'citations', label: 'Citations' },
	];

	return (
		<div class="or-tabs">
			{tabs.map((t) => (
				<button
					key={t.id}
					class={`or-tab ${active === t.id ? 'active' : ''}`}
					onClick={() => onChange(t.id)}
				>
					{t.label}
				</button>
			))}
		</div>
	);
}

// ============================================================
// Preview Tab
// ============================================================

function PreviewTab({ draft }: { draft: string }) {
	if (!draft) return <div class="or-empty">No draft available.</div>;
	return <pre class="or-draft">{draft}</pre>;
}

// ============================================================
// Evaluation Tab
// ============================================================

function EvaluationTab({ evaluation }: { evaluation: Evaluation | null }) {
	if (!evaluation) return <div class="or-empty">No evaluation data.</div>;

	const scoreColor = evaluation.score >= 70 ? 'var(--or-green)'
		: evaluation.score >= 40 ? 'var(--or-yellow)'
		: 'var(--or-red)';

	return (
		<div>
			<div class="or-eval-section">
				<h3>Overall</h3>
				<div class="or-eval-row">
					<span class="or-eval-label">Verdict</span>
					<span class={`or-badge ${evaluation.pass ? 'or-badge-pass' : 'or-badge-fail'}`}>
						{evaluation.pass ? 'PASS' : 'NEEDS WORK'}
					</span>
				</div>
				<div class="or-eval-row">
					<span class="or-eval-label">Score</span>
					<span style={{ fontWeight: 600 }}>{evaluation.score}/100</span>
				</div>
				<div class="or-score-bar">
					<div class="or-score-fill" style={{ width: `${evaluation.score}%`, background: scoreColor }} />
				</div>
			</div>

			{evaluation.format && (
				<div class="or-eval-section">
					<h3>Format</h3>
					<div class="or-eval-row">
						<span class="or-eval-label">Status</span>
						<span class={`or-badge ${evaluation.format.pass ? 'or-badge-pass' : 'or-badge-fail'}`}>
							{evaluation.format.pass ? 'Pass' : 'Fail'}
						</span>
					</div>
					{evaluation.format.notes && <p style={{ fontSize: '12px', color: 'var(--or-subtext)', marginTop: '4px' }}>{evaluation.format.notes}</p>}
				</div>
			)}

			{evaluation.beatCoverage && (
				<div class="or-eval-section">
					<h3>Beat Coverage</h3>
					<div class="or-eval-row">
						<span class="or-eval-label">Status</span>
						<span class={`or-badge ${evaluation.beatCoverage.pass ? 'or-badge-pass' : 'or-badge-fail'}`}>
							{evaluation.beatCoverage.pass ? 'Pass' : 'Fail'}
						</span>
					</div>
					{evaluation.beatCoverage.missedBeats && evaluation.beatCoverage.missedBeats.length > 0 && (
						<p style={{ fontSize: '12px', color: 'var(--or-red)', marginTop: '4px' }}>
							Missed: {evaluation.beatCoverage.missedBeats.join(', ')}
						</p>
					)}
				</div>
			)}

			{evaluation.tone && (
				<div class="or-eval-section">
					<h3>Tone</h3>
					<div class="or-eval-row">
						<span class="or-eval-label">Status</span>
						<span class={`or-badge ${evaluation.tone.pass ? 'or-badge-pass' : 'or-badge-fail'}`}>
							{evaluation.tone.pass ? 'Pass' : 'Fail'}
						</span>
					</div>
					{evaluation.tone.notes && <p style={{ fontSize: '12px', color: 'var(--or-subtext)', marginTop: '4px' }}>{evaluation.tone.notes}</p>}
				</div>
			)}

			{evaluation.dialogue && (
				<div class="or-eval-section">
					<h3>Dialogue</h3>
					<div class="or-eval-row">
						<span class="or-eval-label">Status</span>
						<span class={`or-badge ${evaluation.dialogue.pass ? 'or-badge-pass' : 'or-badge-fail'}`}>
							{evaluation.dialogue.pass ? 'Pass' : 'Fail'}
						</span>
					</div>
					{evaluation.dialogue.notes && <p style={{ fontSize: '12px', color: 'var(--or-subtext)', marginTop: '4px' }}>{evaluation.dialogue.notes}</p>}
				</div>
			)}

			{evaluation.length && (
				<div class="or-eval-section">
					<h3>Length</h3>
					<div class="or-eval-row">
						<span class="or-eval-label">Word Count</span>
						<span class="or-badge or-badge-info">{evaluation.length.wordCount}</span>
					</div>
					{evaluation.length.notes && <p style={{ fontSize: '12px', color: 'var(--or-subtext)', marginTop: '4px' }}>{evaluation.length.notes}</p>}
				</div>
			)}

			{evaluation.suggestions && evaluation.suggestions.length > 0 && (
				<div class="or-eval-section">
					<h3>Suggestions</h3>
					<ol class="or-suggestions">
						{evaluation.suggestions.map((s, i) => <li key={i}>{s}</li>)}
					</ol>
				</div>
			)}
		</div>
	);
}

// ============================================================
// KG Delta Review Tab
// ============================================================

interface DeltaTabProps {
	deltas: KGDelta[];
	accepted: Set<number>;
	onToggle: (idx: number) => void;
}

function DeltaTab({ deltas, accepted, onToggle }: DeltaTabProps) {
	if (!deltas || deltas.length === 0) {
		return <div class="or-empty">No canon updates proposed.</div>;
	}

	const confColor = (c: string) => {
		if (c === 'high') return 'var(--or-green)';
		if (c === 'medium') return 'var(--or-yellow)';
		return 'var(--or-red)';
	};

	return (
		<ul class="or-delta-list">
			{deltas.map((d, i) => (
				<li key={i} class="or-delta-item">
					<input
						type="checkbox"
						class="or-delta-check"
						checked={accepted.has(i)}
						onChange={() => onToggle(i)}
					/>
					<div class="or-delta-body">
						<span class="or-delta-entity">{d.entityName}</span>
						<span class="or-delta-type">{d.entityType}</span>
						<div class="or-delta-change">{d.change}</div>
						<div class="or-delta-confidence" style={{ color: confColor(d.confidence) }}>
							Confidence: {d.confidence}
						</div>
					</div>
				</li>
			))}
		</ul>
	);
}

// ============================================================
// Citations Tab
// ============================================================

function CitationsTab({ citations, nodesVisited }: { citations: string[]; nodesVisited: string[] }) {
	return (
		<div>
			{citations.length > 0 && (
				<div class="or-eval-section">
					<h3>Source Citations</h3>
					<ul class="or-citations">
						{citations.map((c, i) => <li key={i} class="or-citation">{c}</li>)}
					</ul>
				</div>
			)}
			{nodesVisited.length > 0 && (
				<div class="or-eval-section">
					<h3>Workflow Path</h3>
					<div class="or-nodes">
						{nodesVisited.map((n, i) => <span key={i} class="or-node-chip">{n}</span>)}
					</div>
				</div>
			)}
			{citations.length === 0 && nodesVisited.length === 0 && (
				<div class="or-empty">No citation data.</div>
			)}
		</div>
	);
}

// ============================================================
// Main App
// ============================================================

function OutputReviewApp() {
	const [result, setResult] = useState<WorkflowResult | null>(null);
	const [activeTab, setActiveTab] = useState<TabId>('preview');
	const [acceptedDeltas, setAcceptedDeltas] = useState<Set<number>>(new Set());
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		// Request the workflow result from the plugin backend
		postMessage('getState').then((data: any) => {
			if (data && data.workflowResult) {
				setResult(data.workflowResult);
				// Auto-accept high-confidence deltas
				if (data.workflowResult.kgUpdates) {
					const autoAccept = new Set<number>();
					data.workflowResult.kgUpdates.forEach((d: KGDelta, i: number) => {
						if (d.confidence === 'high') autoAccept.add(i);
					});
					setAcceptedDeltas(autoAccept);
				}
			}
		});
	}, []);

	const toggleDelta = (idx: number) => {
		setAcceptedDeltas((prev) => {
			const next = new Set(prev);
			if (next.has(idx)) next.delete(idx);
			else next.add(idx);
			return next;
		});
	};

	const handleInsert = async (mode: 'insert' | 'append' | 'new') => {
		if (!result) return;
		setSaving(true);
		await postMessage('insertToNote', {
			content: result.finalDraft,
			mode,
			title: 'FiRiter Scene Draft',
		});
		setSaving(false);
	};

	const handleApplyDeltas = async () => {
		if (!result) return;
		const deltasToApply = result.kgUpdates.filter((_, i) => acceptedDeltas.has(i));
		if (deltasToApply.length === 0) return;
		setSaving(true);
		await postMessage('kgMutate', {
			action: 'applyDeltas',
			payload: { deltas: deltasToApply },
		});
		setSaving(false);
	};

	const handleRegenerate = async () => {
		await postMessage('openOutputReview', { action: 'regenerate' });
	};

	if (!result) {
		return <div class="or-container"><div class="or-empty">Loading workflow result...</div></div>;
	}

	if (result.error && !result.finalDraft) {
		return (
			<div class="or-container">
				<div class="or-header">
					<h2>Workflow Error</h2>
				</div>
				<div class="or-main">
					<div style={{ padding: '24px', color: 'var(--or-red)' }}>
						<p style={{ fontWeight: 600 }}>The workflow encountered an error:</p>
						<pre style={{ marginTop: '8px', whiteSpace: 'pre-wrap' }}>{result.error}</pre>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div class="or-container">
			<div class="or-header">
				<h2>Output Review</h2>
				<TabBar active={activeTab} onChange={setActiveTab} />
			</div>

			<div class="or-body">
				<div class="or-main">
					{activeTab === 'preview' && <PreviewTab draft={result.finalDraft} />}
					{activeTab === 'evaluation' && <EvaluationTab evaluation={result.evaluation} />}
					{activeTab === 'deltas' && (
						<DeltaTab deltas={result.kgUpdates} accepted={acceptedDeltas} onToggle={toggleDelta} />
					)}
					{activeTab === 'citations' && (
						<CitationsTab citations={result.citations} nodesVisited={result.nodesVisited} />
					)}
				</div>
			</div>

			<div class="or-footer">
				<button class="or-btn or-btn-primary" onClick={() => handleInsert('new')} disabled={saving}>
					Save as New Note
				</button>
				<button class="or-btn or-btn-secondary" onClick={() => handleInsert('append')} disabled={saving}>
					Append to Current
				</button>
				<button class="or-btn or-btn-secondary" onClick={() => handleInsert('insert')} disabled={saving}>
					Insert at Cursor
				</button>

				{result.kgUpdates.length > 0 && acceptedDeltas.size > 0 && (
					<button class="or-btn or-btn-secondary" onClick={handleApplyDeltas} disabled={saving}>
						Apply {acceptedDeltas.size} Canon Updates
					</button>
				)}

				<span class="or-spacer" />

				<button class="or-btn or-btn-secondary" onClick={handleRegenerate}>
					Regenerate
				</button>
			</div>
		</div>
	);
}

// ============================================================
// Mount
// ============================================================

const root = document.getElementById('output-review-root');
if (root) {
	render(<OutputReviewApp />, root);
}
