import {
  buildFragmentShader,
  createShaderProgram,
  createShaderRenderLoop,
  createShaderTriangleBuffer,
  SHADER_TOY_VERTEX_SHADER,
} from "@/components/agents-ui/shader-toy-webgl";

type Uniform = {
  type: "1f" | "3fv";
  value: number | number[];
};

export function setupReactShaderToy({
  canvas,
  fs,
  uniforms,
  getUniforms,
  devicePixelRatio,
  onError,
}: {
  canvas: HTMLCanvasElement;
  fs: string;
  uniforms: Record<string, Uniform> | undefined;
  getUniforms?: () => Record<string, Uniform> | undefined;
  devicePixelRatio: number;
  onError: (error: string) => void;
}) {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    depth: false,
    premultipliedAlpha: true,
  });

  if (!gl) {
    onError("WebGL is unavailable.");
    return null;
  }

  const program = createShaderProgram(
    gl,
    SHADER_TOY_VERTEX_SHADER,
    buildFragmentShader(fs, uniforms),
  );
  const buffer = createShaderTriangleBuffer(gl);

  if (!program || !buffer) {
    return null;
  }

  const positionLocation = gl.getAttribLocation(program, "aPosition");
  const uniformLocations = new Map<string, WebGLUniformLocation | null>();

  for (const key of Object.keys(uniforms ?? {})) {
    uniformLocations.set(key, gl.getUniformLocation(program, key));
  }

  const resolutionLocation = gl.getUniformLocation(program, "iResolution");
  const timeLocation = gl.getUniformLocation(program, "iTime");

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const stopRenderLoop = createShaderRenderLoop({
    gl,
    canvas,
    program,
    buffer,
    positionLocation,
    uniformLocations,
    resolutionLocation,
    timeLocation,
    uniforms,
    getUniforms,
    devicePixelRatio,
  });

  return () => {
    stopRenderLoop();
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
  };
}
