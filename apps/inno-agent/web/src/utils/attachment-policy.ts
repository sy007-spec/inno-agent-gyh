/**
 * Chat-message attachment business rules — BRD "InnoAgent 附件类型与上传业务规则" v1.0
 * (2026-09-12). Mirrors `apps/inno-agent/src/attachment-policy.ts` (the server-side
 * source of truth) — the two workspaces don't share a build graph, so this is a
 * deliberate duplicate, not an import. Keep the two extension tables in sync by
 * inspection when either changes.
 *
 * This client copy exists purely for fast, pre-upload feedback (§R3 — reject at
 * selection, never mid-upload): it's a UX convenience, not the authoritative check.
 * The server re-validates everything (including real magic-byte sniffing this file
 * doesn't attempt) on the actual upload/chat endpoints.
 */

export type AttachmentTier = "A" | "B" | "C" | "D";
export type AttachmentKind = "image" | "pdf" | "text" | "document" | "archive" | "audio" | "video" | "unknown";

interface ExtensionInfo {
	tier: AttachmentTier;
	kind: AttachmentKind;
}

const EXTENSION_TABLE: Record<string, ExtensionInfo> = {
	".png": { tier: "A", kind: "image" },
	".jpg": { tier: "A", kind: "image" },
	".jpeg": { tier: "A", kind: "image" },
	".webp": { tier: "A", kind: "image" },
	".gif": { tier: "A", kind: "image" },
	".pdf": { tier: "A", kind: "pdf" },
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
	".docx": { tier: "B", kind: "document" },
	".doc": { tier: "B", kind: "document" },
	".xlsx": { tier: "B", kind: "document" },
	".xls": { tier: "B", kind: "document" },
	".csv": { tier: "B", kind: "document" },
	".tsv": { tier: "B", kind: "document" },
	".pptx": { tier: "B", kind: "document" },
	".ppt": { tier: "B", kind: "document" },
	".json": { tier: "B", kind: "document" },
	".xml": { tier: "B", kind: "document" },
	".yaml": { tier: "B", kind: "document" },
	".yml": { tier: "B", kind: "document" },
	".toml": { tier: "B", kind: "document" },
	".ini": { tier: "B", kind: "document" },
	".log": { tier: "B", kind: "document" },
	".har": { tier: "B", kind: "document" },
	".bmp": { tier: "C", kind: "image" },
	".svg": { tier: "C", kind: "image" },
	".heic": { tier: "C", kind: "image" },
	".heif": { tier: "C", kind: "image" },
	".mp3": { tier: "C", kind: "audio" },
	".wav": { tier: "C", kind: "audio" },
	".aac": { tier: "C", kind: "audio" },
	".flac": { tier: "C", kind: "audio" },
	".ogg": { tier: "C", kind: "audio" },
	".aiff": { tier: "C", kind: "audio" },
	".mp4": { tier: "C", kind: "video" },
	".webm": { tier: "C", kind: "video" },
	".zip": { tier: "C", kind: "archive" },
	".rar": { tier: "C", kind: "archive" },
};

function extOf(filename: string): string {
	const i = filename.lastIndexOf(".");
	return i >= 0 ? filename.slice(i).toLowerCase() : "";
}

export function classifyExtension(filename: string): ExtensionInfo {
	return EXTENSION_TABLE[extOf(filename)] ?? { tier: "D", kind: "unknown" };
}

export interface AttachmentLimits {
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

/** Mirrors DEFAULT_ATTACHMENT_LIMITS in the backend policy file — used only until
 * the real limits arrive from GET /api/settings at app boot. */
export const DEFAULT_ATTACHMENT_LIMITS: AttachmentLimits = {
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
	limitValue: string;
	alternativeAction: string;
}

export type AttachmentValidationResult = AttachmentValidationOk | AttachmentValidationFail;

export interface AttachmentValidationContext {
	imagesInMessage: number;
	attachmentsInMessage: number;
	attachmentBytesInMessage: number;
	attachmentsInSession: number;
}

function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))}MB`;
	if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
	return `${bytes}B`;
}

const TO_WORKSPACE = "该类型/大小不支持作为对话附件，可改为通过工作区文件浏览器上传，再在对话中引用该文件";

function fail(fileName: string, rule: AttachmentRejectionRule, limitValue: string, alternativeAction: string): AttachmentValidationFail {
	return { ok: false, fileName, rule, limitValue, alternativeAction };
}

/** Client-side pre-check — same rule set and message shape as the server's
 * `validateAttachment`, called before a file ever enters `uploads`/`inlineImages`
 * state (so a rejected file never triggers an upload request at all). */
export function validateAttachmentClientSide(
	file: { name: string; size: number },
	limits: AttachmentLimits,
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
	"image-too-large": "图片超出单张大小上限",
	"document-too-large": "文档超出单个文件大小上限",
	"archive-too-large": "压缩包超出大小上限",
	"too-many-images": "本条消息图片数量已达上限",
	"too-many-attachments": "本条消息附件数量已达上限",
	"message-attachments-too-large": "本条消息附件总大小已达上限",
	"session-attachments-exceeded": "本会话累计附件数量已达上限",
};

/** Human-readable rejection line for the four-element message (§6.2):
 * filename, violated rule, limit value, alternative action. */
export function formatRejectionMessage(result: AttachmentValidationFail): string {
	return `${result.fileName}：${RULE_LABELS[result.rule]}（限制：${result.limitValue}）。${result.alternativeAction}`;
}
