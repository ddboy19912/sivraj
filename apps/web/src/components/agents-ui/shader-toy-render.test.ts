import { afterEach, describe, expect, it, vi } from 'vitest'
import { drawShaderFrame } from '@/components/agents-ui/shader-toy-render-frame'
import { createShaderRenderLoop } from '@/components/agents-ui/shader-toy-render-loop'
import { createShaderRenderContext } from '@/components/agents-ui/shader-toy-test-fixtures'

describe('shader render helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('drawShaderFrame resizes the canvas and issues a draw call', () => {
    const context = createShaderRenderContext(120, 80)

    drawShaderFrame({
      ...context,
      startedAt: performance.now(),
    })

    expect(context.canvas.width).toBe(120)
    expect(context.gl.drawArrays).toHaveBeenCalled()
  })

  it('drawShaderFrame reads the latest uniforms before drawing', () => {
    const context = createShaderRenderContext(120, 80)
    const currentUniforms = {
      uColor: { type: '3fv' as const, value: [1, 0, 0] },
    }

    drawShaderFrame({
      ...context,
      getUniforms: () => currentUniforms,
      startedAt: performance.now(),
    })

    expect(context.gl.uniform3fv).toHaveBeenCalledWith(
      expect.anything(),
      currentUniforms.uColor.value,
    )
  })

  it('createShaderRenderLoop starts and stops the animation frame loop', () => {
    const requestSpy = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(42)
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})

    const stop = createShaderRenderLoop(createShaderRenderContext(100, 50))

    expect(requestSpy).toHaveBeenCalled()
    stop()
    expect(cancelSpy).toHaveBeenCalledWith(42)
  })
})
