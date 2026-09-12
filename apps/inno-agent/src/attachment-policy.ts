import { extname } from "node:path";

/**
 * Chat-message attachment business rules — BRD "InnoAgent 附件类型与上传业务规则" v1.0
 * (2026-09-12). Governs ONLY the chat composer's three entry points (upload button,
 * drag-drop, paste) — the general workspace file browser's own upload/drag-drop stays
 * unrestricted by design (§R2: the two channels are governed separately).
 *
 * This is the server-side source of truth. The frontend mirror
 * (apps/inno-agent/web/src/utils/attachment-policy.ts) duplicates the same tables — the
 * two workspaces don't share a build graph, so keep them in sync by inspection when
 * either changes. The server's checks here are authoritative (§R4); the frontend's copy
 * only exists to reject obviously-bad files before a byte is ever uploaded (§R3).
 */

export type AttachmentTier = "A" | "B" | "C" | "D";
export type AttachmentKind = "image" | "pdf" | "text" | "document" | "archive" | "audio" | "video" | "unknown";

interface ExtensionInfo {
	tier: AttachmentTier;
	kind: AttachmentKind;
}

/**
 * A/B/C tables per BRD §5. Anything not listed here is D-tier (rejected) by the
 * `classifyExtension` fallback — there's no need to enumerate D explicitly, but for
 * documentation the BRD's examples are: executables/scripts (.exe .dll .bat .cmd .sh .app
 * .dmg .msi .jar .ps1), disk/system images (.iso .img .vhd), and non-multimodal binaries
 * without text content (.psd .ai .class .o .so).
 */
const EXTENSION_TABLE: Record<string, ExtensionInfo> = {
	// A — images (full multimodal support)
	".png": { tier: "A", kind: "image" },
	".jpg": { tier: "A", kind: "image" },
	".jpeg": { tier: "A", kind: "image" },
	".webp": { tier: "A", kind: "image" },
	".gif": { tier: "A", kind: "image" },
	// A — PDF
	".pdf": { tier: "A", kind: "pdf" },
	// A — text / code (representative set; anything else falls to D deliberately —
	// the BRD asks for a whitelist, not "any text-looking extension")
	".txt": { tier: "A", kind: "text" },
	".md": { tier: "A", kind: "text" },
	".py": { tier: "A", kind: "text" },
	".js": { tier: "A", kind: "text" },
	".mjs": { tier: "A", kind: "text" },
	".cjs": { tier: "A", kind: "text" },
	".ts": { tier: "A", kind: "text" },
	".tsx": { tier: "A", kind: "text" },
	".jsx": { tier: "A", kind: "text" },
	".java": { tier: "A", kind: "text" },
	".go": { tier: "A", kind: "text" },
	".rs": { tier: "A", kind: "text" },
	".c": { tier: "A", kind: "text" },
	".cpp": { tier: "A", kind: "text" },
	".h": { tier: "A", kind: "text" },
	".html": { tier: "A", kind: "text" },
	".htm": { tier: "A", kind: "text" },
	".css": { tier: "A", kind: "text" },
	".sql": { tier: "A", kind: "text" },
	".sh": { tier: "A", kind: "text" },
	".bash": { tier: "A", kind: "text" },
	// B — office documents (degraded: text-only extraction, no layout/embedded images)
	".docx": { tier: "B", kind: "document" },
	".doc": { tier: "B", kind: "document" },
	".xlsx": { tier: "B", kind: "document" },
	".xls": { tier: "B", kind: "document" },
	".csv": { tier: "B", kind: "document" },
	".tsv": { tier: "B", kind: "document" },
	".pptx": { tier: "B", kind: "document" },
	".ppt": { tier: "B", kind: "document" },
	// B — structured data (pass through as text)
	".json": { tier: "B", kind: "document" },
	".xml": { tier: "B", kind: "document" },
	".yaml": { tier: "B", kind: "document" },
	".yml": { tier: "B", kind: "document" },
	".toml": { tier: "B", kind: "document" },
	".ini": { tier: "B", kind: "document" },
	".log": { tier: "B", kind: "document" },
	".har": { tier: "B", kind: "document" },
	// C — supplementary image formats (subject to the model's actual multimodal support)
	".bmp": { tier: "C", kind: "image" },
	".svg": { tier: "C", kind: "image" },
	".heic": { tier: "C", kind: "image" },
	".heif": { tier: "C", kind: "image" },
	// C — audio (subject to the model's actual audio-input support — see attachment
	// validation's model-capability check; no model in this codebase declares audio
	// input today, so these are effectively unreachable until one does)
	".mp3": { tier: "C", kind: "audio" },
	".wav": { tier: "C", kind: "audio" },
	".aac": { tier: "C", kind: "audio" },
	".flac": { tier: "C", kind: "audio" },
	".ogg": { tier: "C", kind: "audio" },
	".aiff": { tier: "C", kind: "audio" },
	// C — video (same model-capability caveat as audio)
	".mp4": { tier: "C", kind: "video" },
	".webm": { tier: "C", kind: "video" },
	// C — archives (contents re-classified per entry by the caller; see zip-inspect.ts)
	".zip": { tier: "C", kind: "archive" },
	".rar": { tier: "C", kind: "archive" },
};

