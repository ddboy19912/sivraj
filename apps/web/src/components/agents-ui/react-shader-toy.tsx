/**
 * @license
 * MIT License
 *
 * Adapted from LiveKit Agents UI's React Shader Toy registry component.
 */

import { useEffect, useRef, type CSSProperties } from "react";

type Uniform = {
  type: "1f" | "3fv";
  value: number | number[];
};

type ReactShaderToyProps = {
  fs: string;
  uniforms?: Record<string, Uniform>;
  devicePixelRatio?: number;
  style?: CSSProperties;
  onError?: (error: string) => void;
};

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

export function ReactShaderToy({
  fs,
  uniforms,
  devicePixelRatio = 1,
  style,
  onError = console.error,
}: ReactShaderToyProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const uniformsRef = useRef(uniforms);

  useEffect(() => {
    uniformsRef.current = uniforms;
  }, [uniforms]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      depth: false,
      premultipliedAlpha: true,
    });

    if (!gl) {
      onError("WebGL is unavailable.");
      return;
    }

    const program = createProgram(
      gl,
      VERTEX_SHADER,
      buildFragmentShader(fs, uniformsRef.current),
    );
    const buffer = gl.createBuffer();

    if (!program || !buffer) {
      return;
    }

    const positionLocation = gl.getAttribLocation(program, "aPosition");
    const uniformLocations = new Map<string, WebGLUniformLocation | null>();

    for (const key of Object.keys(uniformsRef.current ?? {})) {
      uniformLocations.set(key, gl.getUniformLocation(program, key));
    }

    const resolutionLocation = gl.getUniformLocation(program, "iResolution");
    const timeLocation = gl.getUniformLocation(program, "iTime");

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    let animationFrame = 0;
    const startedAt = performance.now();

    const resize = () => {
      const ratio = Math.min(devicePixelRatio, 2);
      const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };

    const render = () => {
      resize();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.enableVertexAttribArray(positionLocation);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform1f(timeLocation, (performance.now() - startedAt) / 1000);

      for (const [key, uniform] of Object.entries(uniformsRef.current ?? {})) {
        const location =
          uniformLocations.get(key) ?? gl.getUniformLocation(program, key);

        if (!location) {
          continue;
        }

        if (uniform.type === "1f" && typeof uniform.value === "number") {
          gl.uniform1f(location, uniform.value);
        }

        if (uniform.type === "3fv" && Array.isArray(uniform.value)) {
          gl.uniform3fv(location, uniform.value);
        }
      }

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      animationFrame = window.requestAnimationFrame(render);
    };

    render();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, [devicePixelRatio, fs, onError]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", ...style }}
    />
  );
}

function buildFragmentShader(
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

function createProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

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

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
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
