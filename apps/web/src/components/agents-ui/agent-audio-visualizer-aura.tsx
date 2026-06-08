/**
 * @license
 *
 * Adapted from LiveKit Agents UI Agent Audio Visualizer Aura.
 * Originally developed for Unicorn Studio.
 * Licensed under the Polyform Non-Resale License 1.0.0.
 */

import type {
  AgentState,
  TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import type { LocalAudioTrack, RemoteAudioTrack } from "livekit-client";
import type { ComponentProps } from "react";
import { ReactShaderToy } from "@/components/agents-ui/react-shader-toy";
import { useAgentAudioVisualizerAura } from "@/hooks/agents-ui/use-agent-audio-visualizer-aura";
import { useTheme } from "@/providers/theme-context";

const DEFAULT_COLOR = "#1FD5F9";

const shaderSource = `
const float TAU = 6.283185;

vec2 randFibo(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.xx + p.yx) * p.xy);
}

vec3 Tonemap(vec3 x) {
  x *= 4.0;
  return x / (1.0 + x);
}

float luma(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float sdCircle(vec2 st, float r) {
  return length(st) - r;
}

float sdLine(vec2 p, float r) {
  float halfLen = r * 2.0;
  vec2 a = vec2(-halfLen, 0.0);
  vec2 b = vec2(halfLen, 0.0);
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float getSdf(vec2 st) {
  if(uShape == 1.0) return sdCircle(st, uScale);
  else if(uShape == 2.0) return sdLine(st, uScale);
  return sdCircle(st, uScale);
}

vec2 turb(vec2 pos, float t, float it) {
  mat2 rotation = mat2(0.6, -0.25, 0.25, 0.9);
  mat2 layerRotation = mat2(0.6, -0.8, 0.8, 0.6);
  float frequency = mix(2.0, 15.0, uFrequency);
  float amplitude = uAmplitude;
  float frequencyGrowth = 1.4;
  float animTime = t * 0.1 * uSpeed;

  const int LAYERS = 4;
  for(int i = 0; i < LAYERS; i++) {
    vec2 rotatedPos = pos * rotation;
    vec2 wave = sin(frequency * rotatedPos + float(i) * animTime + it);
    pos += (amplitude / frequency) * rotation[0] * wave;
    rotation *= layerRotation;
    amplitude *= mix(1.0, max(wave.x, wave.y), uVariance);
    frequency *= frequencyGrowth;
  }

  return pos;
}

const float ITERATIONS = 36.0;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 pp = vec3(0.0);
  vec3 bloom = vec3(0.0);
  float t = iTime * 0.5;
  vec2 pos = uv - 0.5;
  vec2 prevPos = turb(pos, t, 0.0 - 1.0 / ITERATIONS);
  float spacing = mix(1.0, TAU, uSpacing);

  for(float i = 1.0; i < ITERATIONS + 1.0; i++) {
    float iter = i / ITERATIONS;
    vec2 st = turb(pos, t, iter * spacing);
    float d = abs(getSdf(st));
    float pd = distance(st, prevPos);
    prevPos = st;
    float dynamicBlur = exp2(pd * 2.0 * 1.4426950408889634) - 1.0;
    float ds = smoothstep(0.0, uBlur * 0.05 + max(dynamicBlur * uSmoothing, 0.001), d);
    vec3 color = uColor;

    if(uColorShift > 0.01) {
      vec3 hsv = rgb2hsv(color);
      hsv.x = fract(hsv.x + (1.0 - iter) * uColorShift * 0.3);
      color = hsv2rgb(hsv);
    }

    float invd = 1.0 / max(d + dynamicBlur, 0.001);
    pp += (ds - 1.0) * color;
    bloom += clamp(invd, 0.0, 250.0) * color;
  }

  pp *= 1.0 / ITERATIONS;
  bloom = bloom / (bloom + 2e4);
  vec3 color = (-pp + bloom * 3.0 * uBloom) * 1.2;
  color += (randFibo(fragCoord).x - 0.5) / 255.0;
  color = Tonemap(color);
  float alpha = luma(color) * uMix;
  fragColor = vec4(color * uMix, alpha);
}
`;

type AgentAudioVisualizerAuraProps = {
  state?: AgentState;
  color?: `#${string}`;
  colorShift?: number;
  audioTrack?: LocalAudioTrack | RemoteAudioTrack | TrackReferenceOrPlaceholder;
};

export function AgentAudioVisualizerAura({
  state = "disconnected",
  color: colorProp,
  colorShift = 0.05,
  audioTrack,
  className,
  ...props
}: AgentAudioVisualizerAuraProps & ComponentProps<"div">) {
  const { color: themeColor } = useTheme();
  const color = colorProp ?? themeColor;
  const { speed, scale, amplitude, frequency, brightness } =
    useAgentAudioVisualizerAura(state, audioTrack);
  const rgbColor = hexToRgb(color);

  return (
    <div className={className} data-lk-state={state} {...props}>
      <ReactShaderToy
        fs={shaderSource}
        devicePixelRatio={globalThis.devicePixelRatio ?? 1}
        uniforms={{
          uSpeed: { type: "1f", value: speed },
          uBlur: { type: "1f", value: 0.2 },
          uScale: { type: "1f", value: scale },
          uShape: { type: "1f", value: 1 },
          uFrequency: { type: "1f", value: frequency },
          uAmplitude: { type: "1f", value: amplitude },
          uBloom: { type: "1f", value: 0 },
          uMix: { type: "1f", value: brightness },
          uSpacing: { type: "1f", value: 0.5 },
          uColorShift: { type: "1f", value: colorShift },
          uVariance: { type: "1f", value: 0.1 },
          uSmoothing: { type: "1f", value: 1 },
          uColor: { type: "3fv", value: rgbColor },
        }}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

function hexToRgb(hexColor: string): [number, number, number] {
  const rgbColor = hexColor.match(
    /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/,
  );

  if (!rgbColor) {
    return hexToRgb(DEFAULT_COLOR);
  }

  const [, r = "00", g = "00", b = "00"] = rgbColor;

  return [r, g, b].map((channel) => parseInt(channel, 16) / 255) as [
    number,
    number,
    number,
  ];
}
