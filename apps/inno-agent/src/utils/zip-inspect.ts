import * as yauzl from "yauzl";
import { formatBytes, type InnoAttachmentLimitsConfig } from "../attachment-policy.js";

/**
 * Deep-inspect a .zip archive uploaded as a chat attachment (BRD §R10): reject
 * path-traversal and symlink entries, and enforce the post-extraction entry-count/
 * total-size sub-limits — all without ever writing an entry to disk. This is
 * separate from `validateZipEntries` in server.ts (used only for `.skills/` zip
 * installs, which shells out to the system `unzip` binary) — this one uses a real
 * streaming zip parser so it can check the Unix symlink bit on each entry's
 * external file attributes, which listing filenames alone can't reveal.
 */

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

function isSymlinkEntry(entry: yauzl.Entry): boolean {
	// External file attributes only carry meaningful Unix mode bits when the
	// archive was authored on a Unix-like system (upper byte of versionMadeBy).
	const madeByUnix = (entry.versionMadeBy >> 8) === 3;
	if (!madeByUnix) return false;
	const unixMode = entry.externalFileAttributes >>> 16;
	return (unixMode & S_IFMT) === S_IFLNK;
}

export interface ArchiveInspectionOk {
	ok: true;
	entryCount: number;
	totalUncompressedBytes: number;
}

export interface ArchiveInspectionFail {
	ok: false;
	reason: "unsafe-entry" | "too-many-entries" | "too-large-extracted" | "unreadable";
	detail: string;
}

export type ArchiveInspectionResult = ArchiveInspectionOk | ArchiveInspectionFail;

const ARCHIVE_REJECTION_LABELS: Record<ArchiveInspectionFail["reason"], string> = {
	"unsafe-entry": "压缩包内包含不安全的路径或符号链接条目",
	"too-many-entries": "压缩包内文件数量超出上限",
	"too-large-extracted": "压缩包解压后总大小超出上限",
	"unreadable": "压缩包无法解析，可能已损坏",
};

/** Four-element rejection line (§6.2) for an archive that failed `inspectArchive` —
 * mirrors `describeRejection` in attachment-policy.ts so §R10 archive-security
 * failures read the same as any other rejection instead of a raw technical string. */
export function describeArchiveRejection(
	fileName: string,
	result: ArchiveInspectionFail,
	limits: Pick<InnoAttachmentLimitsConfig, "maxArchiveEntries" | "maxArchiveExtractedBytes">,
): string {
	const limitValue = result.reason === "too-many-entries" ? `${limits.maxArchiveEntries} 个文件`
		: result.reason === "too-large-extracted" ? formatBytes(limits.maxArchiveExtractedBytes)
		: "—";
	const alternativeAction = result.reason === "unsafe-entry"
		? "出于安全考虑无法接受该压缩包，请改为逐个上传其中的文件，或上传到工作区"
		: "请精简压缩包内容后重试，或改为上传到工作区";
	return `${fileName}：${ARCHIVE_REJECTION_LABELS[result.reason]}（限制：${limitValue}）。${alternativeAction}`;
}

export async function inspectArchive(
	filePath: string,
	limits: Pick<InnoAttachmentLimitsConfig, "maxArchiveEntries" | "maxArchiveExtractedBytes">,
): Promise<ArchiveInspectionResult> {
	let zipFile: yauzl.ZipFile;
	try {
		zipFile = await yauzl.openPromise(filePath, { lazyEntries: true, strictFileNames: false });
	} catch (err) {
		return { ok: false, reason: "unreadable", detail: err instanceof Error ? err.message : String(err) };
	}

	let entryCount = 0;
	let totalUncompressedBytes = 0;
	try {
		for await (const entry of zipFile.eachEntry()) {
			// yauzl's own name sanity check catches absolute paths and ".."
			// segments — reuse it instead of re-deriving the same regex.
			const nameError = yauzl.validateFileName(entry.fileName);
			if (nameError) {
				return { ok: false, reason: "unsafe-entry", detail: `${entry.fileName}: ${nameError}` };
			}
			if (isSymlinkEntry(entry)) {
				return { ok: false, reason: "unsafe-entry", detail: `${entry.fileName}: symlink entries are not allowed` };
			}

			entryCount += 1;
			totalUncompressedBytes += entry.uncompressedSize;

			if (entryCount > limits.maxArchiveEntries) {
				return { ok: false, reason: "too-many-entries", detail: `exceeds ${limits.maxArchiveEntries} entries` };
			}
			if (totalUncompressedBytes > limits.maxArchiveExtractedBytes) {
				return { ok: false, reason: "too-large-extracted", detail: `exceeds ${limits.maxArchiveExtractedBytes} bytes uncompressed` };
			}
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		// yauzl validates each entry's filename internally (whenever `decodeStrings`
		// is on, the default) and throws before it ever reaches our own explicit
		// `validateFileName` call above — so a path-traversal/absolute-path entry
		// surfaces here, not there. Recognize its error text so this is still
		// reported as a rejected unsafe entry rather than a generic read failure.
		const isNameValidationError = /^(invalid characters in fileName|absolute path|invalid relative path):/.test(message);
		return { ok: false, reason: isNameValidationError ? "unsafe-entry" : "unreadable", detail: message };
	} finally {
		zipFile.close();
	}

	return { ok: true, entryCount, totalUncompressedBytes };
}
