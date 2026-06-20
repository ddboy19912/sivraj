import { describe, expect, it } from "vitest";
import { readDocumentStructureItems } from "./document-structure.js";

describe("document structure extraction contract", () => {
  it("normalizes LLM document structure output for durable storage", () => {
    expect(readDocumentStructureItems({
      items: [
        {
          itemType: "chapter",
          label: "CHAPTER I. Treats of the Place Where Oliver Twist Was Born",
          ordinal: 1,
          pageStart: 3,
          pageEnd: 10,
          confidence: 0.96,
          notes: "Explicit chapter heading.",
        },
        {
          itemType: "bogus",
          label: "ignored",
        },
      ],
    })).toEqual([
      {
        itemType: "chapter",
        label: "CHAPTER I. Treats of the Place Where Oliver Twist Was Born",
        normalizedLabel: "chapter i treats of the place where oliver twist was born",
        ordinal: 1,
        pageStart: 3,
        pageEnd: 10,
        charStart: null,
        charEnd: null,
        confidenceScore: 0.96,
        extractionMethod: "llm_document_structure",
        metadata: {
          notes: "Explicit chapter heading.",
        },
      },
    ]);
  });
});
