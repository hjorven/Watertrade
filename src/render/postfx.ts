import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * Tilt-Shift wie bei einem Foto einer Modelllandschaft: ein scharfes Band um den Blickpunkt,
 * darüber und darunter zunehmende Unschärfe. Dazu leicht kräftigere Farben und eine Vignette.
 */
const blurShader = (horizontal: boolean) => ({
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    texel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    focus: { value: 0.5 }, // Bildschirmhöhe des scharfen Bandes, 0 unten, 1 oben
    band: { value: 0.12 }, // halbe Breite des scharfen Bandes
    amount: { value: 3.0 }, // maximale Unschärfe in Pixeln
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 texel;
    uniform float focus;
    uniform float band;
    uniform float amount;
    varying vec2 vUv;
    void main() {
      float d = max(0.0, abs(vUv.y - focus) - band);
      float r = clamp(d * 3.0, 0.0, 1.0) * amount;
      vec2 dir = ${horizontal ? 'vec2(texel.x, 0.0)' : 'vec2(0.0, texel.y)'} * r;
      vec4 sum = texture2D(tDiffuse, vUv) * 0.2270270270;
      sum += texture2D(tDiffuse, vUv + dir * 1.3846153846) * 0.3162162162;
      sum += texture2D(tDiffuse, vUv - dir * 1.3846153846) * 0.3162162162;
      sum += texture2D(tDiffuse, vUv + dir * 3.2307692308) * 0.0702702703;
      sum += texture2D(tDiffuse, vUv - dir * 3.2307692308) * 0.0702702703;
      gl_FragColor = sum;
    }`,
});

const gradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    saturation: { value: 1.12 },
    vignette: { value: 0.28 },
    warmth: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float vignette;
    uniform float warmth;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, saturation);
      c.rgb += vec3(0.04, 0.015, -0.03) * warmth;
      vec2 p = vUv - 0.5;
      c.rgb *= 1.0 - dot(p, p) * vignette * 1.6;
      gl_FragColor = c;
    }`,
};

export class PostFx {
  readonly composer: EffectComposer;
  private readonly h: ShaderPass;
  private readonly v: ShaderPass;
  private readonly grade: ShaderPass;
  enabled = true;
  private readonly renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.h = new ShaderPass(blurShader(true));
    this.v = new ShaderPass(blurShader(false));
    this.grade = new ShaderPass(gradeShader);
    this.composer.addPass(this.h);
    this.composer.addPass(this.v);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    for (const p of [this.h, this.v]) p.uniforms.texel.value.set(1 / (w * pr), 1 / (h * pr));
  }

  /** Fokus auf die Bildschirmhöhe eines Weltpunkts setzen; je näher die Kamera, desto stärker die Unschärfe */
  focusOn(point: THREE.Vector3, camera: THREE.Camera, distance: number): void {
    const ndc = point.clone().project(camera);
    const focus = THREE.MathUtils.clamp((ndc.y + 1) / 2, 0.15, 0.85);
    const strength = THREE.MathUtils.clamp(3.6 - distance / 90, 1.2, 3.2);
    for (const p of [this.h, this.v]) {
      p.uniforms.focus.value = focus;
      p.uniforms.amount.value = strength * this.renderer.getPixelRatio();
    }
  }

  setWarmth(w: number): void {
    this.grade.uniforms.warmth.value = w;
  }

  render(): void {
    if (this.enabled) this.composer.render();
    else this.renderer.render((this.composer.passes[0] as RenderPass).scene, (this.composer.passes[0] as RenderPass).camera);
  }
}