export function classifyExtension(filename: string): ExtensionInfo {
	const ext = extname(filename).toLowerCase();
	return EXTENSION_TABLE[ext] ?? { tier: "D", kind: "unknown" };
}

export interface InnoAttachmentLimitsConfig {
	maxImageBytes: number;
	maxImagesPerMessage: number;
	maxDocumentBytes: number;
	maxArchiveBytes: number;
	maxArchiveEntries: number;
	maxArchiveExtractedBytes: number;
	maxAttachmentsPerMessage: number;
	maxAttachmentBytesPerMessage: number;
	maxAttachmentsPerSession: number;
}

/** BRD §R6 default limits — admin-editable via Settings / config.json, see config.ts. */
export const DEFAULT_ATTACHMENT_LIMITS: InnoAttachmentLimitsConfig = {
	maxImageBytes: 15 * 1024 * 1024,
	maxImagesPerMessage: 5,
	maxDocumentBytes: 30 * 1024 * 1024,
	maxArchiveBytes: 100 * 1024 * 1024,
	maxArchiveEntries: 500,
	maxArchiveExtractedBytes: 300 * 1024 * 1024,
	maxAttachmentsPerMessage: 10,
	maxAttachmentBytesPerMessage: 50 * 1024 * 1024,
	maxAttachmentsPerSession: 20,
};

export type AttachmentRejectionRule =
	| "type-not-supported"
	| "format-mismatch"
	| "image-too-large"
	| "document-too-large"
	| "archive-too-large"
	| "too-many-images"
	| "too-many-attachments"
	| "message-attachments-too-large"
	| "session-attachments-exceeded";

export interface AttachmentValidationOk {
	ok: true;
	tier: AttachmentTier;
	kind: AttachmentKind;
}

export interface AttachmentValidationFail {
	ok: false;
	fileName: string;
	rule: AttachmentRejectionRule;
	/** Human-readable limit value for the rejection message's third element, e.g. "15MB" or "5 张". */
	limitValue: string;
	/** The rejection message's fourth element — always a concrete next step, never a dead end. */
	alternativeAction: string;
}

export type AttachmentValidationResult = AttachmentValidationOk | AttachmentValidationFail;

export interface AttachmentValidationContext {
	imagesInMessage: number;
	attachmentsInMessage: number;
	attachmentBytesInMessage: number;
	attachmentsInSession: number;
}

