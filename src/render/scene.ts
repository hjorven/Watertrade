import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly labels: CSS2DRenderer;
  readonly controls: OrbitControls;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels';
    container.appendChild(this.labels.domElement);

    this.scene.background = new THREE.Color(0xe9dcc0);
    this.scene.fog = new THREE.Fog(0xe9dcc0, 260, 520);

    // Enges Sichtfeld wirkt wie ein Blick auf ein Modell
    this.camera = new THREE.PerspectiveCamera(28, 1, 1, 1200);
    this.camera.position.set(-110, 95, 85);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(-100, 0, -35);
    this.controls.enableDamping = true;
    this.controls.minDistance = 25;
    this.controls.maxDistance = 360;
    this.controls.maxPolarAngle = 1.25;
    this.controls.screenSpacePanning = false;

    const hemi = new THREE.HemisphereLight(0xfff4dc, 0x6b5a3a, 1.4);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe2b0, 2.4);
    sun.position.set(-90, 140, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -130;
    sc.right = 130;
    sc.top = 90;
    sc.bottom = -90;
    sc.near = 10;
    sc.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.4;
    this.scene.add(sun);

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      this.renderer.setSize(w, h);
      this.labels.setSize(w, h);
      this.camera.aspect = w / h;
      // Bildmitte vom Kontorbuch weg verschieben: am Handy nach oben, sonst nach links
      if (w <= 720) this.camera.setViewOffset(w, h, 0, Math.round(h * 0.22), w, h);
      else this.camera.setViewOffset(w, h, Math.min(230, w * 0.18), 0, w, h);
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);
    resize();
  }

  addLabel(text: string, position: THREE.Vector3, className = 'town-label'): HTMLDivElement {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.copy(position);
    this.scene.add(obj);
    return el;
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }
}
