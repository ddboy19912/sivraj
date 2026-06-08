const VERTEX_SHADER = `
attribute vec2 aPosition;

void main(void) {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const MAIN_SHADER = `
void main(void) {
  vec4 color = vec4(0.0, 0.0, 0.0, 1.0);
  mainImage(color, gl_FragCoord.xy);
  gl_FragColor = color;
}
`;

type Uniform = {
  type: "1f" | "3fv";
  value: number | number[];
};

export function buildFragmentShader(
  fs: string,
  uniforms: Record<string, Uniform> | undefined,
) {
  const uniformLines = Object.entries(uniforms ?? {})
    .map(([name, uniform]) => {
      if (uniform.type === "1f") {
        return `uniform float ${name};`;
      }

      return `uniform vec3 ${name};`;
    })
    .join("\n");

  return `
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
${uniformLines}
${fs}
${MAIN_SHADER}
`;
}

export function createShaderProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

  if (!vertexShader || !fragmentShader) {
    return null;
  }

  const program = gl.createProgram();

  if (!program) {
    return null;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  return program;
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type);

  if (!shader) {
    return null;
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

export function createShaderTriangleBuffer(gl: WebGLRenderingContext) {
  const buffer = gl.createBuffer();
  if (!buffer) {
    return null;
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );

  return buffer;
}

export { createShaderRenderLoop } from "@/components/agents-ui/shader-toy-render-loop";

export const SHADER_TOY_VERTEX_SHADER = VERTEX_SHADER;
