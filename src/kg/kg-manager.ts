import joplin from 'api';
import initSqlJs from 'sql.js';
import { KGDatabase } from './kg-database';
import { ProjectConfig } from '../core/types';
import { updateProject } from '../core/project-registry';

let sqlJsInstance: any = null;

/**
 * Lazily initialize sql.js WASM.
 */
async function getSqlJs(): Promise<any> {
	if (!sqlJsInstance) {
		sqlJsInstance = await initSqlJs();
	}
	return sqlJsInstance;
}

/**
 * Manages the lifecycle of a project's Knowledge Graph database.
 * Handles loading from / saving to Joplin resources for sync.
 */
export class KGManager {
	private db: KGDatabase | null = null;
	private project: ProjectConfig | null = null;
	private dirty: boolean = false;

	async isLoaded(): Promise<boolean> {
		return this.db !== null;
	}

	getDatabase(): KGDatabase | null {
		return this.db;
	}

	getCurrentProject(): ProjectConfig | null {
		return this.project;
	}

	/**
	 * Load or create the KG for a given project.
	 * If the project has an existing KG resource, load it.
	 * Otherwise, create a new empty KG.
	 */
	async loadForProject(project: ProjectConfig): Promise<KGDatabase> {
		// Close existing DB if switching projects
		if (this.db) {
			await this.save();
			this.db.close();
			this.db = null;
		}

		this.project = project;
		const SQL = await getSqlJs();

		if (project.kgResourceId) {
			try {
				const buffer = await this.loadResourceData(project.kgResourceId);
				this.db = await KGDatabase.loadFromBuffer(SQL, buffer);
				console.info(`[FiRiter] Loaded KG for project "${project.name}" from resource ${project.kgResourceId}`);
			} catch (err: any) {
				console.warn(`[FiRiter] Failed to load KG resource, creating new: ${err.message}`);
				this.db = await KGDatabase.createNew(SQL);
				this.dirty = true;
			}
		} else {
			this.db = await KGDatabase.createNew(SQL);
			this.dirty = true;
			console.info(`[FiRiter] Created new KG for project "${project.name}"`);
		}

		// Ensure WORLD scope exists
		const worldScopes = this.db.listScopes('WORLD', null);
		if (worldScopes.length === 0) {
			this.db.createScope('WORLD', `${project.name} - World Bible`);
			this.dirty = true;
		}

		return this.db;
	}

	/**
	 * Persist the KG database back to a Joplin resource.
	 * Creates a hidden note + resource on first save.
	 */
	async save(): Promise<void> {
		if (!this.db || !this.project || !this.dirty) return;

		const data = this.db.serialize();

		if (this.project.kgResourceId) {
			// Update existing resource
			await this.updateResourceData(this.project.kgResourceId, data);
		} else {
			// Create hidden note and resource for the first time
			const { noteId, resourceId } = await this.createKGResource(data);
			await updateProject(this.project.id, {
				kgNoteId: noteId,
				kgResourceId: resourceId,
			});
			this.project.kgNoteId = noteId;
			this.project.kgResourceId = resourceId;
		}

		this.dirty = false;
		console.info(`[FiRiter] Saved KG for project "${this.project.name}"`);
	}

	markDirty(): void {
		this.dirty = true;
	}

	async close(): Promise<void> {
		if (this.db) {
			await this.save();
			this.db.close();
			this.db = null;
		}
		this.project = null;
	}

	// ================================================================
	// Joplin resource I/O
	// ================================================================

	private async loadResourceData(resourceId: string): Promise<Uint8Array> {
		const resourcePath = await joplin.data.resourcePath(resourceId);
		const fs = require('fs');
		const buffer = fs.readFileSync(resourcePath);
		return new Uint8Array(buffer);
	}

	private async updateResourceData(resourceId: string, data: Uint8Array): Promise<void> {
		const resourcePath = await joplin.data.resourcePath(resourceId);
		const fs = require('fs');
		fs.writeFileSync(resourcePath, Buffer.from(data));
		// Touch the resource so Joplin detects the change for sync
		await joplin.data.put(['resources', resourceId], null, { title: `FiRiter KG - ${this.project!.name}` });
	}

	private async createKGResource(data: Uint8Array): Promise<{ noteId: string; resourceId: string }> {
		// Create a hidden notebook for FiRiter internal data (if not exists)
		let folderId: string;
		const folders = await joplin.data.get(['folders'], { fields: ['id', 'title'] });
		const existing = folders.items?.find((f: any) => f.title === '.firiter-internal');
		if (existing) {
			folderId = existing.id;
		} else {
			const folder = await joplin.data.post(['folders'], null, { title: '.firiter-internal' });
			folderId = folder.id;
		}

		// Create the note that will hold the KG resource
		const note = await joplin.data.post(['notes'], null, {
			title: `[FiRiter KG] ${this.project!.name}`,
			body: `This note contains the Knowledge Graph database for the FiRiter project "${this.project!.name}". Do not delete.`,
			parent_id: folderId,
		});

		// Write data to a temp file and upload as resource
		const os = require('os');
		const path = require('path');
		const fs = require('fs');
		const tmpFile = path.join(os.tmpdir(), `firiter-kg-${this.project!.id}.sqlite`);
		fs.writeFileSync(tmpFile, Buffer.from(data));

		const resource = await joplin.data.post(
			['resources'],
			null,
			{ title: `FiRiter KG - ${this.project!.name}` },
			[{ path: tmpFile }],
		);

		// Clean up temp file
		try { fs.unlinkSync(tmpFile); } catch (_e) { /* ignore */ }

		// Link resource to note
		await joplin.data.put(['notes', note.id], null, {
			body: note.body + `\n\n[KG Database](:/${resource.id})`,
		});

		return { noteId: note.id, resourceId: resource.id };
	}
}
