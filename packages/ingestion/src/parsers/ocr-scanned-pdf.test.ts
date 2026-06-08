import { describe, expect, it, vi } from "vitest";
import { parseOcrScannedPdf, type OcrCommandRunner } from "./ocr-scanned-pdf.js";
import {
  run_parseocrscannedpdf_renders_a_base64_pdf_and_ocrs_page_images_into_retrieva,
  run_parseocrscannedpdf_accepts_a_data_url_pdf_payload,
  run_parseocrscannedpdf_returns_an_empty_parse_result_when_no_rendered_pages_ar
} from "./ocr-scanned-pdf.test-scenarios.js";

describe("parseOcrScannedPdf", () => {
  it("renders a base64 PDF and OCRs page images into retrievable text", () => run_parseocrscannedpdf_renders_a_base64_pdf_and_ocrs_page_images_into_retrieva());
});

describe("parseOcrScannedPdf", () => {
  it("accepts a data URL PDF payload", () => run_parseocrscannedpdf_accepts_a_data_url_pdf_payload());
});

describe("parseOcrScannedPdf", () => {
  it("returns an empty parse result when no rendered pages are produced", () => run_parseocrscannedpdf_returns_an_empty_parse_result_when_no_rendered_pages_ar());
});
