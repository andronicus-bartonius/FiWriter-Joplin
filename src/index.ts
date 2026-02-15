import joplin from 'api';
import { ToolbarButtonLocation, MenuItemLocation } from 'api/types';
import { registerSettings, getSettingValues, SETTING_KEYS } from './core/settings';
import { OpenAICompatProvider } from './providers/llm-provider';
import { KGManager } from './kg/kg-manager';
import { MessageHandler } from './core/message-handler';
import { getActiveProject } from './core/project-registry';
import { RAGIndex } from './rag/rag-index';
import { RAGBuilder } from './rag/rag-builder';
import { EmbeddingIndex } from './rag/embedding-index';
import { RetrievalAPI } from './rag/retrieval';

joplin.plugins.register({
	onStart: async function() {
		console.info('[FiRiter] Starting screenwriting AI copilot plugin...');

		// ---- Register settings ----
		await registerSettings();

		// ---- Initialize core services ----
		const llmProvider = new OpenAICompatProvider();
		const kgManager = new KGManager();
		const messageHandler = new MessageHandler(llmProvider, kgManager);

		// ---- Configure LLM provider from settings ----
		const settings = await getSettingValues();
		if (settings.llmBaseUrl && settings.llmModel) {
			llmProvider.configure({
				baseUrl: settings.llmBaseUrl,
				apiKey: settings.llmApiKey || undefined,
				model: settings.llmModel,
				embeddingEndpoint: settings.embeddingEndpoint || undefined,
				embeddingModel: settings.embeddingModel || undefined,
			});
		}

		// ---- Initialize RAG components ----
		const ragIndex = new RAGIndex();
		const embeddingIndex = new EmbeddingIndex();
		embeddingIndex.setProvider(llmProvider);
		const ragBuilder = new RAGBuilder(ragIndex);
		const retrievalAPI = new RetrievalAPI(ragIndex, embeddingIndex);
		messageHandler.setRetrievalAPI(retrievalAPI);

		// ---- Load KG for active project (if any) ----
		const activeProject = await getActiveProject();
		if (activeProject) {
			try {
				await kgManager.loadForProject(activeProject);
				console.info(`[FiRiter] Loaded KG for project: ${activeProject.name}`);
			} catch (err: any) {
				console.error(`[FiRiter] Failed to load KG: ${err.message}`);
			}

			// Build RAG index for active project
			try {
				const result = await ragBuilder.fullBuild(activeProject);
				console.info(`[FiRiter] RAG index built: ${result.indexed} notes indexed`);
			} catch (err: any) {
				console.error(`[FiRiter] RAG index build failed: ${err.message}`);
			}
		}

		// ---- Create sidebar panel ----
		const panel = await joplin.views.panels.create('firiter-sidebar');
		messageHandler.setPanelHandle(panel);

		await joplin.views.panels.setHtml(panel, `
			<div id="sidebar-root"></div>
		`);
		await joplin.views.panels.addScript(panel, './ui/sidebar/panel.css');
		await joplin.views.panels.addScript(panel, './ui/sidebar/panel.js');

		// ---- Wire panel messages to handler ----
		await joplin.views.panels.onMessage(panel, async (message: any) => {
			return messageHandler.handleMessage(message);
		});

		// ---- Create storyboard dialog ----
		const storyboardDialog = await joplin.views.dialogs.create('firiter-storyboard');
		await joplin.views.dialogs.setHtml(storyboardDialog, `
			<div id="storyboard-root"></div>
		`);
		await joplin.views.dialogs.addScript(storyboardDialog, './ui/storyboard/storyboard.css');
		await joplin.views.dialogs.addScript(storyboardDialog, './ui/storyboard/storyboard.js');
		await joplin.views.dialogs.setButtons(storyboardDialog, [{ id: 'cancel', title: 'Close' }]);
		await joplin.views.dialogs.setFitToContent(storyboardDialog, false);

		// Wire storyboard dialog open callback
		messageHandler.setOpenStoryboardFn(async () => {
			await joplin.views.dialogs.open(storyboardDialog);
		});

		// ---- Create output review dialog ----
		const outputReviewDialog = await joplin.views.dialogs.create('firiter-output-review');
		await joplin.views.dialogs.setHtml(outputReviewDialog, `
			<div id="output-review-root"></div>
		`);
		await joplin.views.dialogs.addScript(outputReviewDialog, './ui/output-review/output-review.css');
		await joplin.views.dialogs.addScript(outputReviewDialog, './ui/output-review/output-review.js');
		await joplin.views.dialogs.setButtons(outputReviewDialog, [{ id: 'cancel', title: 'Close' }]);
		await joplin.views.dialogs.setFitToContent(outputReviewDialog, false);

		// Wire output review dialog open callback
		messageHandler.setOpenOutputReviewFn(async () => {
			await joplin.views.dialogs.open(outputReviewDialog);
		});

		// ---- Register commands ----
		await joplin.commands.register({
			name: 'firiter.toggleSidebar',
			label: 'FiRiter: Toggle Sidebar',
			iconName: 'fas fa-pen-fancy',
			execute: async () => {
				const visible = await joplin.views.panels.visible(panel);
				await joplin.views.panels.show(panel, !visible);
			},
		});

		await joplin.commands.register({
			name: 'firiter.openStoryboard',
			label: 'FiRiter: Open Storyboard',
			iconName: 'fas fa-th',
			execute: async () => {
				await messageHandler.handleMessage({ type: 'openStoryboard' });
			},
		});

		await joplin.commands.register({
			name: 'firiter.testConnection',
			label: 'FiRiter: Test LLM Connection',
			iconName: 'fas fa-plug',
			execute: async () => {
				const result = await messageHandler.handleMessage({ type: 'testConnection' });
				if (result.ok) {
					await joplin.views.dialogs.showMessageBox('✓ LLM connection successful!');
				} else {
					await joplin.views.dialogs.showMessageBox(`✗ LLM connection failed: ${result.error || 'Unknown error'}`);
				}
			},
		});

		await joplin.commands.register({
			name: 'firiter.rebuildIndex',
			label: 'FiRiter: Rebuild RAG Index',
			iconName: 'fas fa-sync',
			execute: async () => {
				const project = await getActiveProject();
				if (!project) {
					await joplin.views.dialogs.showMessageBox('No active project. Create a project first.');
					return;
				}
				const result = await ragBuilder.fullBuild(project);
				await joplin.views.dialogs.showMessageBox(`RAG index rebuilt: ${result.indexed} notes indexed, ${result.errors} errors.`);
			},
		});

		// ---- Register toolbar button ----
		await joplin.views.toolbarButtons.create(
			'firiter-toolbar-toggle',
			'firiter.toggleSidebar',
			ToolbarButtonLocation.NoteToolbar,
		);

		// ---- Register menu items ----
		await joplin.views.menuItems.create(
			'firiter-menu-toggle',
			'firiter.toggleSidebar',
			MenuItemLocation.Tools,
		);

		await joplin.views.menuItems.create(
			'firiter-menu-storyboard',
			'firiter.openStoryboard',
			MenuItemLocation.Tools,
		);

		await joplin.views.menuItems.create(
			'firiter-menu-test-connection',
			'firiter.testConnection',
			MenuItemLocation.Tools,
		);

		await joplin.views.menuItems.create(
			'firiter-menu-rebuild-index',
			'firiter.rebuildIndex',
			MenuItemLocation.Tools,
		);

		// ---- React to settings changes ----
		await joplin.settings.onChange(async (event: any) => {
			const llmKeys = [
				SETTING_KEYS.llmBaseUrl,
				SETTING_KEYS.llmApiKey,
				SETTING_KEYS.llmModel,
				SETTING_KEYS.embeddingEndpoint,
				SETTING_KEYS.embeddingModel,
			];

			const llmKeyStrings: string[] = llmKeys;
			const hasLLMChange = event.keys.some((k: string) => llmKeyStrings.includes(k));
			if (hasLLMChange) {
				const newSettings = await getSettingValues();
				if (newSettings.llmBaseUrl && newSettings.llmModel) {
					llmProvider.configure({
						baseUrl: newSettings.llmBaseUrl,
						apiKey: newSettings.llmApiKey || undefined,
						model: newSettings.llmModel,
						embeddingEndpoint: newSettings.embeddingEndpoint || undefined,
						embeddingModel: newSettings.embeddingModel || undefined,
					});
					console.info('[FiRiter] LLM provider reconfigured');
				}
			}
		});

		// ---- Auto-save KG periodically ----
		setInterval(async () => {
			try {
				await kgManager.save();
			} catch (err: any) {
				console.error(`[FiRiter] Auto-save failed: ${err.message}`);
			}
		}, 60000); // Save every 60 seconds if dirty

		// ---- Incremental RAG update periodically ----
		setInterval(async () => {
			const project = await getActiveProject();
			if (project && !ragBuilder.isBuilding) {
				try {
					await ragBuilder.incrementalUpdate(project);
				} catch (err: any) {
					console.error(`[FiRiter] RAG incremental update failed: ${err.message}`);
				}
			}
		}, 120000); // Check for note changes every 2 minutes

		console.info('[FiRiter] Plugin started successfully.');
	},
});
