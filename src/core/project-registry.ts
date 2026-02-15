import joplin from 'api';
import { SETTING_KEYS } from './settings';
import { ProjectConfig, ProjectRegistry } from './types';

function generateId(): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).substring(2, 10);
	return `${timestamp}-${random}`;
}

async function loadRegistry(): Promise<ProjectRegistry> {
	const raw = await joplin.settings.value(SETTING_KEYS.projectRegistry);
	try {
		return JSON.parse(raw || '{"activeProjectId":null,"projects":[]}');
	} catch {
		return { activeProjectId: null, projects: [] };
	}
}

async function saveRegistry(registry: ProjectRegistry): Promise<void> {
	await joplin.settings.setValue(SETTING_KEYS.projectRegistry, JSON.stringify(registry));
}

export async function getProjects(): Promise<ProjectRegistry> {
	return loadRegistry();
}

export async function getActiveProject(): Promise<ProjectConfig | null> {
	const registry = await loadRegistry();
	if (!registry.activeProjectId) return null;
	return registry.projects.find((p) => p.id === registry.activeProjectId) || null;
}

export async function setActiveProject(projectId: string | null): Promise<void> {
	const registry = await loadRegistry();
	if (projectId && !registry.projects.find((p) => p.id === projectId)) {
		throw new Error(`Project not found: ${projectId}`);
	}
	registry.activeProjectId = projectId;
	await saveRegistry(registry);
}

export async function createProject(
	name: string,
	notebookIds: string[] = [],
	tagIds: string[] = [],
): Promise<ProjectConfig> {
	const registry = await loadRegistry();

	const project: ProjectConfig = {
		id: generateId(),
		name,
		notebookIds,
		tagIds,
		kgResourceId: null,
		kgNoteId: null,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};

	registry.projects.push(project);

	// Auto-activate if this is the first project
	if (registry.projects.length === 1) {
		registry.activeProjectId = project.id;
	}

	await saveRegistry(registry);
	return project;
}

export async function updateProject(
	projectId: string,
	updates: Partial<Pick<ProjectConfig, 'name' | 'notebookIds' | 'tagIds' | 'kgResourceId' | 'kgNoteId'>>,
): Promise<ProjectConfig> {
	const registry = await loadRegistry();
	const idx = registry.projects.findIndex((p) => p.id === projectId);
	if (idx === -1) throw new Error(`Project not found: ${projectId}`);

	const project = registry.projects[idx];
	if (updates.name !== undefined) project.name = updates.name;
	if (updates.notebookIds !== undefined) project.notebookIds = updates.notebookIds;
	if (updates.tagIds !== undefined) project.tagIds = updates.tagIds;
	if (updates.kgResourceId !== undefined) project.kgResourceId = updates.kgResourceId;
	if (updates.kgNoteId !== undefined) project.kgNoteId = updates.kgNoteId;
	project.updatedAt = new Date().toISOString();

	registry.projects[idx] = project;
	await saveRegistry(registry);
	return project;
}

export async function deleteProject(projectId: string): Promise<void> {
	const registry = await loadRegistry();
	registry.projects = registry.projects.filter((p) => p.id !== projectId);
	if (registry.activeProjectId === projectId) {
		registry.activeProjectId = registry.projects.length > 0 ? registry.projects[0].id : null;
	}
	await saveRegistry(registry);
}
