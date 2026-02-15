/**
 * SQL statements for initializing and managing the Knowledge Graph schema.
 * Uses sql.js (WASM SQLite) — all statements must be standard SQLite SQL.
 */

export const KG_SCHEMA_VERSION = 1;

export const CREATE_TABLES_SQL = `
-- Schema version tracking
CREATE TABLE IF NOT EXISTS kg_meta (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

-- Hierarchical scopes: WORLD > SEASON > EPISODE > SCENE
CREATE TABLE IF NOT EXISTS scopes (
	id              TEXT PRIMARY KEY,
	parent_scope_id TEXT,
	scope_type      TEXT NOT NULL CHECK(scope_type IN ('WORLD','SEASON','EPISODE','SCENE')),
	name            TEXT NOT NULL,
	metadata        TEXT NOT NULL DEFAULT '{}',
	created_at      TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
	FOREIGN KEY (parent_scope_id) REFERENCES scopes(id) ON DELETE SET NULL
);

-- Story entities (cards)
CREATE TABLE IF NOT EXISTS entities (
	id                TEXT PRIMARY KEY,
	type              TEXT NOT NULL CHECK(type IN (
		'Character','Location','Rule','Item','Arc','Relationship','Beat','Event','Thread'
	)),
	scope_id          TEXT NOT NULL,
	name              TEXT NOT NULL,
	content           TEXT NOT NULL DEFAULT '{}',
	structured_fields TEXT NOT NULL DEFAULT '{}',
	status            TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('canon','draft','needs-review','archived')),
	created_at        TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
	FOREIGN KEY (scope_id) REFERENCES scopes(id) ON DELETE CASCADE
);

-- Relationships between entities
CREATE TABLE IF NOT EXISTS links (
	id        TEXT PRIMARY KEY,
	source_id TEXT NOT NULL,
	target_id TEXT NOT NULL,
	link_type TEXT NOT NULL CHECK(link_type IN (
		'connected_to','depends_on','transitions_to','references','parent_of','child_of','evolves_into'
	)),
	metadata  TEXT NOT NULL DEFAULT '{}',
	FOREIGN KEY (source_id) REFERENCES entities(id) ON DELETE CASCADE,
	FOREIGN KEY (target_id) REFERENCES entities(id) ON DELETE CASCADE
);

-- Tags on entities
CREATE TABLE IF NOT EXISTS tags (
	id        TEXT PRIMARY KEY,
	entity_id TEXT NOT NULL,
	tag_name  TEXT NOT NULL,
	FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
	UNIQUE(entity_id, tag_name)
);

-- State snapshots: track entity state at a given beat index within a scope
CREATE TABLE IF NOT EXISTS state_snapshots (
	id         TEXT PRIMARY KEY,
	entity_id  TEXT NOT NULL,
	scope_id   TEXT NOT NULL,
	beat_index INTEGER NOT NULL,
	state_data TEXT NOT NULL DEFAULT '{}',
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
	FOREIGN KEY (scope_id)  REFERENCES scopes(id)   ON DELETE CASCADE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_entities_scope    ON entities(scope_id);
CREATE INDEX IF NOT EXISTS idx_entities_type     ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_status   ON entities(status);
CREATE INDEX IF NOT EXISTS idx_links_source      ON links(source_id);
CREATE INDEX IF NOT EXISTS idx_links_target      ON links(target_id);
CREATE INDEX IF NOT EXISTS idx_tags_entity       ON tags(entity_id);
CREATE INDEX IF NOT EXISTS idx_tags_name         ON tags(tag_name);
CREATE INDEX IF NOT EXISTS idx_snapshots_entity  ON state_snapshots(entity_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_scope   ON state_snapshots(scope_id);
CREATE INDEX IF NOT EXISTS idx_scopes_parent     ON scopes(parent_scope_id);
CREATE INDEX IF NOT EXISTS idx_scopes_type       ON scopes(scope_type);

-- FTS5 full-text search over entities
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
	name,
	content,
	structured_fields,
	content='entities',
	content_rowid='rowid'
);

-- Triggers to keep FTS index in sync with entities table
CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
	INSERT INTO entities_fts(rowid, name, content, structured_fields)
	VALUES (new.rowid, new.name, new.content, new.structured_fields);
END;

CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
	INSERT INTO entities_fts(entities_fts, rowid, name, content, structured_fields)
	VALUES ('delete', old.rowid, old.name, old.content, old.structured_fields);
END;

CREATE TRIGGER IF NOT EXISTS entities_au AFTER UPDATE ON entities BEGIN
	INSERT INTO entities_fts(entities_fts, rowid, name, content, structured_fields)
	VALUES ('delete', old.rowid, old.name, old.content, old.structured_fields);
	INSERT INTO entities_fts(rowid, name, content, structured_fields)
	VALUES (new.rowid, new.name, new.content, new.structured_fields);
END;
`;

export const SET_SCHEMA_VERSION_SQL = `
INSERT OR REPLACE INTO kg_meta (key, value) VALUES ('schema_version', '${KG_SCHEMA_VERSION}');
`;
