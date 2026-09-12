import { useCallback, useEffect, useRef, useState } from "react";
import { WifiOff } from "lucide-react";
import { appStore, type RightPanelTab, type WorkspaceMode } from "../stores/app-store.js";
import { settingsStore } from "../stores/settings-store.js";
import { sessionsStore } from "../stores/sessions-store.js";
import { workspacesStore } from "../stores/workspaces-store.js";
import { useStoreSnapshot } from "./hooks.js";
import { ChatCenter } from "./ChatCenter.js";
import { SessionSidebar } from "./SessionSidebar.js";
import { WorkspacePanel } from "./WorkspacePanel.js";
import { SettingsOverlay } from "./settings/SettingsOverlay.js";

/** Breakpoint below which sidebars auto-collapse */
const SIDEBAR_COLLAPSE_BP = 960;
const WORKSPACE_COLLAPSE_BP = 820;

/**
 * Passive "you're offline" hint, app-wide (not chat-specific — losing the
 * network affects the terminal, wiki saves, uploads, etc., not just chat).
 *
 * navigator.onLine / the online-offline events only reflect whether the
 * network *interface* is up, not whether the server is reachable — they can
 * false-positive as "online" behind a captive portal or a dead upstream link.
 * That's why this is deliberately just a hint, not a gate: it never blocks or
 * skips a request. The authoritative signal for "did this specific action
 * fail" is still each request's own try/catch (see ChatCenter's ErrorBlock),
 * which this doesn't replace. This only covers the complementary case the
 * per-request handling can't: telling the user *before* they act that the
 * interface itself just dropped.
 */
function OfflineBanner() {
	const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);

	useEffect(() => {
		const onOffline = () => setOffline(true);
		const onOnline = () => setOffline(false);
		window.addEventListener("offline", onOffline);
		window.addEventListener("online", onOnline);
		return () => {
			window.removeEventListener("offline", onOffline);
			window.removeEventListener("online", onOnline);
		};
	}, []);

	if (!offline) return null;
	return (
		<div className="fixed inset-x-0 top-0 z-[200] flex items-center justify-center gap-1.5 bg-[var(--inno-danger-bg)] px-3 py-1 text-xs text-[var(--inno-danger)]">
			<WifiOff size={14} />
			网络连接已断开，部分功能可能无法使用
		</div>
	);
}

let initializationPromise: Promise<void> | null = null;

function initializeApp(): Promise<void> {
	if (initializationPromise) return initializationPromise;
	initializationPromise = (async () => {
		await Promise.all([sessionsStore.load(), workspacesStore.load()]);
		const requestedSession = new URL(window.location.href).searchParams.get("session");
		if (requestedSession) await sessionsStore.openSession(requestedSession, { historyMode: "none" });
	})();
	return initializationPromise;
}

export function App() {
	const app = useStoreSnapshot(appStore, () => ({
		rightPanelTab: appStore.rightPanelTab,
		sidebarCollapsed: appStore.sidebarCollapsed,
		sidebarWidth: appStore.sidebarWidth,
		workspaceMode: appStore.workspaceMode,
		workspaceWidth: appStore.workspaceWidth,
	}));

	useEffect(() => {
		void initializeApp();
		const onPopState = () => {
			const sessionId = new URL(window.location.href).searchParams.get("session");
			if (!sessionId) sessionsStore.showWelcomeFromHistory();
			else if (sessionId !== sessionsStore.currentSessionId) void sessionsStore.openSession(sessionId, { historyMode: "none" });
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	// Load settings once at boot so Simple Mode (tab hiding, preset cards) is
	// available app-wide before the user ever opens the Settings panel.
	useEffect(() => {
		void settingsStore.load();
	}, []);

	// Track whether user manually toggled the sidebar so we don't fight them
	const userExpandedSidebar = useRef(false);
	const userExpandedWorkspace = useRef(false);

	// Auto-collapse left sidebar when viewport narrows
	useEffect(() => {
		const mql = window.matchMedia(`(max-width: ${SIDEBAR_COLLAPSE_BP}px)`);
		const handler = (e: MediaQueryListEvent | MediaQueryList) => {
			if (e.matches) {
				// Narrow: collapse if expanded
				if (!appStore.sidebarCollapsed) {
					userExpandedSidebar.current = false;
					appStore.setSidebarCollapsed(true);
				}
			} else {
				// Wide: restore if not manually collapsed
				if (appStore.sidebarCollapsed && !userExpandedSidebar.current) {
					appStore.setSidebarCollapsed(false);
				}
			}
		};
		handler(mql);
		mql.addEventListener("change", handler);
		return () => mql.removeEventListener("change", handler);
	}, []);

	// Auto-collapse right workspace panel when viewport narrows
	useEffect(() => {
		const mql = window.matchMedia(`(max-width: ${WORKSPACE_COLLAPSE_BP}px)`);
		const handler = (e: MediaQueryListEvent | MediaQueryList) => {
			if (e.matches) {
				if (appStore.workspaceMode === "half") {
					userExpandedWorkspace.current = false;
					appStore.setWorkspaceMode("collapsed");
				}
			} else {
				if (appStore.workspaceMode === "collapsed" && !userExpandedWorkspace.current) {
					// Don't auto-expand workspace — it starts collapsed by default
				}
			}
		};
		handler(mql);
		mql.addEventListener("change", handler);
		return () => mql.removeEventListener("change", handler);
	}, []);

	const setTab = useCallback((tab: RightPanelTab) => appStore.setRightPanelTab(tab), []);
	const setSidebarWidth = useCallback((width: number) => appStore.setSidebarWidth(width), []);
	const setWorkspaceMode = useCallback((mode: WorkspaceMode) => {
		userExpandedWorkspace.current = mode !== "collapsed";
		appStore.setWorkspaceMode(mode);
	}, []);
	const setWorkspaceWidth = useCallback((width: number) => appStore.setWorkspaceWidth(width), []);

	return (
		<>
			<OfflineBanner />
			<div
				className={`app-layout app-layout--sidebar-${app.sidebarCollapsed ? "collapsed" : "expanded"} app-layout--workspace-${app.workspaceMode}`}
				style={{ "--inno-sidebar-width": `${app.sidebarWidth}px`, "--inno-workspace-width": `${app.workspaceWidth}px` } as React.CSSProperties}
			>
				<SessionSidebar collapsed={app.sidebarCollapsed} width={app.sidebarWidth} onWidthChange={setSidebarWidth} />
				<ChatCenter />
				<WorkspacePanel
					activeTab={app.rightPanelTab}
					mode={app.workspaceMode}
					width={app.workspaceWidth}
					onTabChange={setTab}
					onModeChange={setWorkspaceMode}
					onWidthChange={setWorkspaceWidth}
				/>
			</div>
			<SettingsOverlay />
		</>
	);
}
