import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Coins } from "lucide-react";
import type { ChatUsageCall } from "../../types/chat.js";
import { settingsStore } from "../../stores/settings-store.js";
import { useStoreSnapshot } from "../hooks.js";
import { PopoverSurface } from "../ui/PopoverSurface.js";

interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: number;
}

function sumUsage(calls: ChatUsageCall[]): UsageTotals {
	return calls.reduce<UsageTotals>(
		(acc, call) => ({
			input: acc.input + call.input,
			output: acc.output + call.output,
			cacheRead: acc.cacheRead + call.cacheRead,
			cacheWrite: acc.cacheWrite + call.cacheWrite,
			totalTokens: acc.totalTokens + call.totalTokens,
			cost: acc.cost + call.cost,
		}),
		{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
	);
}

function formatCompactTokens(value: number, locale: string): string {
	return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatTokens(value: number, locale: string): string {
	return new Intl.NumberFormat(locale).format(value);
}

function formatCost(value: number, locale: string): string {
	return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value);
}

/**
 * Per-turn token usage badge, opt-in via Settings → Lab (`ui.showTokenUsage`,
 * off by default). Sums every underlying LLM call folded into this bubble
 * (a tool-use loop can span several) into a compact chip; clicking it opens a
 * per-call breakdown covering whichever provider/model actually answered.
 */
export function UsageBadge({ usageCalls }: { usageCalls?: ChatUsageCall[] }) {
	const { t, i18n } = useTranslation();
	const showTokenUsage = useStoreSnapshot(settingsStore, () => settingsStore.settings?.ui?.showTokenUsage === true);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const panelRef = useRef<HTMLDivElement | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [open, setOpen] = useState(false);
	const [position, setPosition] = useState({ left: 8, top: 8 });

	useLayoutEffect(() => {
		if (!open) return;
		const reposition = () => {
			const trigger = triggerRef.current;
			const panel = panelRef.current;
			if (!trigger || !panel) return;
			const margin = 8;
			const triggerRect = trigger.getBoundingClientRect();
			const width = panel.offsetWidth;
			const height = panel.offsetHeight;
			const left = Math.max(margin, Math.min(triggerRect.left, window.innerWidth - width - margin));
			const top = Math.max(margin, Math.min(triggerRect.bottom + 6, window.innerHeight - height - margin));
			setPosition((previous) => (previous.left === left && previous.top === top ? previous : { left, top }));
		};
		reposition();
		window.addEventListener("resize", reposition);
		document.addEventListener("scroll", reposition, true);
		return () => {
			window.removeEventListener("resize", reposition);
			document.removeEventListener("scroll", reposition, true);
		};
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (containerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
			setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	if (!showTokenUsage || !usageCalls || usageCalls.length === 0) return null;

	const totals = sumUsage(usageCalls);
	const locale = i18n.language;
	const badgeLabel = t("chat.usage.badgeLabel", { value: formatTokens(totals.totalTokens, locale) });

	return (
		<div ref={containerRef} className="contents">
			<button
				type="button"
				ref={triggerRef}
				className="inno-message-action inno-usage-badge"
				title={badgeLabel}
				aria-label={badgeLabel}
				aria-haspopup="dialog"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
			>
				<Coins size={13} />
				<span>{formatCompactTokens(totals.totalTokens, locale)}</span>
			</button>
			{open && typeof document !== "undefined" ? createPortal(
				<PopoverSurface
					ref={panelRef}
					role="dialog"
					aria-label={t("chat.usage.panelTitle")}
					className="inno-smart-panel inno-smart-panel--status inno-usage-panel"
					style={{ position: "fixed", left: position.left, top: position.top, zIndex: 100 }}
				>
					<div className="inno-smart-panel-title">{t("chat.usage.panelTitle")}</div>
					<div className="inno-usage-panel-list">
						{usageCalls.map((call, index) => (
							<div key={index} className="inno-usage-panel-row">
								<div className="inno-usage-panel-model">
									{[call.provider, call.responseModel ?? call.model].filter(Boolean).join(" · ") || "—"}
								</div>
								<div className="inno-usage-panel-metrics">
									<span>{t("chat.usage.input")}: {formatTokens(call.input, locale)}</span>
									<span>{t("chat.usage.output")}: {formatTokens(call.output, locale)}</span>
									{call.cacheRead > 0 ? <span>{t("chat.usage.cacheRead")}: {formatTokens(call.cacheRead, locale)}</span> : null}
									{call.cacheWrite > 0 ? <span>{t("chat.usage.cacheWrite")}: {formatTokens(call.cacheWrite, locale)}</span> : null}
									<span>{t("chat.usage.total")}: {formatTokens(call.totalTokens, locale)}</span>
									{call.cost > 0 ? <span>{t("chat.usage.cost")}: {formatCost(call.cost, locale)}</span> : null}
								</div>
							</div>
						))}
					</div>
					{usageCalls.length > 1 ? (
						<div className="inno-smart-panel-caption">
							{t("chat.usage.callsTotal", { count: usageCalls.length })}
							{" · "}
							{formatTokens(totals.totalTokens, locale)}
							{totals.cost > 0 ? ` · ${formatCost(totals.cost, locale)}` : ""}
						</div>
					) : null}
				</PopoverSurface>,
				document.body,
			) : null}
		</div>
	);
}
