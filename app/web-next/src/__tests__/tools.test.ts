import { describe, it, expect } from 'vitest';
import { TOOL_DEFINITIONS } from '../tools';
import { SCIVERSE_TOOL_DEFINITIONS } from '../tools/sciverseTools';

describe('TOOL_DEFINITIONS', () => {
  it('has exactly 9 tools', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(9);
  });

  it('each tool has type function', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.type).toBe('function');
    }
  });

  it('required tool names are present', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.function.name);
    expect(names).toContain('search_chunks');
    expect(names).toContain('get_chunk');
    expect(names).toContain('get_current_chunk');
    expect(names).toContain('list_chunks');
    expect(names).toContain('list_images');
    expect(names).toContain('search_papers');
    expect(names).toContain('get_paper_chunk');
    expect(names).toContain('list_paper_chunks');
    expect(names).toContain('semantic_search_chunks');
  });

  it('each tool has parameters type object', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.function.parameters.type).toBe('object');
      expect(typeof tool.function.parameters.properties).toBe('object');
      expect(Array.isArray(tool.function.parameters.required)).toBe(true);
    }
  });

  it('tools with required params define them in required array', () => {
    const searchChunks = TOOL_DEFINITIONS.find((t) => t.function.name === 'search_chunks')!;
    expect(searchChunks.function.parameters.required).toContain('query');
    expect(searchChunks.function.parameters.properties.query.type).toBe('string');

    const getChunk = TOOL_DEFINITIONS.find((t) => t.function.name === 'get_chunk')!;
    expect(getChunk.function.parameters.required).toContain('target');

    const semantic = TOOL_DEFINITIONS.find((t) => t.function.name === 'semantic_search_chunks')!;
    expect(semantic.function.parameters.required).toContain('query');
  });

  it('tools without params have empty required array', () => {
    const getCurrent = TOOL_DEFINITIONS.find((t) => t.function.name === 'get_current_chunk')!;
    expect(getCurrent.function.parameters.required).toEqual([]);

    const listChunks = TOOL_DEFINITIONS.find((t) => t.function.name === 'list_chunks')!;
    expect(listChunks.function.parameters.required).toEqual([]);
  });
});

describe('SCIVERSE_TOOL_DEFINITIONS', () => {
  it('has exactly 6 tools with type function', () => {
    expect(SCIVERSE_TOOL_DEFINITIONS).toHaveLength(6);
    for (const tool of SCIVERSE_TOOL_DEFINITIONS) {
      expect(tool.type).toBe('function');
      expect(tool.function.parameters.type).toBe('object');
    }
  });

  it('required names are present', () => {
    const names = SCIVERSE_TOOL_DEFINITIONS.map((t) => t.function.name);
    expect(names).toEqual([
      'sciverse_semantic_search',
      'sciverse_search_papers',
      'sciverse_read_content',
      'sciverse_relations',
      'sciverse_get_resource',
      'sciverse_add_favorite',
    ]);
  });

  it('declares required params', () => {
    const semantic = SCIVERSE_TOOL_DEFINITIONS.find((t) => t.function.name === 'sciverse_semantic_search')!;
    expect(semantic.function.parameters.required).toContain('query');

    const content = SCIVERSE_TOOL_DEFINITIONS.find((t) => t.function.name === 'sciverse_read_content')!;
    expect(content.function.parameters.required).toContain('doc_id');

    const relations = SCIVERSE_TOOL_DEFINITIONS.find((t) => t.function.name === 'sciverse_relations')!;
    expect(relations.function.parameters.required).toContain('unique_id');
    expect(relations.function.parameters.required).toContain('relation');

    const fav = SCIVERSE_TOOL_DEFINITIONS.find((t) => t.function.name === 'sciverse_add_favorite')!;
    expect(fav.function.parameters.required).toEqual(['doc_id', 'title']);
  });
});
