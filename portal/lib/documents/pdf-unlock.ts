import { decidePasswordAttempt, pdfDeclaresEncryption, type PasswordAttempt } from "@/lib/documents/processing-display";

/**
 * Opens a password-protected PDF and returns bytes only when the saved
 * copy no longer declares encryption. A wrong password is rejected.
 * A password that opens the file but cannot be rewritten is reported
 * instead of being treated as a corrupted upload.
 */
export async function unlockPdf(bytes: Uint8Array, password: string): Promise<PasswordAttempt> {
  if (!pdfDeclaresEncryption(bytes)) {
    return decidePasswordAttempt({
      declaresEncryption: false,
      passwordProvided: password.length > 0,
      opened: false,
      savedBytes: null,
    });
  }
  if (!password) {
    return decidePasswordAttempt({
      declaresEncryption: true,
      passwordProvided: false,
      opened: false,
      savedBytes: null,
    });
  }

  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs") as {
      getDocument: (src: Record<string, unknown>) => { promise: Promise<{ saveDocument: () => Promise<Uint8Array>; destroy: () => Promise<void> }> };
    };
    const task = pdfjs.getDocument({
      data: bytes,
      password,
      disableWorker: true,
      isEvalSupported: false,
    });
    const doc = await task.promise;
    const saved = new Uint8Array(await doc.saveDocument());
    await doc.destroy().catch(() => undefined);
    return decidePasswordAttempt({
      declaresEncryption: true,
      passwordProvided: true,
      opened: true,
      savedBytes: saved,
    });
  } catch {
    return decidePasswordAttempt({
      declaresEncryption: true,
      passwordProvided: true,
      opened: false,
      savedBytes: null,
    });
  }
}
