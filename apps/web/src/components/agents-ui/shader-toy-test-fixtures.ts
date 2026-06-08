import { vi } from 'vitest'
import type { ShaderRenderContext } from '@/components/agents-ui/shader-toy-render-frame'

function createShaderTestCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  Object.defineProperty(canvas, 'clientWidth', { value: width })
  Object.defineProperty(canvas, 'clientHeight', { value: height })
  return canvas
}

function createMockWebGLContext() {
  return {
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    useProgram: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    bindBuffer: vi.fn(),
    vertexAttribPointer: vi.fn(),
    uniform2f: vi.fn(),
    uniform1f: vi.fn(),
    uniform3fv: vi.fn(),
    getUniformLocation: vi.fn(() => ({})),
    drawArrays: vi.fn(),
    ARRAY_BUFFER: 1,
    FLOAT: 2,
    COLOR_BUFFER_BIT: 4,
    TRIANGLES: 5,
  } as unknown as WebGLRenderingContext
}

export function createShaderRenderContext(
  width: number,
  height: number,
): Omit<ShaderRenderContext, 'startedAt'> {
  return {
    gl: createMockWebGLContext(),
    canvas: createShaderTestCanvas(width, height),
    program: {} as WebGLProgram,
    buffer: {} as WebGLBuffer,
    positionLocation: 0,
    uniformLocations: new Map(),
    resolutionLocation: {} as WebGLUniformLocation,
    timeLocation: {} as WebGLUniformLocation,
    uniforms: undefined,
    devicePixelRatio: 1,
  }
}
