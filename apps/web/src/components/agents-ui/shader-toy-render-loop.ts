import {
  drawShaderFrame,
  type ShaderRenderContext,
} from '@/components/agents-ui/shader-toy-render-frame'

export function createShaderRenderLoop(
  context: Omit<ShaderRenderContext, 'startedAt'>,
) {
  const startedAt = performance.now()
  let animationFrame = 0

  const render = () => {
    drawShaderFrame({ ...context, startedAt })
    animationFrame = window.requestAnimationFrame(render)
  }

  render()

  return () => {
    window.cancelAnimationFrame(animationFrame)
  }
}
