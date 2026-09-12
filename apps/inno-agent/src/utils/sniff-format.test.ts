import { describe, expect, it } from "vitest";
import { verifyRealFormat, verifyRealImageFormat } from "./sniff-format.js";

// A real, complete 1x1 PNG — file-type validates chunk structure, not just the 8-byte
// signature, so a bare magic-number prefix doesn't count as "a real PNG" to it.
const REAL_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	"base64",
);
const PDF_SIGNATURE = Buffer.from("%PDF-1.4\n");

describe("verifyRealFormat", () => {
	it("accepts a real PNG declared as .png", async () => {
		expect(await verifyRealFormat(".png", REAL_PNG)).toBe(true);
	});

	it("rejects an executable renamed to .png (the disguise attack §R4 exists to catch)", async () => {
		const fakeExe = Buffer.from("MZ\x90\x00\x03\x00\x00\x00fake pe header padding padding");
		expect(await verifyRealFormat(".png", fakeExe)).toBe(false);
	});

	it("accepts a real PDF declared as .pdf", async () => {
		expect(await verifyRealFormat(".pdf", PDF_SIGNATURE)).toBe(true);
	});

	it("rejects a PNG renamed to .pdf", async () => {
		expect(await verifyRealFormat(".pdf", REAL_PNG)).toBe(false);
	});

	it("treats an unverifiable extension (plain text) as passing regardless of content", async () => {
		expect(await verifyRealFormat(".txt", Buffer.from("MZ\x90\x00 not actually text but we can't tell"))).toBe(true);
	});

	it("treats a legacy OLE binary extension (.doc) as unverifiable and passing", async () => {
		expect(await verifyRealFormat(".doc", Buffer.from("anything at all"))).toBe(true);
	});
});

describe("verifyRealImageFormat", () => {
	it("accepts a real PNG declared as image/png", async () => {
		expect(await verifyRealImageFormat("image/png", REAL_PNG)).toBe(true);
	});

	it("rejects an executable declared as image/png (inline-image disguise attack)", async () => {
		const fakeExe = Buffer.from("MZ\x90\x00\x03\x00\x00\x00fake pe header padding padding");
		expect(await verifyRealImageFormat("image/png", fakeExe)).toBe(false);
	});

	it("rejects a PNG declared as image/jpeg", async () => {
		expect(await verifyRealImageFormat("image/jpeg", REAL_PNG)).toBe(false);
	});

	it("treats an unrecognized declared mimeType as unverifiable and passing", async () => {
		expect(await verifyRealImageFormat("image/x-made-up", Buffer.from("anything"))).toBe(true);
	});
});
