/**
 * @license
 * MIT License
 *
 * Adapted from LiveKit Agents UI's React Shader Toy registry component.
 */

import { useEffect, useRef, type CSSProperties } from "react";
import { setupReactShaderToy } from "@/components/agents-ui/react-shader-toy-setup";

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
  onWarning?: (warning: string) => void;
};

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

    return (
      setupReactShaderToy({
        canvas,
        fs,
        uniforms: uniformsRef.current,
        getUniforms: () => uniformsRef.current,
        devicePixelRatio,
        onError,
      }) ?? undefined
    );
  }, [devicePixelRatio, fs, onError]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", ...style }}
    />
  );
}
