import { fileTypeFromBuffer } from "file-type";

/**
 * §R4's "real-format check": verify a chat attachment's actual bytes match what its
 * extension claims, catching a file disguised by renaming (e.g. `virus.exe` → `virus.png`)
 * that would otherwise sail through `classifyExtension`'s extension-only lookup.
 *
 * Only covers extensions where magic-byte detection is actually reliable. Plain text/code
 * formats (.txt, .md, .py, .json, .csv, ...), legacy OLE binary Office formats (.doc, .xls,
 * .ppt), and audio/video have no signature `file-type` can check here (and the BRD's tier
 * table's audio/video entries are unreachable today anyway — no configured model declares
 * audio/video input). Extensions outside this map are treated as unverifiable, not
 * mismatched — `classifyExtension`'s whitelist is still the actual gate for what's allowed
 * to be attached at all.
 */
const EXPECTED_DETECTED_EXT: Record<string, readonly string[]> = {
	".png": ["png"],
	".jpg": ["jpg"],
	".jpeg": ["jpg"],
	".webp": ["webp"],
	".gif": ["gif"],
	".pdf": ["pdf"],
	".bmp": ["bmp"],
	".heic": ["heic"],
	".docx": ["docx"],
	".xlsx": ["xlsx"],
	".pptx": ["pptx"],
	".zip": ["zip"],
	".rar": ["rar"],
};

/** Returns false only when the extension is one we can verify AND the detected magic
 * bytes don't match it — true for a genuine match or an extension we can't verify. */
export async function verifyRealFormat(ext: string, data: Buffer): Promise<boolean> {
	const expected = EXPECTED_DETECTED_EXT[ext.toLowerCase()];
	if (!expected) return true;
	const detected = await fileTypeFromBuffer(data);
	return detected != null && expected.includes(detected.ext);
}

/** Same idea as `verifyRealFormat`, but for the inline base64 images `/api/chat` and
 * `/api/chat/stream` accept directly — those carry a declared `mimeType`, not a filename,
 * so there's no extension to look up. */
const EXPECTED_DETECTED_MIME: Record<string, readonly string[]> = {
	"image/png": ["image/png"],
	"image/jpeg": ["image/jpeg"],
	"image/webp": ["image/webp"],
	"image/gif": ["image/gif"],
};

export async function verifyRealImageFormat(mimeType: string, data: Buffer): Promise<boolean> {
	const expected = EXPECTED_DETECTED_MIME[mimeType.toLowerCase()];
	if (!expected) return true;
	const detected = await fileTypeFromBuffer(data);
	return detected != null && expected.includes(detected.mime);
}
