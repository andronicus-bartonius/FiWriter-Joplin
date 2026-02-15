import { h, render } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';

// ============================================================
// Types (duplicated subset for webview isolation)
// ============================================================

interface KGEntity {
	id: string;
	type: string;
	scopeId: string;
	name: string;
	content: Record<string, any>;
	structuredFields: Record<string, any>;
	status: string;
	createdAt: string;
	updatedAt: string;
}

interface KGScope {
	id: string;
	parentScopeId: string | null;
	scopeType: string;
	name: string;
	metadata: Record<string, any>;
}

interface KGTag {
	id: string;
	entityId: string;
	tagName: string;
}

declare const webviewApi: {
	postMessage: (message: any) => Promise<any>;
	onMessage: (handler: (message: any) => void) => void;
};

const ENTITY_TYPES = ['Character', 'Location', 'Rule', 'Item', 'Arc', 'Relationship', 'Beat', 'Event', 'Thread'];
const STATUS_OPTIONS = ['draft', 'canon', 'needs-review', 'archived'];

// ============================================================
// API helpers
// ============================================================

async function kgQuery(action: string, payload: Record<string, any> = {}): Promise<any> {
	return webviewApi.postMessage({ type: 'kgQuery', payload: { action, ...payload } });
}

async function kgMutate(action: string, payload: Record<string, any> = {}): Promise<any> {
	return webviewApi.postMessage({ type: 'kgMutate', payload: { action, ...payload } });
}

// ============================================================
// EntityCard Component
// ============================================================

interface EntityCardProps {
	entity: KGEntity;
	selected: boolean;
	tags: KGTag[];
	onSelect: (id: string) => void;
	onDragStart: (e: DragEvent, id: string) => void;
}

function EntityCard({ entity, selected, tags, onSelect, onDragStart }: EntityCardProps) {
	const excerpt = getExcerpt(entity);

	return (
		<div
			class={`entity-card ${selected ? 'selected' : ''}`}
			data-type={entity.type}
			draggable
			onClick={() => onSelect(entity.id)}
			onDragStart={(e: any) => onDragStart(e, entity.id)}
		>
			<div class="card-header">
				<span class={`card-type-badge ${entity.type}`}>
					{entity.type.substring(0, 3)}
				</span>
				<span class="card-name">{entity.name}</span>
				<span class={`card-status ${entity.status}`}>{entity.status}</span>
			</div>
			{excerpt && <div class="card-excerpt">{excerpt}</div>}
			{tags.length > 0 && (
				<div class="card-tags">
					{tags.slice(0, 4).map((t) => (
						<span key={t.id} class="card-tag">{t.tagName}</span>
					))}
					{tags.length > 4 && <span class="card-tag">+{tags.length - 4}</span>}
				</div>
			)}
		</div>
	);
}

function getExcerpt(entity: KGEntity): string {
	const c: Record<string, any> = entity.content;
	if (c.description) return String(c.description).substring(0, 120);
	if (c.bio) return String(c.bio).substring(0, 120);
	if (c.content) return String(c.content).substring(0, 120);
	return '';
}

// ============================================================
// ScopeBreadcrumb Component
// ============================================================

interface ScopeBreadcrumbProps {
	scopeChain: KGScope[];
	currentScopeId: string;
	onNavigate: (scopeId: string) => void;
}

function ScopeBreadcrumb({ scopeChain, currentScopeId, onNavigate }: ScopeBreadcrumbProps) {
	return (
		<div class="scope-breadcrumb">
			{scopeChain.map((scope, i) => (
				<span key={scope.id} style={{ display: 'contents' }}>
					{i > 0 && <span class="scope-separator">›</span>}
					<button
						class={`scope-crumb ${scope.id === currentScopeId ? 'active' : ''}`}
						onClick={() => onNavigate(scope.id)}
					>
						{scope.name}
					</button>
				</span>
			))}
		</div>
	);
}

// ============================================================
// SearchFilterBar Component
// ============================================================