/** Exported for zip-inspect.ts's archive-rejection formatter — same "NNMB" shape used here. */
export function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))}MB`;
	if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
	return `${bytes}B`;
}

const TO_WORKSPACE = "该类型/大小不支持作为对话附件，可改为通过工作区文件浏览器上传，再在对话中引用该文件";

function fail(fileName: string, rule: AttachmentRejectionRule, limitValue: string, alternativeAction: string): AttachmentValidationFail {
	return { ok: false, fileName, rule, limitValue, alternativeAction };
}

/**
 * §R4's "real-format check": the file's magic bytes don't match what its extension
 * claims (e.g. an .exe renamed to .png). Built here (not in `verifyRealFormat`,
 * utils/sniff-format.ts) so it goes through the same `AttachmentValidationFail` shape
 * and `describeRejection()` renderer as every other rejection.
 */
export function formatMismatchRejection(fileName: string): AttachmentValidationFail {
	return fail(fileName, "format-mismatch", "—", "文件内容与扩展名不匹配，请确认文件未被重命名或损坏后重试，或改为上传到工作区");
}

/**
 * Validate one attachment against the BRD's rules and the caller's current
 * message/session counts. Pure and synchronous — archive *contents* (entry count,
 * extracted size, zip-slip/symlink entries) need the file's actual bytes and are
 * checked separately by `inspectArchive` (zip-inspect.ts) once the archive itself
 * passes this size/count gate.
 */
export function validateAttachment(
	file: { name: string; size: number },
	limits: InnoAttachmentLimitsConfig,
	context: AttachmentValidationContext,
): AttachmentValidationResult {
	const { tier, kind } = classifyExtension(file.name);

	if (tier === "D") {
		return fail(file.name, "type-not-supported", "—", TO_WORKSPACE);
	}

	if (kind === "image") {
		if (file.size > limits.maxImageBytes) {
			return fail(file.name, "image-too-large", formatBytes(limits.maxImageBytes), "请压缩图片或降低分辨率后重试，或改为上传到工作区");
		}
		if (context.imagesInMessage >= limits.maxImagesPerMessage) {
			return fail(file.name, "too-many-images", `${limits.maxImagesPerMessage} 张`, "请先发送当前这些图片，再用新消息补充剩余图片");
		}
	} else if (kind === "document" || kind === "pdf" || kind === "text") {
		if (file.size > limits.maxDocumentBytes) {
			return fail(file.name, "document-too-large", formatBytes(limits.maxDocumentBytes), "请拆分文件后重试，或改为上传到工作区后引用");
		}
	} else if (kind === "archive") {
		if (file.size > limits.maxArchiveBytes) {
			return fail(file.name, "archive-too-large", formatBytes(limits.maxArchiveBytes), "请精简压缩包内容后重试，或改为上传到工作区");
		}
	}

	if (context.attachmentsInMessage >= limits.maxAttachmentsPerMessage) {
		return fail(file.name, "too-many-attachments", `${limits.maxAttachmentsPerMessage} 个`, "请先发送当前附件，再用新消息补充剩余文件");
	}
	if (context.attachmentBytesInMessage + file.size > limits.maxAttachmentBytesPerMessage) {
		return fail(file.name, "message-attachments-too-large", formatBytes(limits.maxAttachmentBytesPerMessage), "请分多条消息发送，或改为上传到工作区后引用");
	}
	if (context.attachmentsInSession >= limits.maxAttachmentsPerSession) {
		return fail(file.name, "session-attachments-exceeded", `${limits.maxAttachmentsPerSession} 个`, "请新建一个会话继续上传，或改为上传到工作区");
	}

	return { ok: true, tier, kind };
}

const RULE_LABELS: Record<AttachmentRejectionRule, string> = {
	"type-not-supported": "不在支持的附件类型范围内",
	"format-mismatch": "文件真实格式与扩展名不符",
	"image-too-large": "图片超出单张大小上限",
	"document-too-large": "文档超出单个文件大小上限",
	"archive-too-large": "压缩包超出大小上限",
	"too-many-images": "本条消息图片数量已达上限",
	"too-many-attachments": "本条消息附件数量已达上限",
	"message-attachments-too-large": "本条消息附件总大小已达上限",
	"session-attachments-exceeded": "本会话累计附件数量已达上限",
};

/** Four-element rejection line (§6.2: filename, rule, limit, alternative action)
 * for server-side rejections surfaced via the `/api/workspace/upload` response's
 * `failed` array — mirrors the frontend's own `formatRejectionMessage`. */
export function describeRejection(result: AttachmentValidationFail): string {
	return `${result.fileName}：${RULE_LABELS[result.rule]}（限制：${result.limitValue}）。${result.alternativeAction}`;
}

/**
 * Server-side backstop for the inline base64 images `/api/chat` and
 * `/api/chat/stream` accept directly in the request body (§R4 — the client's
 * pre-check should normally catch this first; this exists so a request that
 * bypasses the UI can't exceed the same limits). These have no filename, so
 * the per-extension checks in `validateAttachment` don't apply — only size and
 * count matter here.
 */
export function filterInlineImages<T extends { data: string }>(
	images: T[],
	limits: Pick<InnoAttachmentLimitsConfig, "maxImageBytes" | "maxImagesPerMessage">,
): { accepted: T[]; rejectedCount: number } {
	const accepted: T[] = [];
	let rejectedCount = 0;
	for (const image of images) {
		if (accepted.length >= limits.maxImagesPerMessage) {
			rejectedCount += 1;
			continue;
		}
		// Exact decoded byte length from a base64 string, no need to actually decode.
		const decodedBytes = Math.floor((image.data.length * 3) / 4);
		if (decodedBytes > limits.maxImageBytes) {
			rejectedCount += 1;
			continue;
		}
		accepted.push(image);
	}
	return { accepted, rejectedCount };
}
