import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeArchiveRejection, inspectArchive } from "./zip-inspect.js";
import { DEFAULT_ATTACHMENT_LIMITS } from "../attachment-policy.js";

/**
 * Hand-rolled, uncompressed (STORE) zip writer for test fixtures only.
 * `inspectArchive` never opens a read stream (it only reads entry metadata via
 * `eachEntry()`), so CRC32/date fields are irrelevant here and left at 0.
 */
interface ZipEntrySpec {
	name: string;
	data?: Buffer;
	/** Raw external-file-attributes DWORD (e.g. a Unix symlink mode packed into the upper 16 bits). */
	externalAttrs?: number;
	/** High byte of "version made by" — 3 signals a Unix-authored archive, required for externalAttrs to carry Unix mode bits. */
	unixHost?: boolean;
}

function u16(n: number): Buffer {
	const b = Buffer.alloc(2);
	b.writeUInt16LE(n, 0);
	return b;
}

function u32(n: number): Buffer {
	const b = Buffer.alloc(4);
	b.writeUInt32LE(n >>> 0, 0);
	return b;
}

function buildZip(entries: ZipEntrySpec[]): Buffer {
	const localParts: Buffer[] = [];
	const centralParts: Buffer[] = [];
	let offset = 0;

	for (const entry of entries) {
		const nameBuf = Buffer.from(entry.name, "utf8");
		const data = entry.data ?? Buffer.alloc(0);
		const versionMadeBy = entry.unixHost ? (3 << 8) | 20 : 20;

		const localHeader = Buffer.concat([
			u32(0x04034b50),
			u16(20), // version needed
			u16(0), // flags
			u16(0), // method: STORE
			u16(0), u16(0x21), // time, date
			u32(0), // crc32
			u32(data.length), // compressed size
			u32(data.length), // uncompressed size
			u16(nameBuf.length),
			u16(0), // extra field length
			nameBuf,
			data,
		]);
		localParts.push(localHeader);

		const centralHeader = Buffer.concat([
			u32(0x02014b50),
			u16(versionMadeBy),
			u16(20), // version needed
			u16(0), // flags
			u16(0), // method
			u16(0), u16(0x21), // time, date
			u32(0), // crc32
			u32(data.length),
			u32(data.length),
			u16(nameBuf.length),
			u16(0), u16(0), // extra, comment length
			u16(0), // disk number start
			u16(0), // internal attrs
			u32(entry.externalAttrs ?? 0),
			u32(offset),
			nameBuf,
		]);
		centralParts.push(centralHeader);

		offset += localHeader.length;
	}

	const localSection = Buffer.concat(localParts);
	const centralSection = Buffer.concat(centralParts);
	const eocd = Buffer.concat([
		u32(0x06054b50),
		u16(0), u16(0),
		u16(entries.length), u16(entries.length),
		u32(centralSection.length),
		u32(localSection.length),
		u16(0),
	]);

	return Buffer.concat([localSection, centralSection, eocd]);
}

const S_IFLNK = 0o120000;

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "attachment-zip-test-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function writeZip(entries: ZipEntrySpec[]): string {
	const path = join(dir, "test.zip");
	writeFileSync(path, buildZip(entries));
	return path;
}

describe("inspectArchive", () => {
	it("accepts a well-formed archive within the sub-limits", async () => {
		const path = writeZip([{ name: "readme.txt", data: Buffer.from("hello") }]);
		const result = await inspectArchive(path, { maxArchiveEntries: 10, maxArchiveExtractedBytes: 1024 });
		expect(result).toEqual({ ok: true, entryCount: 1, totalUncompressedBytes: 5 });
	});

	it("rejects a zip-slip entry (path traversal) before extraction", async () => {
		const path = writeZip([{ name: "../../etc/passwd", data: Buffer.from("pwned") }]);
		const result = await inspectArchive(path, { maxArchiveEntries: 10, maxArchiveExtractedBytes: 1024 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("unsafe-entry");
	});

	it("rejects an absolute-path entry", async () => {
		const path = writeZip([{ name: "/etc/passwd", data: Buffer.from("pwned") }]);
		const result = await inspectArchive(path, { maxArchiveEntries: 10, maxArchiveExtractedBytes: 1024 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("unsafe-entry");
	});

	it("rejects a Unix symlink entry", async () => {
		const path = writeZip([{
			name: "innocent-link",
			data: Buffer.from("/etc/passwd"),
			unixHost: true,
			externalAttrs: (S_IFLNK | 0o777) << 16,
		}]);
		const result = await inspectArchive(path, { maxArchiveEntries: 10, maxArchiveExtractedBytes: 1024 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("unsafe-entry");
	});

	it("aborts once the entry count exceeds the limit, without needing to read the whole archive", async () => {
		const path = writeZip([
			{ name: "a.txt", data: Buffer.from("a") },
			{ name: "b.txt", data: Buffer.from("b") },
			{ name: "c.txt", data: Buffer.from("c") },
		]);
		const result = await inspectArchive(path, { maxArchiveEntries: 2, maxArchiveExtractedBytes: 1024 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("too-many-entries");
	});

	it("rejects once accumulated uncompressed size exceeds the extracted-size limit", async () => {
		const path = writeZip([
			{ name: "big1.bin", data: Buffer.alloc(600) },
			{ name: "big2.bin", data: Buffer.alloc(600) },
		]);
		const result = await inspectArchive(path, { maxArchiveEntries: 10, maxArchiveExtractedBytes: 1000 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("too-large-extracted");
	});

	it("reports unreadable for a file that isn't a valid zip", async () => {
		const path = join(dir, "not-a-zip.zip");
		writeFileSync(path, Buffer.from("this is not a zip file"));
		const result = await inspectArchive(path, { maxArchiveEntries: 10, maxArchiveExtractedBytes: 1024 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("unreadable");
	});
});

describe("describeArchiveRejection", () => {
	it("renders all four required elements for an unsafe-entry rejection", async () => {
		const path = writeZip([{ name: "../../etc/passwd", data: Buffer.from("pwned") }]);
		const result = await inspectArchive(path, { maxArchiveEntries: 10, maxArchiveExtractedBytes: 1024 });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		const message = describeArchiveRejection("evil.zip", result, DEFAULT_ATTACHMENT_LIMITS);
		expect(message).toContain("evil.zip");
		expect(message).toContain("不安全的路径或符号链接");
		expect(message).toContain("请改为逐个上传");
	});

	it("includes the entry-count limit value for a too-many-entries rejection", async () => {
		const path = writeZip([
			{ name: "a.txt", data: Buffer.from("a") },
			{ name: "b.txt", data: Buffer.from("b") },
		]);
		const result = await inspectArchive(path, { maxArchiveEntries: 1, maxArchiveExtractedBytes: 1024 });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		const message = describeArchiveRejection("bundle.zip", result, { maxArchiveEntries: 1, maxArchiveExtractedBytes: 1024 });
		expect(message).toContain("bundle.zip");
		expect(message).toContain("1 个文件");
	});

	it("includes the extracted-size limit value for a too-large-extracted rejection", async () => {
		const path = writeZip([{ name: "big.bin", data: Buffer.alloc(2000) }]);
		const result = await inspectArchive(path, { maxArchiveEntries: 10, maxArchiveExtractedBytes: 1000 });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		const message = describeArchiveRejection("bundle.zip", result, { maxArchiveEntries: 10, maxArchiveExtractedBytes: 1000 });
		expect(message).toContain("1000B");
	});
});
