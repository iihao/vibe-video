import * as THREE from 'three';
import { setArtProvider } from './renderer.mjs';

/**
 * three.js 星云层（PoC）。
 *
 * 约束：每帧只由 (project, t) 决定，不累加、不读上一帧状态，所以预览、逐帧导出、
 * 离线 HTML 三条路径都能得到同一结果（离线 HTML 未加载本模块，走 2D 回退）。
 * 只负责「艺术层」，文字与排版仍由 renderer.mjs 的 canvas 2D 绘制。
 */

const MAX_SIDE = 2048;
let rig = null;
let rigKey = '';
let texture = null;

const vertexShader = `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec3 pos = position;
    pos.x += sin(uTime * 0.17 + pos.z * 1.6) * 0.05;
    pos.y += cos(uTime * 0.12 + pos.x * 1.2) * 0.035;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale * (11.0 / max(0.001, -mv.z));
    vAlpha = aAlpha;
    vColor = aColor;
  }
`;

const fragmentShader = `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.02, r);
    gl_FragColor = vec4(vColor, vAlpha * soft);
  }
`;

/** 固定种子的伪随机，保证每次生成的星云形状一致。 */
function random(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 背景够暗才用叠加发光，浅色纸感风格交给 2D 回退。 */
function isDark(hex) {
  const value = hex.replace('#', '');
  if (value.length < 6) return false;
  const r = parseInt(value.slice(0, 2), 16),
    g = parseInt(value.slice(2, 4), 16),
    b = parseInt(value.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.32;
}

function glowTexture() {
  if (texture) return texture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.22, 'rgba(255,255,255,0.52)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.14)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function build(palette) {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // 叠加发光很容易过曝，用 filmic 色调映射压住高光，避免糊成一片白。
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.bg);
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 60);
  camera.position.set(0, 0, 3.1);

  const group = new THREE.Group();
  scene.add(group);

  const accent = new THREE.Color(palette.accent);
  const ink = new THREE.Color(palette.ink);
  const faint = new THREE.Color(palette.faint);

  const count = 16000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const rnd = random(20261112);

  for (let i = 0; i < count; i++) {
    // 扁平的旋臂：半径用幂次分布，靠近核心更密。
    // 前三分之一的点压进核心，其余撒成旋臂，形成中心密、边缘疏的星云。
    const core = i < count / 3;
    const radius = core ? Math.pow(rnd(), 0.9) * 0.42 : Math.pow(rnd(), 0.55) * 1.6;
    const angle = i * 0.37 + rnd() * 0.9;
    const flatten = 1 - Math.min(1, radius / 2.2);
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = (rnd() - 0.5) * 0.9 * flatten;
    positions[i * 3 + 2] = Math.sin(angle) * radius * 0.62;

    const pick = rnd();
    const color = pick > 0.82 ? ink : pick > 0.35 ? accent : faint;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    sizes[i] = core ? 1.1 + Math.pow(rnd(), 1.8) * 3.2 : 0.7 + Math.pow(rnd(), 2.4) * 3.4;
    alphas[i] = core ? 0.18 + rnd() * 0.6 : 0.05 + rnd() * 0.4;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(geometry, material);
  group.add(stars);

  // 体积感：几片大尺寸柔光板，靠深度差产生视差。
  const glow = glowTexture();
  const clouds = [
    { x: -0.1, y: 0.05, z: -1.5, scale: 3.2, color: accent, alpha: 0.07 },
    { x: -0.34, y: 0.14, z: -0.7, scale: 1.6, color: accent, alpha: 0.1 },
    { x: 0.42, y: -0.22, z: 0.4, scale: 1.0, color: ink, alpha: 0.05 },
    { x: 0, y: 0, z: -0.05, scale: 0.8, color: ink, alpha: 0.42 },
  ].map((spec) => {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glow,
        color: spec.color,
        transparent: true,
        opacity: spec.alpha,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    sprite.position.set(spec.x, spec.y, spec.z);
    sprite.scale.setScalar(spec.scale);
    group.add(sprite);
    return sprite;
  });

  return { renderer, scene, camera, group, stars, material, clouds, palette };
}

function ensureRig(palette, key) {
  if (rig && rigKey === key) return rig;
  if (rig) dismount();
  rig = build(palette);
  rigKey = key;
  return rig;
}

function dismount() {
  if (!rig) return;
  rig.stars.geometry.dispose();
  rig.material.dispose();
  rig.clouds.forEach((sprite) => sprite.material.dispose());
  rig.renderer.dispose();
  rig = null;
  rigKey = '';
}

/**
 * 在给定的 2D 上下文里画出这一帧的星云。
 * 返回 false 表示「这帧我画不了」，交给 renderer.mjs 的 2D 回退。
 */
function paint(ctx, art) {
  const { project, t, progress, palette, W, H } = art;
  if (!palette || !isDark(palette.bg)) return false;

  const width = Math.min(MAX_SIDE, Math.round(ctx.canvas.width));
  const height = Math.min(MAX_SIDE, Math.round(ctx.canvas.height));
  if (width < 2 || height < 2) return false;

  let current;
  try {
    current = ensureRig(palette, `${project.style}:${palette.bg}:${palette.accent}`);
  } catch {
    return false;
  }

  const { renderer, scene, camera, group, material, clouds } = current;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  // 横屏时把星云推到右侧，给左侧标题留出干净的天空。
  group.position.x = art.portrait ? 0 : 0.7;
  group.position.y = art.portrait ? 0.08 : 0;
  group.rotation.y = t * 0.05;
  group.rotation.x = Math.sin(t * 0.11) * 0.07;
  group.rotation.z = Math.cos(t * 0.07) * 0.05;
  // 每幕一次的缓慢推近，制造纵深变化。
  camera.position.z = 3.5 - 0.5 * Math.min(1, Math.max(0, progress));
  camera.position.y = 0.62 + Math.sin(t * 0.19) * 0.05;
  camera.lookAt(0, 0, 0);
  material.uniforms.uTime.value = t;
  // 点精灵按输出高度归一化，缩略图与 1080p 成片的颗粒密度才一致。
  material.uniforms.uScale.value = height / 1080;
  clouds.forEach((sprite, i) => {
    const pulse = 0.82 + 0.18 * Math.sin(t * 0.6 + i * 1.7);
    sprite.material.opacity = [0.07, 0.1, 0.05, 0.42][i] * pulse;
  });

  renderer.render(scene, camera);
  ctx.drawImage(renderer.domElement, 0, 0, W, H);
  return true;
}

export function registerNebula() {
  if (typeof document === 'undefined') return;
  setArtProvider(paint);
}