interface SearchFilterBarProps {
	searchQuery: string;
	onSearchChange: (q: string) => void;
	activeTypeFilter: string | null;
	onTypeFilterChange: (type: string | null) => void;
	activeStatusFilter: string | null;
	onStatusFilterChange: (status: string | null) => void;
}

function SearchFilterBar({
	searchQuery, onSearchChange,
	activeTypeFilter, onTypeFilterChange,
	activeStatusFilter, onStatusFilterChange,
}: SearchFilterBarProps) {
	return (
		<div class="sb-search">
			<input
				type="text"
				placeholder="Search entities..."
				value={searchQuery}
				onInput={(e: any) => onSearchChange(e.target.value)}
			/>
			{ENTITY_TYPES.map((type) => (
				<button
					key={type}
					class={`sb-filter-btn ${activeTypeFilter === type ? 'active' : ''}`}
					onClick={() => onTypeFilterChange(activeTypeFilter === type ? null : type)}
					title={type}
				>
					{type.substring(0, 3)}
				</button>
			))}
			<select
				value={activeStatusFilter || ''}
				onChange={(e: any) => onStatusFilterChange(e.target.value || null)}
				style={{ fontSize: '11px', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px', padding: '3px 4px' }}
			>
				<option value="">All statuses</option>
				{STATUS_OPTIONS.map((s) => (
					<option key={s} value={s}>{s}</option>
				))}
			</select>
		</div>
	);
}

// ============================================================
// CardInspector Component
// ============================================================

interface CardInspectorProps {
	entity: KGEntity | null;
	tags: KGTag[];
	onClose: () => void;
	onSave: (data: { id: string; updates: Record<string, any> }) => void;
	onDelete: (id: string) => void;
	onAddTag: (entityId: string, tagName: string) => void;
	onRemoveTag: (entityId: string, tagName: string) => void;
}

function CardInspector({ entity, tags, onClose, onSave, onDelete, onAddTag, onRemoveTag }: CardInspectorProps) {
	const [name, setName] = useState('');
	const [status, setStatus] = useState('draft');
	const [description, setDescription] = useState('');
	const [newTag, setNewTag] = useState('');

	useEffect(() => {
		if (entity) {
			setName(entity.name);
			setStatus(entity.status);
			setDescription(entity.content?.description || entity.content?.bio || entity.content?.content || '');
		}
	}, [entity?.id, entity?.updatedAt]);

	if (!entity) {
		return <div class="sb-inspector hidden" />;
	}

	const handleSave = () => {
		const content = { ...entity.content, description };
		onSave({ id: entity.id, updates: { name, status, content } });
	};

	const handleAddTag = () => {
		if (newTag.trim()) {
			onAddTag(entity.id, newTag.trim());
			setNewTag('');
		}
	};

	return (
		<div class="sb-inspector">
			<div class="inspector-header">
				<h3>Edit {entity.type}</h3>
				<button class="inspector-close" onClick={onClose}>✕</button>
			</div>
			<div class="inspector-body">
				<div class="inspector-field">
					<label>Name</label>
					<input type="text" value={name} onInput={(e: any) => setName(e.target.value)} />
				</div>
				<div class="inspector-field">
					<label>Type</label>
					<input type="text" value={entity.type} disabled />
				</div>
				<div class="inspector-field">
					<label>Status</label>
					<select value={status} onChange={(e: any) => setStatus(e.target.value)}>
						{STATUS_OPTIONS.map((s) => (
							<option key={s} value={s}>{s}</option>
						))}
					</select>
				</div>
				<div class="inspector-field">
					<label>Description / Content</label>
					<textarea
						rows={6}
						value={description}
						onInput={(e: any) => setDescription(e.target.value)}
					/>
				</div>
				<div class="inspector-field">
					<label>Tags</label>
					<div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
						{tags.map((t) => (
							<span key={t.id} class="card-tag" style={{ cursor: 'pointer' }} onClick={() => onRemoveTag(entity.id, t.tagName)}>
								{t.tagName} ✕
							</span>
						))}
					</div>
					<div style={{ display: 'flex', gap: '4px' }}>
						<input
							type="text"
							placeholder="Add tag..."
							value={newTag}
							onInput={(e: any) => setNewTag(e.target.value)}
							onKeyDown={(e: any) => { if (e.key === 'Enter') handleAddTag(); }}
							style={{ flex: 1 }}
						/>
						<button class="btn btn-sm btn-secondary" onClick={handleAddTag}>+</button>
					</div>
				</div>
				<div class="inspector-field">
					<label>Created</label>
					<span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{entity.createdAt}</span>
				</div>
			</div>
			<div class="inspector-actions">
				<button class="btn btn-primary" style={{ flex: 1 }} onClick={handleSave}>Save</button>
				<button class="btn btn-danger btn-sm" onClick={() => {
					if (confirm(`Delete "${entity.name}"?`)) onDelete(entity.id);
				}}>Delete</button>
			</div>
		</div>
	);
}

// ============================================================
// NewEntityForm Component
// ============================================================

interface NewEntityFormProps {
	scopeId: string;
	onCreated: () => void;
}

function NewEntityForm({ scopeId, onCreated }: NewEntityFormProps) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState('');
	const [type, setType] = useState('Character');

	const handleCreate = async () => {
		if (!name.trim()) return;
		await kgMutate('createEntity', {
			type,
			scopeId,
			name: name.trim(),
			content: {},
			structuredFields: {},
			status: 'draft',
		});
		setName('');
		setOpen(false);
		onCreated();
	};

	if (!open) {
		return <button class="btn btn-primary btn-sm" onClick={() => setOpen(true)}>+ New Entity</button>;
	}

	return (
		<div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
			<select value={type} onChange={(e: any) => setType(e.target.value)} style={{ fontSize: '11px', padding: '4px', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px' }}>
				{ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
			</select>
			<input
				type="text"
				placeholder="Entity name..."
				value={name}
				onInput={(e: any) => setName(e.target.value)}
				onKeyDown={(e: any) => { if (e.key === 'Enter') handleCreate(); }}
				style={{ fontSize: '12px', padding: '4px 8px', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px', width: '160px' }}
			/>
			<button class="btn btn-primary btn-sm" onClick={handleCreate}>Create</button>
			<button class="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>Cancel</button>
		</div>
	);
}

// ============================================================
// ScopeManager Component
// ============================================================

interface ScopeManagerProps {
	currentScope: KGScope | null;
	childScopes: KGScope[];
	onNavigate: (scopeId: string) => void;
	onCreateScope: (name: string, type: string) => void;
}

function ScopeManager({ currentScope, childScopes, onNavigate, onCreateScope }: ScopeManagerProps) {
	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState('');
	const [newType, setNewType] = useState('EPISODE');

	if (childScopes.length === 0 && !creating) {
		return (
			<div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' }}>
				<button class="btn btn-secondary btn-sm" onClick={() => setCreating(true)}>+ New Scope</button>
			</div>
		);
	}

	const nextScopeType = currentScope
		? currentScope.scopeType === 'WORLD' ? 'SEASON'
		: currentScope.scopeType === 'SEASON' ? 'EPISODE'
		: currentScope.scopeType === 'EPISODE' ? 'SCENE'
		: 'SCENE'
		: 'SEASON';

	return (
		<div style={{ marginBottom: '8px' }}>
			{childScopes.length > 0 && (
				<div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
					{childScopes.map((s) => (
						<button key={s.id} class="btn btn-secondary btn-sm" onClick={() => onNavigate(s.id)}>
							📂 {s.name}
						</button>
					))}
				</div>
			)}
			{creating ? (
				<div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
					<input
						type="text"
						placeholder={`New ${nextScopeType.toLowerCase()} name...`}
						value={newName}
						onInput={(e: any) => setNewName(e.target.value)}
						onKeyDown={(e: any) => {
							if (e.key === 'Enter' && newName.trim()) {
								onCreateScope(newName.trim(), nextScopeType);
								setNewName('');
								setCreating(false);
							}
						}}
						style={{ fontSize: '12px', padding: '4px 8px', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px', width: '160px' }}
					/>
					<button class="btn btn-primary btn-sm" onClick={() => {
						if (newName.trim()) {
							onCreateScope(newName.trim(), nextScopeType);
							setNewName('');
							setCreating(false);
						}
					}}>Create</button>
					<button class="btn btn-secondary btn-sm" onClick={() => setCreating(false)}>Cancel</button>
				</div>
			) : (
				<button class="btn btn-secondary btn-sm" onClick={() => setCreating(true)}>+ New Scope</button>
			)}
		</div>
	);
}

// ============================================================
// StoryboardApp (Root Component)
// ============================================================

function StoryboardApp() {
	const [scopes, setScopes] = useState<KGScope[]>([]);
	const [currentScopeId, setCurrentScopeId] = useState<string | null>(null);
	const [scopeChain, setScopeChain] = useState<KGScope[]>([]);
	const [childScopes, setChildScopes] = useState<KGScope[]>([]);
	const [entities, setEntities] = useState<KGEntity[]>([]);
	const [entityTags, setEntityTags] = useState<Record<string, KGTag[]>>({});
	const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState('');
	const [typeFilter, setTypeFilter] = useState<string | null>(null);
	const [statusFilter, setStatusFilter] = useState<string | null>(null);

	// Load root scope on mount
	useEffect(() => {
		loadRootScope();
	}, []);

	// Reload entities when scope/filters change
	useEffect(() => {
		if (currentScopeId) {
			loadEntities();
			loadChildScopes();
		}
	}, [currentScopeId, typeFilter, statusFilter]);

	const loadRootScope = async () => {
		const worldScopes = await kgQuery('listScopes', { scopeType: 'WORLD', parentScopeId: null });
		if (worldScopes && worldScopes.length > 0) {
			const root = worldScopes[0];
			setCurrentScopeId(root.id);
			setScopeChain([root]);
			setScopes(worldScopes);
		}
	};

	const loadEntities = async () => {
		if (!currentScopeId) return;

		let result: KGEntity[];
		if (searchQuery.trim()) {
			result = await kgQuery('searchEntities', { query: searchQuery, limit: 50 });
			if (result) {
				result = result.filter((e: KGEntity) => e.scopeId === currentScopeId);
			}
		} else {
			const filters: Record<string, any> = { scopeId: currentScopeId };
			if (typeFilter) filters.type = typeFilter;
			if (statusFilter) filters.status = statusFilter;
			result = await kgQuery('listEntities', { filters });
		}

		if (result) {
			setEntities(result);
			// Load tags for each entity
			const tagMap: Record<string, KGTag[]> = {};
			for (const entity of result) {
				const tags = await kgQuery('getTagsFor', { entityId: entity.id });
				if (tags) tagMap[entity.id] = tags;
			}
			setEntityTags(tagMap);
		}
	};

	const loadChildScopes = async () => {
		if (!currentScopeId) return;
		const children = await kgQuery('listScopes', { parentScopeId: currentScopeId });
		setChildScopes(children || []);
	};

	const navigateToScope = async (scopeId: string) => {
		const scope = await kgQuery('getScope', { id: scopeId });
		if (!scope) return;

		// Build scope chain
		const chain: KGScope[] = [scope];
		let current = scope;
		while (current.parentScopeId) {
			const parent = await kgQuery('getScope', { id: current.parentScopeId });
			if (!parent) break;
			chain.unshift(parent);
			current = parent;
		}

		setScopeChain(chain);
		setCurrentScopeId(scopeId);
		setSelectedEntityId(null);
	};

	const handleCreateScope = async (name: string, scopeType: string) => {
		await kgMutate('createScope', {
			scopeType,
			name,
			parentScopeId: currentScopeId,
			metadata: {},
		});
		loadChildScopes();
	};

	const handleSelectEntity = (id: string) => {
		setSelectedEntityId(selectedEntityId === id ? null : id);
	};

	const handleSaveEntity = async (data: { id: string; updates: Record<string, any> }) => {
		await kgMutate('updateEntity', data);
		loadEntities();
	};

	const handleDeleteEntity = async (id: string) => {
		await kgMutate('deleteEntity', { id });
		setSelectedEntityId(null);
		loadEntities();
	};

	const handleAddTag = async (entityId: string, tagName: string) => {
		await kgMutate('addTag', { entityId, tagName });
		const tags = await kgQuery('getTagsFor', { entityId });
		setEntityTags((prev) => ({ ...prev, [entityId]: tags || [] }));
	};

	const handleRemoveTag = async (entityId: string, tagName: string) => {
		await kgMutate('removeTag', { entityId, tagName });
		const tags = await kgQuery('getTagsFor', { entityId });
		setEntityTags((prev) => ({ ...prev, [entityId]: tags || [] }));
	};

	const handleDragStart = (e: DragEvent, entityId: string) => {
		if (e.dataTransfer) {
			e.dataTransfer.setData('text/plain', entityId);
			e.dataTransfer.effectAllowed = 'move';
		}
	};

	const handleSearch = useCallback((q: string) => {
		setSearchQuery(q);
		// Debounced search
		const timer = setTimeout(() => loadEntities(), 300);
		return () => clearTimeout(timer);
	}, [currentScopeId]);

	const selectedEntity = entities.find((e) => e.id === selectedEntityId) || null;
	const currentScope = scopeChain.length > 0 ? scopeChain[scopeChain.length - 1] : null;

	return (
		<div class="storyboard-app">
			{/* Toolbar */}
			<div class="sb-toolbar">
				<div class="sb-toolbar-left">
					<ScopeBreadcrumb
						scopeChain={scopeChain}
						currentScopeId={currentScopeId || ''}
						onNavigate={navigateToScope}
					/>
				</div>
				<div class="sb-toolbar-right">
					{currentScopeId && <NewEntityForm scopeId={currentScopeId} onCreated={loadEntities} />}
				</div>
			</div>

			{/* Filter bar */}
			<div class="sb-toolbar" style={{ paddingTop: '4px', paddingBottom: '4px' }}>
				<SearchFilterBar
					searchQuery={searchQuery}
					onSearchChange={handleSearch}
					activeTypeFilter={typeFilter}
					onTypeFilterChange={setTypeFilter}
					activeStatusFilter={statusFilter}
					onStatusFilterChange={setStatusFilter}
				/>
			</div>

			{/* Main content */}
			<div class="sb-content">
				<div class="sb-board">
					{/* Child scopes navigation */}
					<ScopeManager
						currentScope={currentScope}
						childScopes={childScopes}
						onNavigate={navigateToScope}
						onCreateScope={handleCreateScope}
					/>

					{/* Entity cards grid */}
					{entities.length > 0 ? (
						<div class="sb-board-grid">
							{entities.map((entity) => (
								<EntityCard
									key={entity.id}
									entity={entity}
									selected={entity.id === selectedEntityId}
									tags={entityTags[entity.id] || []}
									onSelect={handleSelectEntity}
									onDragStart={handleDragStart}
								/>
							))}
						</div>
					) : (
						<div class="sb-board-empty">
							<div style={{ fontSize: '32px' }}>📋</div>
							<div>No entities in this scope yet.</div>
							<div style={{ fontSize: '11px' }}>Use "+ New Entity" to create your first card.</div>
						</div>
					)}
				</div>

				{/* Inspector panel */}
				<CardInspector
					entity={selectedEntity}
					tags={selectedEntity ? (entityTags[selectedEntity.id] || []) : []}
					onClose={() => setSelectedEntityId(null)}
					onSave={handleSaveEntity}
					onDelete={handleDeleteEntity}
					onAddTag={handleAddTag}
					onRemoveTag={handleRemoveTag}
				/>
			</div>
		</div>
	);
}

// ============================================================
// Mount
// ============================================================

const root = document.getElementById('storyboard-root');
if (root) {
	render(<StoryboardApp />, root);
}
