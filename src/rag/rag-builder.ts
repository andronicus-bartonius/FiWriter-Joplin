import joplin from 'api';
import { RAGDocument } from '../core/types';
import { RAGIndex } from './rag-index';
import { ProjectConfig } from '../core/types';

/**
 * Builds and incrementally updates the RAG index by iterating
 * project-scoped notes via joplin.data.
 *
 * Notes are scoped by the project's notebook IDs and/or tag IDs.
 * Updated notes are detected via updated_time comparison.
 */
export class RAGBuilder {
	private ragIndex: RAGIndex;
	private lastBuildTime: number = 0;
	private indexedNoteIds: Set<string> = new Set();
	private building: boolean = false;

	constructor(ragIndex: RAGIndex) {
		this.ragIndex = ragIndex;
	}

	/**
	 * Full rebuild: clear the index and re-index all notes in the project scope.
	 */
	async fullBuild(project: ProjectConfig): Promise<{ indexed: number; errors: number }> {
		if (this.building) {
			console.warn('[FiRiter RAG] Build already in progress, skipping');
			return { indexed: 0, errors: 0 };
		}

		this.building = true;
		try {
			this.ragIndex.clear();
			this.indexedNoteIds.clear();

			const noteIds = await this.collectNoteIds(project);
			let indexed = 0;
			let errors = 0;

			for (const noteId of noteIds) {
				try {
					const doc = await this.fetchNoteAsDocument(noteId);
					if (doc) {
						this.ragIndex.addDocument(doc);
						this.indexedNoteIds.add(noteId);
						indexed++;
					}
				} catch (err: any) {
					console.error(`[FiRiter RAG] Error indexing note ${noteId}: ${err.message}`);
					errors++;
				}
			}

			this.lastBuildTime = Date.now();
			console.info(`[FiRiter RAG] Full build complete: ${indexed} notes indexed, ${errors} errors`);
			return { indexed, errors };
		} finally {
			this.building = false;
		}
	}

	/**
	 * Incremental update: only re-index notes modified since the last build.
	 */
	async incrementalUpdate(project: ProjectConfig): Promise<{ added: number; updated: number; removed: number }> {
		if (this.building) {
			return { added: 0, updated: 0, removed: 0 };
		}

		this.building = true;
		try {
			const currentNoteIds = await this.collectNoteIds(project);
			const currentSet = new Set(currentNoteIds);

			let added = 0;
			let updated = 0;
			let removed = 0;

			// Remove notes that are no longer in scope
			for (const existingId of this.indexedNoteIds) {
				if (!currentSet.has(existingId)) {
					this.ragIndex.removeDocument(existingId);
					this.indexedNoteIds.delete(existingId);
					removed++;
				}
			}

			// Add/update notes that are new or modified
			const sinceTime = this.lastBuildTime > 0
				? new Date(this.lastBuildTime).toISOString()
				: null;

			for (const noteId of currentNoteIds) {
				try {
					if (!this.indexedNoteIds.has(noteId)) {
						// New note
						const doc = await this.fetchNoteAsDocument(noteId);
						if (doc) {
							this.ragIndex.addDocument(doc);
							this.indexedNoteIds.add(noteId);
							added++;
						}
					} else if (sinceTime) {
						// Check if modified since last build
						const note = await joplin.data.get(['notes', noteId], { fields: ['updated_time'] });
						if (note && new Date(note.updated_time).getTime() > this.lastBuildTime) {
							const doc = await this.fetchNoteAsDocument(noteId);
							if (doc) {
								this.ragIndex.addDocument(doc);
								updated++;
							}
						}
					}
				} catch (err: any) {
					console.error(`[FiRiter RAG] Error updating note ${noteId}: ${err.message}`);
				}
			}

			this.lastBuildTime = Date.now();
			console.info(`[FiRiter RAG] Incremental update: +${added} ~${updated} -${removed}`);
			return { added, updated, removed };
		} finally {
			this.building = false;
		}
	}

	/**
	 * Collect all note IDs that belong to the project scope.
	 * Scoping is by notebook IDs and/or tag IDs (union).
	 */
	private async collectNoteIds(project: ProjectConfig): Promise<string[]> {
		const noteIdSet = new Set<string>();

		// Notes from scoped notebooks
		if (project.notebookIds && project.notebookIds.length > 0) {
			for (const notebookId of project.notebookIds) {
				await this.paginateNotes(
					['folders', notebookId, 'notes'],
					(note: any) => noteIdSet.add(note.id),
				);
			}
		}

		// Notes from scoped tags
		if (project.tagIds && project.tagIds.length > 0) {
			for (const tagId of project.tagIds) {
				await this.paginateNotes(
					['tags', tagId, 'notes'],
					(note: any) => noteIdSet.add(note.id),
				);
			}
		}

		return Array.from(noteIdSet);
	}

	/**
	 * Paginate through Joplin data API results.
	 */
	private async paginateNotes(path: string[], onNote: (note: any) => void): Promise<void> {
		let page = 1;
		let hasMore = true;

		while (hasMore) {
			const result = await joplin.data.get(path, {
				fields: ['id'],
				limit: 100,
				page,
			});

			if (result && result.items) {
				for (const item of result.items) {
					onNote(item);
				}
				hasMore = result.has_more === true;
				page++;
			} else {
				hasMore = false;
			}
		}
	}

	/**
	 * Fetch a single note and convert it to a RAGDocument.
	 */
	private async fetchNoteAsDocument(noteId: string): Promise<RAGDocument | null> {
		const note = await joplin.data.get(['notes', noteId], {
			fields: ['id', 'title', 'body', 'parent_id', 'updated_time'],
		});

		if (!note || !note.body) return null;

		return {
			id: note.id,
			noteId: note.id,
			title: note.title || 'Untitled',
			content: note.body,
			notebookId: note.parent_id || undefined,
		};
	}

	/**
	 * Reset state (e.g. when switching projects).
	 */
	reset(): void {
		this.ragIndex.clear();
		this.indexedNoteIds.clear();
		this.lastBuildTime = 0;
	}

	get isBuilding(): boolean {
		return this.building;
	}

	get stats(): { documentCount: number; lastBuildTime: number } {
		return {
			documentCount: this.ragIndex.documentCount,
			lastBuildTime: this.lastBuildTime,
		};
	}
}
