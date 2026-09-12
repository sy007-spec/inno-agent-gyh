import { describe, expect, it } from "vitest";
import {
	classifyExtension,
	DEFAULT_ATTACHMENT_LIMITS,
	describeRejection,
	filterInlineImages,
	validateAttachment,
	type AttachmentValidationContext,
	type AttachmentValidationFail,
} from "./attachment-policy.js";

const noContext: AttachmentValidationContext = {
	imagesInMessage: 0,
	attachmentsInMessage: 0,
	attachmentBytesInMessage: 0,
	attachmentsInSession: 0,
};

describe("classifyExtension", () => {
	it("classifies A-tier images and B-tier documents", () => {
		expect(classifyExtension("photo.PNG")).toEqual({ tier: "A", kind: "image" });
		expect(classifyExtension("report.docx")).toEqual({ tier: "B", kind: "document" });
	});

	it("classifies C-tier archives and D-tier unknown/dangerous types", () => {
		expect(classifyExtension("bundle.zip")).toEqual({ tier: "C", kind: "archive" });
		expect(classifyExtension("installer.exe")).toEqual({ tier: "D", kind: "unknown" });
		expect(classifyExtension("no-extension")).toEqual({ tier: "D", kind: "unknown" });
	});
});

describe("validateAttachment", () => {
	it("rejects a D-tier extension with the workspace-reference alternative action", () => {
		const result = validateAttachment({ name: "virus.exe", size: 100 }, DEFAULT_ATTACHMENT_LIMITS, noContext);
		expect(result.ok).toBe(false);
		const fail = result as AttachmentValidationFail;
		expect(fail.rule).toBe("type-not-supported");
		expect(fail.alternativeAction).toContain("工作区");
	});

	it("accepts an image under the size limit", () => {
		const result = validateAttachment({ name: "photo.png", size: 1024 }, DEFAULT_ATTACHMENT_LIMITS, noContext);
		expect(result).toEqual({ ok: true, tier: "A", kind: "image" });
	});

	it("rejects an image over maxImageBytes", () => {
		const result = validateAttachment(
			{ name: "huge.png", size: DEFAULT_ATTACHMENT_LIMITS.maxImageBytes + 1 },
			DEFAULT_ATTACHMENT_LIMITS,
			noContext,
		);
		expect(result.ok).toBe(false);
		expect((result as AttachmentValidationFail).rule).toBe("image-too-large");
	});

	it("rejects the 6th image in one message (maxImagesPerMessage)", () => {
		const context: AttachmentValidationContext = { ...noContext, imagesInMessage: DEFAULT_ATTACHMENT_LIMITS.maxImagesPerMessage };
		const result = validateAttachment({ name: "photo.png", size: 100 }, DEFAULT_ATTACHMENT_LIMITS, context);
		expect(result.ok).toBe(false);
		expect((result as AttachmentValidationFail).rule).toBe("too-many-images");
	});

	it("rejects a document over maxDocumentBytes", () => {
		const result = validateAttachment(
			{ name: "report.docx", size: DEFAULT_ATTACHMENT_LIMITS.maxDocumentBytes + 1 },
			DEFAULT_ATTACHMENT_LIMITS,
			noContext,
		);
		expect(result.ok).toBe(false);
		expect((result as AttachmentValidationFail).rule).toBe("document-too-large");
	});

	it("rejects an archive over maxArchiveBytes", () => {
		const result = validateAttachment(
			{ name: "bundle.zip", size: DEFAULT_ATTACHMENT_LIMITS.maxArchiveBytes + 1 },
			DEFAULT_ATTACHMENT_LIMITS,
			noContext,
		);
		expect(result.ok).toBe(false);
		expect((result as AttachmentValidationFail).rule).toBe("archive-too-large");
	});

	it("rejects the 11th attachment in one message (maxAttachmentsPerMessage)", () => {
		const context: AttachmentValidationContext = { ...noContext, attachmentsInMessage: DEFAULT_ATTACHMENT_LIMITS.maxAttachmentsPerMessage };
		const result = validateAttachment({ name: "notes.txt", size: 10 }, DEFAULT_ATTACHMENT_LIMITS, context);
		expect(result.ok).toBe(false);
		expect((result as AttachmentValidationFail).rule).toBe("too-many-attachments");
	});

	it("rejects when the running message byte total would exceed maxAttachmentBytesPerMessage", () => {
		const context: AttachmentValidationContext = { ...noContext, attachmentBytesInMessage: DEFAULT_ATTACHMENT_LIMITS.maxAttachmentBytesPerMessage - 10 };
		const result = validateAttachment({ name: "notes.txt", size: 20 }, DEFAULT_ATTACHMENT_LIMITS, context);
		expect(result.ok).toBe(false);
		expect((result as AttachmentValidationFail).rule).toBe("message-attachments-too-large");
	});

	it("rejects once the session's cumulative attachment count is exhausted", () => {
		const context: AttachmentValidationContext = { ...noContext, attachmentsInSession: DEFAULT_ATTACHMENT_LIMITS.maxAttachmentsPerSession };
		const result = validateAttachment({ name: "notes.txt", size: 10 }, DEFAULT_ATTACHMENT_LIMITS, context);
		expect(result.ok).toBe(false);
		expect((result as AttachmentValidationFail).rule).toBe("session-attachments-exceeded");
	});
});

describe("describeRejection", () => {
	it("renders all four required elements: filename, rule, limit, alternative action", () => {
		const fail = validateAttachment({ name: "virus.exe", size: 100 }, DEFAULT_ATTACHMENT_LIMITS, noContext) as AttachmentValidationFail;
		const message = describeRejection(fail);
		expect(message).toContain("virus.exe");
		expect(message).toContain(fail.limitValue);
		expect(message).toContain(fail.alternativeAction);
	});
});

describe("filterInlineImages", () => {
	function base64OfLength(bytes: number): string {
		return "A".repeat(Math.ceil((bytes * 4) / 3));
	}

	it("accepts images within size and count limits", () => {
		const images = [{ data: base64OfLength(1024) }, { data: base64OfLength(2048) }];
		const { accepted, rejectedCount } = filterInlineImages(images, DEFAULT_ATTACHMENT_LIMITS);
		expect(accepted).toHaveLength(2);
		expect(rejectedCount).toBe(0);
	});

	it("rejects an oversized inline image by decoded byte length", () => {
		const images = [{ data: base64OfLength(DEFAULT_ATTACHMENT_LIMITS.maxImageBytes + 1024) }];
		const { accepted, rejectedCount } = filterInlineImages(images, DEFAULT_ATTACHMENT_LIMITS);
		expect(accepted).toHaveLength(0);
		expect(rejectedCount).toBe(1);
	});

	it("rejects images beyond maxImagesPerMessage even if each is individually small", () => {
		const images = Array.from({ length: DEFAULT_ATTACHMENT_LIMITS.maxImagesPerMessage + 2 }, () => ({ data: base64OfLength(100) }));
		const { accepted, rejectedCount } = filterInlineImages(images, DEFAULT_ATTACHMENT_LIMITS);
		expect(accepted).toHaveLength(DEFAULT_ATTACHMENT_LIMITS.maxImagesPerMessage);
		expect(rejectedCount).toBe(2);
	});
});
