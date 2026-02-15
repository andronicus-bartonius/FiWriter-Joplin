import type initSqlJs from 'sql.js';
import { CREATE_TABLES_SQL, SET_SCHEMA_VERSION_SQL } from './schema';
import {
	KGEntity,
	KGLink,
	KGTag,
	KGScope,
	KGStateSnapshot,
	EntityType,
	EntityStatus,
	ScopeType,
	LinkType,
} from '../core/types';

type SqlJsDatabase = ReturnType<Awaited<ReturnType<typeof initSqlJs>>['prototype']['constructor']> extends never
	? any
	: any;

function generateId(): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).substring(2, 10);
	return `${timestamp}-${random}`;
}

/**
 * Knowledge Graph database backed by sql.js (WASM SQLite).
 * One instance per project. The DB is serialized to/from a Uint8Array
 * for storage as a Joplin resource.
 */
export class KGDatabase {
	private db: any;

	constructor(db: any) {
		this.db = db;
	}

	/**
	 * Initialize a new KG database from scratch (empty).
	 */
	static async createNew(SQL: any): Promise<KGDatabase> {
		const db = new SQL.Database();
		db.run(CREATE_TABLES_SQL);
		db.run(SET_SCHEMA_VERSION_SQL);
		return new KGDatabase(db);
	}

	/**
	 * Load a KG database from a serialized Uint8Array (e.g. from a Joplin resource).
	 */
	static async loadFromBuffer(SQL: any, buffer: Uint8Array): Promise<KGDatabase> {
		const db = new SQL.Database(buffer);
		return new KGDatabase(db);
	}

	/**
	 * Serialize the database to a Uint8Array for storage.
	 */
	serialize(): Uint8Array {
		return this.db.export();
	}

	close(): void {
		this.db.close();
	}

	// ================================================================
	// Scope CRUD
	// ================================================================

	createScope(scopeType: ScopeType, name: string, parentScopeId: string | null = null, metadata: Record<string, any> = {}): KGScope {
		const id = generateId();
		this.db.run(
			`INSERT INTO scopes (id, parent_scope_id, scope_type, name, metadata) VALUES (?, ?, ?, ?, ?)`,
			[id, parentScopeId, scopeType, name, JSON.stringify(metadata)],
		);
		return this.getScope(id)!;
	}

	getScope(id: string): KGScope | null {
		const stmt = this.db.prepare(`SELECT * FROM scopes WHERE id = ?`);
		stmt.bind([id]);
		if (stmt.step()) {
			const row = stmt.getAsObject();
			stmt.free();
			return this.rowToScope(row);
		}
		stmt.free();
		return null;
	}

	listScopes(scopeType?: ScopeType, parentScopeId?: string | null): KGScope[] {
		let sql = `SELECT * FROM scopes WHERE 1=1`;
		const params: any[] = [];
		if (scopeType) {
			sql += ` AND scope_type = ?`;
			params.push(scopeType);
		}
		if (parentScopeId !== undefined) {
			if (parentScopeId === null) {
				sql += ` AND parent_scope_id IS NULL`;
			} else {
				sql += ` AND parent_scope_id = ?`;
				params.push(parentScopeId);
			}
		}
		sql += ` ORDER BY name`;
		return this.queryAll(sql, params).map((r) => this.rowToScope(r));
	}

	updateScope(id: string, updates: Partial<Pick<KGScope, 'name' | 'metadata'>>): void {
		const sets: string[] = [];
		const params: any[] = [];
		if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
		if (updates.metadata !== undefined) { sets.push('metadata = ?'); params.push(JSON.stringify(updates.metadata)); }
		if (sets.length === 0) return;
		sets.push("updated_at = datetime('now')");
		params.push(id);
		this.db.run(`UPDATE scopes SET ${sets.join(', ')} WHERE id = ?`, params);
	}

	deleteScope(id: string): void {
		this.db.run(`DELETE FROM scopes WHERE id = ?`, [id]);
	}

	// ================================================================
	// Entity CRUD
	// ================================================================

