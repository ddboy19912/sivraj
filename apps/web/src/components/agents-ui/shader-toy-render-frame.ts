type Uniform = {
  type: '1f' | '3fv'
  value: number | number[]
}

export type ShaderRenderContext = {
  gl: WebGLRenderingContext
  canvas: HTMLCanvasElement
  program: WebGLProgram
  buffer: WebGLBuffer
  positionLocation: number
  uniformLocations: Map<string, WebGLUniformLocation | null>
  resolutionLocation: WebGLUniformLocation | null
  timeLocation: WebGLUniformLocation | null
  uniforms: Record<string, Uniform> | undefined
  getUniforms?: () => Record<string, Uniform> | undefined
  devicePixelRatio: number
  startedAt: number
}

function resizeShaderCanvas({
  gl,
  canvas,
  devicePixelRatio,
}: Pick<ShaderRenderContext, 'gl' | 'canvas' | 'devicePixelRatio'>) {
  const ratio = Math.min(devicePixelRatio, 2)
  const width = Math.max(1, Math.floor(canvas.clientWidth * ratio))
  const height = Math.max(1, Math.floor(canvas.clientHeight * ratio))

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
    gl.viewport(0, 0, width, height)
  }
}

function applyShaderUniforms({
  gl,
  program,
  uniformLocations,
  uniforms,
}: Pick<ShaderRenderContext, 'gl' | 'program' | 'uniformLocations' | 'uniforms'>) {
  for (const [key, uniform] of Object.entries(uniforms ?? {})) {
    const location =
      uniformLocations.get(key) ?? gl.getUniformLocation(program, key)

    if (!location) {
      continue
    }

    if (uniform.type === '1f' && typeof uniform.value === 'number') {
      gl.uniform1f(location, uniform.value)
    }

    if (uniform.type === '3fv' && Array.isArray(uniform.value)) {
      gl.uniform3fv(location, uniform.value)
    }
  }
}

export function drawShaderFrame(context: ShaderRenderContext) {
  const {
    gl,
    canvas,
    program,
    buffer,
    positionLocation,
    uniformLocations,
    resolutionLocation,
    timeLocation,
    startedAt,
    getUniforms,
  } = context

  resizeShaderCanvas(context)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.useProgram(program)
  gl.enableVertexAttribArray(positionLocation)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)
  gl.uniform2f(resolutionLocation, canvas.width, canvas.height)
  gl.uniform1f(timeLocation, (performance.now() - startedAt) / 1000)
  applyShaderUniforms({
    gl,
    program,
    uniformLocations,
    uniforms: getUniforms?.() ?? context.uniforms,
  })
  gl.drawArrays(gl.TRIANGLES, 0, 3)
}
