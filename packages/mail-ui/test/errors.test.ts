import { ApiError } from "@aven/client";
import { describe, expect, it } from "vitest";
import { errorMessage } from "../src/lib/errors.js";

describe("komunikaty błędów", () => {
  it("tłumaczy INTERNAL_ERROR, PRODUCT_ACCESS_REQUIRED i nieznane błędy na komunikat po polsku", () => {
    const expected = "Coś poszło nie tak po naszej stronie. Spróbuj ponownie.";
    expect(errorMessage(new ApiError(500, { code: "INTERNAL_ERROR", message: "raw", details: [] }))).toBe(expected);
    expect(errorMessage(new Error("boom"))).toBe(expected);
    expect(errorMessage(new ApiError(403, { code: "PRODUCT_ACCESS_REQUIRED", message: "raw", details: [] }))).toBe(
      "AvenMail nie jest włączony dla Twojego konta. Poproś Ownera firmy o dostęp.",
    );
  });
});
