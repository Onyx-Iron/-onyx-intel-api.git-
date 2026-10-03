import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  chatCompletionDelta,
  configuredDocumentProvider,
  EMBEDDING_DIMENSIONS,
  openaiDocumentRequest,
  openaiEmbeddingRequest,
  openaiEmbeddingVectors,
  openaiResponseText,
  openaiToolDefinitions,
  OPENAI_DOCUMENT_MODEL,
  OPENAI_EMBED_MODEL,
  resolveOpenAIChatModel,
} from "./document-ai.ts";

describe("document AI provider", () => {
  it("uses OpenAI when that key is configured, including when Gemini is also present", () => {
    assert.equal(configuredDocumentProvider({ OPENAI_API_KEY: "sk-test", GEMINI_API_KEY: "gem" }), "openai");
    assert.equal(configuredDocumentProvider({ GEMINI_API_KEY: "gem" }), "gemini");
    assert.equal(configuredDocumentProvider({}), null);
  });

  it("asks gpt-4.1 to read a drawing at high detail and a photo as an image", () => {
    const pdf = openaiDocumentRequest({
      fileName: "A1.pdf",
      mimeType: "application/pdf",
      dataUrl: "data:application/pdf;base64,QQ==",
      prompt: "extract",
      json: true,
    });
    assert.equal(pdf.model, OPENAI_DOCUMENT_MODEL);
    const pdfPart = (pdf.input as Array<{ content: Array<Record<string, unknown>> }>)[0].content[0];
    assert.equal(pdfPart.type, "input_file");
    assert.equal(pdfPart.detail, "high");
    assert.equal((pdf.text as { format: { type: string } }).format.type, "json_object");

    const photo = openaiDocumentRequest({
      fileName: "site.jpg",
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,QQ==",
      prompt: "describe",
    });
    const imagePart = (photo.input as Array<{ content: Array<Record<string, unknown>> }>)[0].content[0];
    assert.equal(imagePart.type, "input_image");
    assert.equal(imagePart.detail, "high");
  });

  it("reads the Responses API text and rejects an embedding with the wrong shape", () => {
    assert.equal(openaiResponseText({ output_text: "{\"doc_type\":\"drawing\"}" }), "{\"doc_type\":\"drawing\"}");
    assert.equal(openaiResponseText({
      output: [{ content: [{ type: "output_text", text: "sheet A1" }] }],
    }), "sheet A1");

    const request = openaiEmbeddingRequest("door schedule");
    assert.equal(request.model, OPENAI_EMBED_MODEL);
    assert.equal(request.dimensions, EMBEDDING_DIMENSIONS);

    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
    assert.equal(openaiEmbeddingVectors({ data: [{ index: 0, embedding: vector }] }, 1)[0].length, EMBEDDING_DIMENSIONS);
    assert.throws(
      () => openaiEmbeddingVectors({ data: [{ index: 0, embedding: [1, 2, 3] }] }, 1),
      /768/,
    );
  });

  it("uses gpt-4.1 for chat unless OPENAI_MODEL is set, and maps tool schemas for OpenAI", () => {
    assert.equal(resolveOpenAIChatModel({}), OPENAI_DOCUMENT_MODEL);
    assert.equal(resolveOpenAIChatModel({ OPENAI_MODEL: "gpt-4o" }), "gpt-4o");
    assert.equal(chatCompletionDelta({ choices: [{ delta: { content: "sheet A1" } }] }), "sheet A1");
    assert.equal(chatCompletionDelta({ choices: [{ delta: {} }] }), "");

    const tools = openaiToolDefinitions([{
      name: "search_project_docs",
      description: "Search drawings",
      parameters: {
        type: "OBJECT",
        properties: { query: { type: "STRING", description: "Natural language search query" } },
        required: ["query"],
      },
    }]);
    const fn = tools[0].function as { parameters: { type: string; properties: { query: { type: string } } } };
    assert.equal(fn.parameters.type, "object");
    assert.equal(fn.parameters.properties.query.type, "string");
  });
});
