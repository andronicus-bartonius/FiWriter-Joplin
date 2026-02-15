import joplin from 'api';
import { SettingItemType } from 'api/types';

export const SETTINGS_SECTION = 'firiter';

export const SETTING_KEYS = {
	llmBaseUrl: 'firiter.llmBaseUrl',
	llmApiKey: 'firiter.llmApiKey',
	llmModel: 'firiter.llmModel',
	embeddingEndpoint: 'firiter.embeddingEndpoint',
	embeddingModel: 'firiter.embeddingModel',
	projectRegistry: 'firiter.projectRegistry',
} as const;

export async function registerSettings(): Promise<void> {
	await joplin.settings.registerSection(SETTINGS_SECTION, {
		label: 'FiRiter',
		iconName: 'fas fa-pen-fancy',
		description: 'Screenwriting AI Copilot settings',
	});

	await joplin.settings.registerSettings({
		[SETTING_KEYS.llmBaseUrl]: {
			value: 'http://localhost:11434',
			type: SettingItemType.String,
			section: SETTINGS_SECTION,
			public: true,
			label: 'LLM Base URL',
			description: 'Base URL for the OpenAI-compatible LLM API (e.g. http://localhost:11434 for Ollama, http://localhost:1234 for LM Studio)',
		},
		[SETTING_KEYS.llmApiKey]: {
			value: '',
			type: SettingItemType.String,
			section: SETTINGS_SECTION,
			public: true,
			secure: true,
			label: 'LLM API Key',
			description: 'API key for the LLM endpoint (leave empty if not required)',
		},
		[SETTING_KEYS.llmModel]: {
			value: '',
			type: SettingItemType.String,
			section: SETTINGS_SECTION,
			public: true,
			label: 'LLM Model',
			description: 'Model name to use for generation (e.g. llama3, mistral, gpt-4o)',
		},
		[SETTING_KEYS.embeddingEndpoint]: {
			value: '',
			type: SettingItemType.String,
			section: SETTINGS_SECTION,
			public: true,
			advanced: true,
			label: 'Embedding Endpoint (optional)',
			description: 'Separate base URL for embeddings if different from the main LLM endpoint. Leave empty to use the main endpoint.',
		},
		[SETTING_KEYS.embeddingModel]: {
			value: '',
			type: SettingItemType.String,
			section: SETTINGS_SECTION,
			public: true,
			advanced: true,
			label: 'Embedding Model (optional)',
			description: 'Model name for computing embeddings (e.g. nomic-embed-text). Leave empty to disable vector search.',
		},
		[SETTING_KEYS.projectRegistry]: {
			value: '{"activeProjectId":null,"projects":[]}',
			type: SettingItemType.String,
			section: SETTINGS_SECTION,
			public: false,
			label: 'Project Registry (internal)',
			description: 'Internal storage for project configuration. Do not edit manually.',
		},
	});
}

export async function getSettingValues(): Promise<{
	llmBaseUrl: string;
	llmApiKey: string;
	llmModel: string;
	embeddingEndpoint: string;
	embeddingModel: string;
}> {
	const values = await joplin.settings.values([
		SETTING_KEYS.llmBaseUrl,
		SETTING_KEYS.llmApiKey,
		SETTING_KEYS.llmModel,
		SETTING_KEYS.embeddingEndpoint,
		SETTING_KEYS.embeddingModel,
	]);
	return {
		llmBaseUrl: (values[SETTING_KEYS.llmBaseUrl] as string) || 'http://localhost:11434',
		llmApiKey: (values[SETTING_KEYS.llmApiKey] as string) || '',
		llmModel: (values[SETTING_KEYS.llmModel] as string) || '',
		embeddingEndpoint: (values[SETTING_KEYS.embeddingEndpoint] as string) || '',
		embeddingModel: (values[SETTING_KEYS.embeddingModel] as string) || '',
	};
}
