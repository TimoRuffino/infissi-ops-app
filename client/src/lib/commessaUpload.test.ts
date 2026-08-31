import { describe, expect, it } from "vitest";
import { normalizzaMimeUploadCommessa } from "@shared/commessaUpload";

describe("regole upload commessa", () => {
  it("normalizza i MIME video mancanti o specifici della piattaforma", () => {
    expect(normalizzaMimeUploadCommessa("posa.MOV", "")).toBe(
      "video/quicktime"
    );
    expect(normalizzaMimeUploadCommessa("cantiere.mp4", "video/x-m4v")).toBe(
      "video/mp4"
    );
    expect(normalizzaMimeUploadCommessa("rilievo.webm", "application/octet-stream"))
      .toBe("video/webm");
    expect(normalizzaMimeUploadCommessa("contratto.pdf", "application/pdf"))
      .toBe("application/pdf");
  });
});
