/**
 * Sidebar panel webview script.
 * Runs inside the Joplin panel webview (sandboxed browser context).
 * Communicates with the plugin backend via webviewApi.postMessage().
 */

// State
let state = {
	connected: false,
	activeProject: null,
	projects: [],
	pinnedCards: [],
	workflowStatus: 'idle', // idle | running | paused | completed | error
	workflowName: '',
};

function render() {
	const container = document.getElementById('sidebar-root');
	if (!container) return;

	const projectName = state.activeProject ? state.activeProject.name : 'No project';
	const connectionClass = state.connected ? 'connected' : 'disconnected';
	const connectionLabel = state.connected ? 'Connected' : 'Not connected';

	let pinnedCardsHtml = '';
	if (state.pinnedCards.length > 0) {
		pinnedCardsHtml = state.pinnedCards.map(function(card) {
			return '<div class="pinned-card" data-card-id="' + card.id + '">' +
				'<span class="card-type-badge ' + card.type + '">' + card.type.substring(0, 3) + '</span>' +
				'<span>' + escapeHtml(card.name) + '</span>' +
				'</div>';
		}).join('');
	} else {
		pinnedCardsHtml = '<div class="empty-state">No pinned cards. Open the storyboard to pin cards.</div>';
	}

	let workflowHtml = '';
	if (state.workflowStatus === 'running') {
		workflowHtml = '<div class="workflow-status">' +
			'<div class="spinner"></div>' +
			'<span>Running: ' + escapeHtml(state.workflowName) + '</span>' +
			'</div>';
	} else if (state.workflowStatus === 'paused') {
		workflowHtml = '<div class="workflow-status">' +
			'<span style="color: var(--warning);">⏸</span>' +
			'<span>Paused: ' + escapeHtml(state.workflowName) + ' (awaiting review)</span>' +
			'</div>';
	}

	container.innerHTML =
		'<div class="sidebar-container">' +
			// Header
			'<div class="sidebar-header">' +
				'<h1>FiRiter</h1>' +
				'<span class="project-badge">' + escapeHtml(projectName) + '</span>' +
			'</div>' +

			// Connection status
			'<div class="sidebar-section">' +
				'<div class="sidebar-section-title">LLM Connection</div>' +
				'<div style="display:flex;align-items:center;gap:6px;padding:2px 0;">' +
					'<span class="status-dot ' + connectionClass + '"></span>' +
					'<span style="font-size:11px;">' + connectionLabel + '</span>' +
				'</div>' +
			'</div>' +

			// Quick actions
			'<div class="sidebar-section">' +
				'<div class="sidebar-section-title">Quick Actions</div>' +
				'<button class="btn" id="btn-storyboard">📋 Open Storyboard</button>' +
				'<button class="btn" id="btn-workflow">⚡ Run Work Mode</button>' +
				'<button class="btn" id="btn-projects">📁 Manage Projects</button>' +
				'<button class="btn btn-sm" id="btn-test-connection">🔌 Test Connection</button>' +
			'</div>' +

			// Workflow status
			(workflowHtml ? '<div class="sidebar-section">' +
				'<div class="sidebar-section-title">Active Workflow</div>' +
				workflowHtml +
			'</div>' : '') +

			// Pinned cards
			'<div class="sidebar-section" style="flex:1;overflow:hidden;">' +
				'<div class="sidebar-section-title">Pinned Context</div>' +
				'<div class="pinned-cards">' + pinnedCardsHtml + '</div>' +
			'</div>' +
		'</div>';

	// Bind event listeners
	bindEvents();
}

function bindEvents() {
	var btnStoryboard = document.getElementById('btn-storyboard');
	if (btnStoryboard) {
		btnStoryboard.onclick = function() {
			webviewApi.postMessage({ type: 'openStoryboard' });
		};
	}

	var btnWorkflow = document.getElementById('btn-workflow');
	if (btnWorkflow) {
		btnWorkflow.onclick = function() {
			webviewApi.postMessage({ type: 'openWorkflowPicker' });
		};
	}

	var btnProjects = document.getElementById('btn-projects');
	if (btnProjects) {
		btnProjects.onclick = function() {
			webviewApi.postMessage({ type: 'openProjectManager' });
		};
	}

	var btnTestConnection = document.getElementById('btn-test-connection');
	if (btnTestConnection) {
		btnTestConnection.onclick = function() {
			webviewApi.postMessage({ type: 'testConnection' });
		};
	}
}

function escapeHtml(str) {
	if (!str) return '';
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Listen for messages from the plugin backend
webviewApi.onMessage(function(message) {
	if (message && message.type === 'updateState') {
		Object.assign(state, message.payload);
		render();
	}
});

// Initial render
render();

// Request initial state from plugin
webviewApi.postMessage({ type: 'getState' });