	createEntity(
		type: EntityType,
		scopeId: string,
		name: string,
		content: Record<string, any> = {},
		structuredFields: Record<string, any> = {},
		status: EntityStatus = 'draft',
	): KGEntity {
		const id = generateId();
		this.db.run(
			`INSERT INTO entities (id, type, scope_id, name, content, structured_fields, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[id, type, scopeId, name, JSON.stringify(content), JSON.stringify(structuredFields), status],
		);
		return this.getEntity(id)!;
	}

	getEntity(id: string): KGEntity | null {
		const stmt = this.db.prepare(`SELECT * FROM entities WHERE id = ?`);
		stmt.bind([id]);
		if (stmt.step()) {
			const row = stmt.getAsObject();
			stmt.free();
			return this.rowToEntity(row);
		}
		stmt.free();
		return null;
	}

	listEntities(filters?: {
		scopeId?: string;
		type?: EntityType;
		status?: EntityStatus;
		search?: string;
	}): KGEntity[] {
		let sql = `SELECT * FROM entities WHERE 1=1`;
		const params: any[] = [];
		if (filters?.scopeId) { sql += ` AND scope_id = ?`; params.push(filters.scopeId); }
		if (filters?.type) { sql += ` AND type = ?`; params.push(filters.type); }
		if (filters?.status) { sql += ` AND status = ?`; params.push(filters.status); }
		if (filters?.search) { sql += ` AND name LIKE ?`; params.push(`%${filters.search}%`); }
		sql += ` ORDER BY name`;
		return this.queryAll(sql, params).map((r) => this.rowToEntity(r));
	}

	updateEntity(id: string, updates: Partial<Pick<KGEntity, 'name' | 'content' | 'structuredFields' | 'status' | 'scopeId'>>): void {
		const sets: string[] = [];
		const params: any[] = [];
		if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
		if (updates.content !== undefined) { sets.push('content = ?'); params.push(JSON.stringify(updates.content)); }
		if (updates.structuredFields !== undefined) { sets.push('structured_fields = ?'); params.push(JSON.stringify(updates.structuredFields)); }
		if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
		if (updates.scopeId !== undefined) { sets.push('scope_id = ?'); params.push(updates.scopeId); }
		if (sets.length === 0) return;
		sets.push("updated_at = datetime('now')");
		params.push(id);
		this.db.run(`UPDATE entities SET ${sets.join(', ')} WHERE id = ?`, params);
	}

	deleteEntity(id: string): void {
		this.db.run(`DELETE FROM entities WHERE id = ?`, [id]);
	}

	// ================================================================
	// Link CRUD
	// ================================================================

	createLink(sourceId: string, targetId: string, linkType: LinkType, metadata: Record<string, any> = {}): KGLink {
		const id = generateId();
		this.db.run(
			`INSERT INTO links (id, source_id, target_id, link_type, metadata) VALUES (?, ?, ?, ?, ?)`,
			[id, sourceId, targetId, linkType, JSON.stringify(metadata)],
		);
		return { id, sourceId, targetId, linkType, metadata };
	}

	getLinksFor(entityId: string): KGLink[] {
		const sql = `SELECT * FROM links WHERE source_id = ? OR target_id = ?`;
		return this.queryAll(sql, [entityId, entityId]).map((r) => this.rowToLink(r));
	}

	deleteLink(id: string): void {
		this.db.run(`DELETE FROM links WHERE id = ?`, [id]);
	}

	// ================================================================
	// Tag CRUD
	// ================================================================

	addTag(entityId: string, tagName: string): KGTag {
		const id = generateId();
		this.db.run(
			`INSERT OR IGNORE INTO tags (id, entity_id, tag_name) VALUES (?, ?, ?)`,
			[id, entityId, tagName],
		);
		return { id, entityId, tagName };
	}

	getTagsFor(entityId: string): KGTag[] {
		const sql = `SELECT * FROM tags WHERE entity_id = ?`;
		return this.queryAll(sql, [entityId]).map((r) => ({
			id: r.id as string,
			entityId: r.entity_id as string,
			tagName: r.tag_name as string,
		}));
	}

	removeTag(entityId: string, tagName: string): void {
		this.db.run(`DELETE FROM tags WHERE entity_id = ? AND tag_name = ?`, [entityId, tagName]);
	}

	// ================================================================
	// State Snapshot CRUD
	// ================================================================

	createSnapshot(entityId: string, scopeId: string, beatIndex: number, stateData: Record<string, any>): KGStateSnapshot {
		const id = generateId();
		this.db.run(
			`INSERT INTO state_snapshots (id, entity_id, scope_id, beat_index, state_data) VALUES (?, ?, ?, ?, ?)`,
			[id, entityId, scopeId, beatIndex, JSON.stringify(stateData)],
		);
		return { id, entityId, scopeId, beatIndex, stateData };
	}

	getLatestSnapshot(entityId: string, scopeId: string): KGStateSnapshot | null {
		const stmt = this.db.prepare(
			`SELECT * FROM state_snapshots WHERE entity_id = ? AND scope_id = ? ORDER BY beat_index DESC LIMIT 1`,
		);
		stmt.bind([entityId, scopeId]);
		if (stmt.step()) {
			const row = stmt.getAsObject();
			stmt.free();
			return this.rowToSnapshot(row);
		}
		stmt.free();
		return null;
	}

	// ================================================================
	// Full-text search (FTS5)
	// ================================================================

	searchEntities(query: string, limit: number = 20): KGEntity[] {
		const ftsQuery = query.split(/\s+/).filter(Boolean).map(t => `"${t}"*`).join(' OR ');
		if (!ftsQuery) return [];

		const sql = `
			SELECT e.* FROM entities e
			JOIN entities_fts fts ON e.rowid = fts.rowid
			WHERE entities_fts MATCH ?
			ORDER BY rank
			LIMIT ?
		`;
		return this.queryAll(sql, [ftsQuery, limit]).map((r) => this.rowToEntity(r));
	}

	// ================================================================
	// Query helpers for workflow constraints
	// ================================================================

	getConstraintsForScope(scopeId: string): KGEntity[] {
		const scope = this.getScope(scopeId);
		if (!scope) return [];

		const scopeIds: string[] = [scopeId];
		let current = scope;
		while (current.parentScopeId) {
			scopeIds.push(current.parentScopeId);
			const parent = this.getScope(current.parentScopeId);
			if (!parent) break;
			current = parent;
		}

		const placeholders = scopeIds.map(() => '?').join(',');
		const sql = `SELECT * FROM entities WHERE scope_id IN (${placeholders}) AND type = 'Rule' AND status = 'canon' ORDER BY name`;
		return this.queryAll(sql, scopeIds).map((r) => this.rowToEntity(r));
	}

	getEntitiesInScopeHierarchy(scopeId: string, type?: EntityType): KGEntity[] {
		const scope = this.getScope(scopeId);
		if (!scope) return [];

		const scopeIds: string[] = [scopeId];
		let current = scope;
		while (current.parentScopeId) {
			scopeIds.push(current.parentScopeId);
			const parent = this.getScope(current.parentScopeId);
			if (!parent) break;
			current = parent;
		}

		const placeholders = scopeIds.map(() => '?').join(',');
		let sql = `SELECT * FROM entities WHERE scope_id IN (${placeholders})`;
		const params: any[] = [...scopeIds];
		if (type) {
			sql += ` AND type = ?`;
			params.push(type);
		}
		sql += ` ORDER BY name`;
		return this.queryAll(sql, params).map((r) => this.rowToEntity(r));
	}

	// ================================================================
	// Internal helpers
	// ================================================================

	private queryAll(sql: string, params: any[] = []): Record<string, any>[] {
		const stmt = this.db.prepare(sql);
		stmt.bind(params);
		const results: Record<string, any>[] = [];
		while (stmt.step()) {
			results.push(stmt.getAsObject());
		}
		stmt.free();
		return results;
	}

	private rowToScope(row: Record<string, any>): KGScope {
		return {
			id: row.id,
			parentScopeId: row.parent_scope_id || null,
			scopeType: row.scope_type as ScopeType,
			name: row.name,
			metadata: JSON.parse(row.metadata || '{}'),
		};
	}

	private rowToEntity(row: Record<string, any>): KGEntity {
		return {
			id: row.id,
			type: row.type as EntityType,
			scopeId: row.scope_id,
			name: row.name,
			content: JSON.parse(row.content || '{}'),
			structuredFields: JSON.parse(row.structured_fields || '{}'),
			status: row.status as EntityStatus,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	private rowToLink(row: Record<string, any>): KGLink {
		return {
			id: row.id,
			sourceId: row.source_id,
			targetId: row.target_id,
			linkType: row.link_type as LinkType,
			metadata: JSON.parse(row.metadata || '{}'),
		};
	}

	private rowToSnapshot(row: Record<string, any>): KGStateSnapshot {
		return {
			id: row.id,
			entityId: row.entity_id,
			scopeId: row.scope_id,
			beatIndex: row.beat_index,
			stateData: JSON.parse(row.state_data || '{}'),
		};
	}
}
