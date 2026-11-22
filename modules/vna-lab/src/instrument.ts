import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type InstrumentView = 'front' | 'angle' | 'rear' | 'screen' | 'controls' | 'ports';
export interface InstrumentModel {
  setView(view: InstrumentView): void;
  focusPart(id: string): void;
  setHighlight(id: string | null): void;
  updateScreen(): void;
  dispose(): void;
}

/** A procedural teaching model based on the supplied ZNLE6 photographs, not CAD or firmware. */
export function createInstrument(
  container: HTMLElement,
  screen: HTMLCanvasElement,
  onSelect: (partId: string) => void,
): InstrumentModel {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'low-power',
    });
  } catch {
    const fallback = document.createElement('p');
    fallback.className = 'model-fallback';
    fallback.setAttribute('role', 'status');
    fallback.textContent =
      '3D is unavailable in this browser. The live trace, bench controls and instrument part list remain available.';
    container.replaceChildren(fallback);
    return { setView() {}, focusPart() {}, setHighlight() {}, updateScreen() {}, dispose() {} };
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  const surface = renderer.domElement;
  surface.setAttribute('role', 'img');
  surface.setAttribute(
    'aria-label',
    'Interactive ZNLE6 teaching model. Drag to orbit, use the labelled camera and part controls for keyboard access.',
  );
  surface.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab;';
  container.replaceChildren(surface);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe9f0f5);
  // A tiny generated studio environment gives the metal connector surfaces
  // readable reflections without fetching an HDR image or an external asset.
  const room = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const studioEnvironment = pmrem.fromScene(room, 0.04, 0.1, 100, { size: 128 });
  scene.environment = studioEnvironment.texture;
  scene.environmentIntensity = 0.55;
  room.dispose();
  pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 80);
  const controls = new OrbitControls(camera, surface);
  controls.enableDamping = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  controls.dampingFactor = 0.12;
  controls.enablePan = false;
  controls.minDistance = 2.1;
  controls.maxDistance = 18;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = Math.PI / 2;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6c8295, 1.1));
  const keyLight = new THREE.DirectionalLight(0xfffcf6, 2.2);
  keyLight.position.set(-3, 6, 7);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xb7dcff, 0.8);
  fillLight.position.set(5, 3, -4);
  scene.add(fillLight);
  const rimLight = new THREE.DirectionalLight(0xf1f8ff, 1.0);
  rimLight.position.set(2, 4, -6);
  scene.add(rimLight);

  const body = new THREE.Group();
  scene.add(body);
  const shell = new THREE.MeshStandardMaterial({
    color: 0xcbd3d3,
    roughness: 0.62,
    metalness: 0.2,
  });
  const pale = new THREE.MeshStandardMaterial({ color: 0xe7e7dc, roughness: 0.56 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x32669d, roughness: 0.79 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x1768aa, roughness: 0.38 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x263136, roughness: 0.76 });
  const black = new THREE.MeshStandardMaterial({ color: 0x09131b, roughness: 0.7 });
  const metal = new THREE.MeshStandardMaterial({
    color: 0xc9d0cf,
    roughness: 0.22,
    metalness: 0.92,
  });
  const gold = new THREE.MeshStandardMaterial({
    color: 0xba9b58,
    roughness: 0.28,
    metalness: 0.78,
  });
  const teal = new THREE.MeshStandardMaterial({ color: 0x20a6ac, roughness: 0.56 });
  const hotspots: THREE.Object3D[] = [];
  const blockers: THREE.Object3D[] = [];
  const parts = new Map<string, THREE.Object3D[]>();

  function register(object: THREE.Object3D, id: string) {
    object.userData.partId = id;
    hotspots.push(object);
    parts.set(id, [...(parts.get(id) ?? []), object]);
    return object;
  }
  function box(
    parent: THREE.Group | THREE.Scene,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    radius = 0.018,
  ) {
    const mesh = new THREE.Mesh(
      new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 3, h / 3, d / 3)),
      material,
    );
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  // The official W:H:D is 408:186:235. The case depth follows that broad
  // proportion; this photograph-referenced reconstruction is not measured CAD.
  // Keep the face plane stable so controls and display share a consistent datum.
  const enclosure = box(body, 3.91, 1.84, 2.2, 0, 0, -0.43, shell, 0.055);
  blockers.push(enclosure);
  const face = box(body, 3.87, 1.77, 0.07, 0, 0, 0.695, pale, 0.018);
  blockers.push(face);
  const bumperProfile = new THREE.Shape();
  bumperProfile.moveTo(1.88, -0.91);
  bumperProfile.lineTo(1.88, 0.91);
  bumperProfile.quadraticCurveTo(2.0, 0.99, 2.1, 0.94);
  bumperProfile.quadraticCurveTo(2.18, 0.91, 2.17, 0.76);
  bumperProfile.lineTo(2.12, 0.4);
  bumperProfile.quadraticCurveTo(2.1, 0.31, 2.02, 0.27);
  bumperProfile.lineTo(2.02, -0.29);
  bumperProfile.quadraticCurveTo(2.14, -0.36, 2.17, -0.49);
  bumperProfile.lineTo(2.17, -0.8);
  bumperProfile.quadraticCurveTo(2.17, -0.97, 2.04, -0.97);
  bumperProfile.quadraticCurveTo(1.95, -0.97, 1.88, -0.91);
  const bumperGeometry = new THREE.ExtrudeGeometry(bumperProfile, {
    depth: 2.23,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.025,
    bevelSegments: 3,
    curveSegments: 7,
    steps: 1,
  });
  for (const side of [-1, 1]) {
    // The molded outer waist and recessed handhold replace a featureless box.
    const bumper = new THREE.Mesh(bumperGeometry, blue);
    bumper.scale.x = side;
    bumper.position.z = -1.53;
    body.add(bumper);
    blockers.push(bumper);
    box(body, 0.018, 0.5, 0.65, side * 2.035, 0.01, -0.38, dark, 0.08);
    box(body, 0.04, 0.47, 0.07, side * 2.065, 0.01, -0.39, blue, 0.025);
  }
  for (const x of [-1.45, 1.45]) {
    box(body, 0.31, 0.09, 1.52, x, -0.965, -0.43, dark, 0.025);
    box(body, 0.13, 0.045, 0.16, x * 0.66, 0.94, -0.53, metal);
  }
  const handlePath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.96, 0.95, -0.53),
    new THREE.Vector3(-0.89, 1.07, -0.53),
    new THREE.Vector3(-0.68, 1.105, -0.53),
    new THREE.Vector3(0.68, 1.105, -0.53),
    new THREE.Vector3(0.89, 1.07, -0.53),
    new THREE.Vector3(0.96, 0.95, -0.53),
  ]);
  body.add(new THREE.Mesh(new THREE.TubeGeometry(handlePath, 32, 0.032, 8, false), shell));
  // Subtle enclosure seam and the shallow front-panel gasket.
  box(body, 3.86, 0.012, 2.12, 0, -0.65, -0.43, metal, 0.003);
  box(body, 3.8, 1.72, 0.009, 0, 0, 0.733, shell, 0.01);

  box(body, 2.6, 1.63, 0.03, -0.43, 0.01, 0.748, trim, 0.04);
  box(body, 2.52, 1.55, 0.025, -0.43, 0.01, 0.768, pale, 0.025);
  box(body, 2.46, 1.49, 0.024, -0.43, 0.01, 0.79, black, 0.02);
  box(body, 2.6, 0.095, 0.009, -0.43, 0.847, 0.755, trim, 0.008);
  box(body, 1.29, 0.065, 0.006, 0.09, 0.847, 0.764, pale, 0.003);
  const screenTexture = new THREE.CanvasTexture(screen);
  screenTexture.colorSpace = THREE.SRGBColorSpace;
  screenTexture.minFilter = THREE.LinearFilter;
  const screenPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(2.36, 1.36),
    new THREE.MeshBasicMaterial({ map: screenTexture, toneMapped: false }),
  );
  screenPlane.position.set(-0.43, 0.01, 0.809);
  body.add(screenPlane);
  register(screenPlane, 'screen');
  box(body, 1.06, 0.54, 0.02, 1.31, 0.47, 0.746, shell);
  box(body, 1.06, 0.82, 0.02, 1.31, -0.23, 0.746, dark);

  const frontLabels = document.createElement('canvas');
  frontLabels.width = 2560;
  frontLabels.height = 1240;
  const frontText = frontLabels.getContext('2d')!;
  const keyWells = document.createElement('canvas');
  keyWells.width = 1280;
  keyWells.height = 620;
  const wellContext = keyWells.getContext('2d')!;
  const panelWidth = 3.87,
    panelHeight = 1.77;
  function write(
    context: CanvasRenderingContext2D,
    value: string,
    x: number,
    y: number,
    size = 0.053,
    color = '#182732',
    maxWidth = 0.18,
  ) {
    const px = context.canvas.width / panelWidth;
    const py = context.canvas.height / panelHeight;
    context.fillStyle = color;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `600 ${size * py}px "Arial Narrow",Arial,sans-serif`;
    const lines = value.split('\n');
    lines.forEach((line, index) =>
      context.fillText(
        line,
        (x + panelWidth / 2) * px,
        (panelHeight / 2 - y + (index - (lines.length - 1) / 2) * size * 1.05) * py,
        maxWidth * px,
      ),
    );
  }
  function frontKey(
    id: string,
    text: string,
    x: number,
    y: number,
    w = 0.172,
    h = 0.12,
    material = pale,
  ) {
    const px = keyWells.width / panelWidth,
      py = keyWells.height / panelHeight;
    wellContext.fillStyle = material === dark ? '#0a1117' : '#798486';
    wellContext.beginPath();
    wellContext.roundRect(
      (x - w / 2 - 0.009 + panelWidth / 2) * px,
      (panelHeight / 2 - y - h / 2 - 0.009) * py,
      (w + 0.018) * px,
      (h + 0.018) * py,
      0.016 * py,
    );
    wellContext.fill();
    register(box(body, w, h, 0.038, x, y, 0.781, material, 0.012), id);
    const lines = text.split('\n');
    if (lines.length > 1) {
      write(frontText, lines[0], x, y + 0.018, 0.035, '#18272c', w * 0.93);
      const blueSecondary = ['scale', 'format', 'calibration', 'channel'].includes(id);
      write(
        frontText,
        lines[1],
        x,
        y - 0.02,
        0.027,
        blueSecondary ? '#17639e' : '#18272c',
        w * 0.93,
      );
    } else
      write(
        frontText,
        text,
        x,
        y,
        text.length > 4 ? 0.034 : 0.043,
        material === dark ? '#f0f3f2' : '#17242c',
        w * 0.91,
      );
  }
  const mainKeys = [
    [
      ['frequency', 'Freq'],
      ['span', 'Span'],
      ['scale', 'Scale\nAmpt'],
      ['marker', 'Mkr'],
      ['marker-search', 'Mkr →'],
    ],
    [
      ['bandwidth', 'Bw Avg\nPower'],
      ['sweep', 'Sweep'],
      ['trace', 'Trace'],
      ['trigger', 'Trig'],
      ['offset', 'Offset\nEmbed'],
    ],
    [
      ['measurement', 'Meas'],
      ['format', 'Format\nConfig'],
      ['display-lines', 'Display\nLines'],
      ['calibration', 'Cal\nSingle'],
      ['channel', 'Channel\nCont'],
    ],
  ];
  mainKeys.forEach((row, j) =>
    row.forEach(([id, text], i) => frontKey(id, text, 0.9 + i * 0.204, 0.64 - j * 0.17)),
  );
  const leftKeys = [
    ['preset', 'Preset'],
    ['setup', 'Setup'],
    ['mode', 'Mode'],
    ['print', 'Print'],
    ['file', 'File'],
  ];
  leftKeys.forEach(([id, text], i) =>
    frontKey(id, text, -1.77, 0.64 - i * 0.2, 0.19, 0.125, i === 0 ? teal : dark),
  );
  frontKey('keyboard', '⌨', -1.77, -0.36, 0.19, 0.11, dark);
  const numberRows = [
    ['7', '8', '9', 'G/n'],
    ['4', '5', '6', 'M/µ'],
    ['1', '2', '3', 'k/m'],
    ['0', '.', '+/−', 'x1'],
  ];
  numberRows.forEach((row, j) =>
    row.forEach((text, i) =>
      frontKey(
        'keypad',
        text,
        0.9 + i * 0.164,
        0.055 - j * 0.15,
        0.137,
        0.115,
        i === 3 ? dark : pale,
      ),
    ),
  );
  [
    ['ESC', 0.9],
    ['⌫', 1.065],
    ['ENTER', 1.31],
  ].forEach(([text, x]) =>
    frontKey(
      'keypad',
      String(text),
      Number(x),
      -0.56,
      text === 'ENTER' ? 0.27 : 0.137,
      0.115,
      dark,
    ),
  );

  const knobBase = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.185, 0.035, 40), metal);
  knobBase.rotation.x = Math.PI / 2;
  knobBase.position.set(1.73, -0.045, 0.779);
  body.add(knobBase);
  register(knobBase, 'knob');
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.173, 0.178, 0.11, 48), pale);
  knob.rotation.x = Math.PI / 2;
  knob.position.set(1.73, -0.045, 0.828);
  body.add(knob);
  register(knob, 'knob');
  const knobRing = new THREE.Mesh(new THREE.TorusGeometry(0.164, 0.017, 8, 40), blue);
  knobRing.position.set(1.73, -0.045, 0.892);
  body.add(knobRing);
  register(knobRing, 'knob');
  const gripRidges = new THREE.InstancedMesh(new THREE.BoxGeometry(0.011, 0.027, 0.018), blue, 24);
  const ridgeTransform = new THREE.Object3D();
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2;
    ridgeTransform.position.set(
      1.73 + Math.sin(angle) * 0.169,
      -0.045 + Math.cos(angle) * 0.169,
      0.892,
    );
    ridgeTransform.rotation.z = -angle;
    ridgeTransform.updateMatrix();
    gripRidges.setMatrixAt(i, ridgeTransform.matrix);
  }
  body.add(gripRidges);
  const knobTick = box(body, 0.012, 0.039, 0.006, 1.73, 0.082, 0.899, trim, 0.002);
  register(knobTick, 'knob');
  for (const [symbol, x, y] of [
    ['▲', 1.73, -0.32],
    ['◀', 1.56, -0.46],
    ['▶', 1.865, -0.46],
    ['▼', 1.73, -0.59],
  ] as const)
    frontKey('keypad', symbol, x, y, 0.135, 0.1, dark);

  function connector(
    parent: THREE.Group,
    x: number,
    y: number,
    z: number,
    id: string,
    small = false,
  ) {
    const radius = small ? 0.072 : 0.096;
    const flange = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 1.15, radius * 1.15, 0.028, small ? 24 : 6),
      metal,
    );
    flange.rotation.x = Math.PI / 2;
    flange.rotation.z = Math.PI / 6;
    flange.position.set(x, y, z - 0.061);
    parent.add(flange);
    register(flange, id);
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, 0.14, 32, 1, true),
      metal,
    );
    collar.rotation.x = Math.PI / 2;
    collar.position.set(x, y, z);
    parent.add(collar);
    register(collar, id);
    if (!small) {
      // Repeated thread crests are instanced rather than separate draw calls.
      const threads = new THREE.InstancedMesh(
        new THREE.TorusGeometry(radius * 0.992, 0.0035, 5, 32),
        metal,
        6,
      );
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < 6; i++) {
        matrix.makeTranslation(x, y, z - 0.025 + i * 0.017);
        threads.setMatrixAt(i, matrix);
      }
      parent.add(threads);
    } else {
      // The rear BNC-style reference connectors use side lugs, not N threads.
      for (const side of [-1, 1])
        box(parent, 0.023, 0.018, 0.025, x + side * radius, y, z + 0.023, metal, 0.003);
    }
    const lip = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.79, radius * 0.15, 8, 24), metal);
    lip.position.set(x, y, z + 0.073);
    parent.add(lip);
    register(lip, id);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.69, 32), black);
    hole.position.set(x, y, z + 0.06);
    parent.add(hole);
    register(hole, id);
    const contact = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.2, radius * 0.055, 8, 24),
      gold,
    );
    contact.position.set(x, y, z + 0.062);
    parent.add(contact);
  }
  connector(body, 0.99, -0.79, 0.818, 'port1');
  connector(body, 1.72, -0.79, 0.818, 'port2');
  write(frontText, 'Port 1', 0.99, -0.665, 0.035, '#263b48', 0.29);
  write(frontText, 'Port 2 / RF input', 1.72, -0.665, 0.035, '#263b48', 0.46);
  write(frontText, '50 Ω SYSTEM', 1.35, -0.855, 0.025, '#48575d', 0.4);
  for (const y of [-0.515, -0.655]) {
    const usb = box(body, 0.112, 0.075, 0.02, -1.77, y, 0.773, metal, 0.005);
    register(usb, 'front-usb');
    box(body, 0.083, 0.043, 0.023, -1.77, y, 0.786, black, 0.003);
  }
  frontKey('power', '⏻', -1.77, -0.815, 0.19, 0.1, pale);
  write(frontText, 'Power', -1.77, -0.732, 0.034, '#344956', 0.19);
  write(frontText, 'ROHDE & SCHWARZ', -1.1, 0.847, 0.049, '#ffffff', 1.02);
  write(
    frontText,
    'ZNLE6 · Vector Network Analyzer · 1 MHz–6 GHz',
    0.09,
    0.847,
    0.032,
    '#213d50',
    1.25,
  );

  function labels(parent: THREE.Group, canvas: HTMLCanvasElement, z: number) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(panelWidth, panelHeight),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.05,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    plane.position.z = z;
    parent.add(plane);
  }
  labels(body, keyWells, 0.76);
  labels(body, frontLabels, 0.802);

  const rear = new THREE.Group();
  rear.rotation.y = Math.PI;
  rear.position.z = -1.54;
  body.add(rear);
  const rearPanel = box(rear, 3.83, 1.72, 0.035, 0, 0, 0.02, dark, 0.01);
  blockers.push(rearPanel);
  const backLabels = document.createElement('canvas');
  backLabels.width = 2048;
  backLabels.height = 1000;
  const backText = backLabels.getContext('2d')!;
  const backX = (x: number) => ((x + panelWidth / 2) / panelWidth) * backLabels.width;
  const backY = (y: number) => ((panelHeight / 2 - y) / panelHeight) * backLabels.height;
  function panelOutline(x: number, y: number, w: number, h: number) {
    backText.strokeStyle = '#748389';
    backText.lineWidth = 2;
    backText.strokeRect(
      backX(x - w / 2),
      backY(y + h / 2),
      (w / panelWidth) * backLabels.width,
      (h / panelHeight) * backLabels.height,
    );
  }
  panelOutline(0, 0, 3.72, 1.62);
  panelOutline(-0.78, 0.25, 2.1, 0.68);
  panelOutline(-0.78, -0.32, 2.1, 0.42);
  panelOutline(1.05, -0.28, 1.4, 0.5);
  panelOutline(0.42, 0.49, 0.25, 0.23);
  write(backText, 'ZNLE6 / REAR CONNECTIONS', -0.94, 0.7, 0.055, '#d1e0e7', 1.6);
  write(
    backText,
    'Illustrative layout · consult the matching instrument manual',
    0.0,
    -0.73,
    0.044,
    '#a8bdcc',
    3.25,
  );
  // Vents and seams are drawn into the label atlas rather than hundreds of meshes.
  for (let i = 0; i < 14; i++) {
    const px = ((0.61 + i * 0.076 + panelWidth / 2) / panelWidth) * backLabels.width;
    backText.fillStyle = '#0a121a';
    backText.fillRect(px, 134, 7, 176);
  }
  const mains = box(rear, 0.46, 0.36, 0.055, -1.3, 0.2, 0.065, black, 0.015);
  register(mains, 'rear-power');
  box(rear, 0.22, 0.23, 0.018, -1.39, 0.2, 0.105, metal, 0.005);
  box(rear, 0.17, 0.18, 0.023, -1.39, 0.2, 0.12, black, 0.004);
  box(rear, 0.11, 0.23, 0.025, -1.17, 0.2, 0.105, black, 0.004);
  write(backText, 'AC MAINS', -1.3, 0.48, 0.047, '#d5e3e9', 0.68);
  write(backText, '100–240 V AC', -0.63, 0.36, 0.048, '#d5e3e9', 0.68);
  write(backText, 'Follow the safety manual', -0.63, 0.24, 0.035, '#b2c4ce', 0.74);
  const earthStud = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.075, 18), metal);
  earthStud.rotation.x = Math.PI / 2;
  earthStud.position.set(-1.72, 0.19, 0.09);
  rear.add(earthStud);
  write(backText, '⏚', -1.72, 0.41, 0.075, '#d5e3e9', 0.18);
  const lan = box(rear, 0.22, 0.17, 0.045, -0.73, -0.29, 0.064, metal, 0.004);
  register(lan, 'lan');
  box(rear, 0.17, 0.12, 0.048, -0.73, -0.29, 0.075, black, 0.004);
  write(backText, 'LAN', -0.73, -0.465, 0.047, '#d5e3e9', 0.3);
  for (const x of [-0.34, -0.1]) {
    const port = box(rear, 0.15, 0.17, 0.05, x, -0.29, 0.065, metal, 0.004);
    register(port, 'rear-usb');
    box(rear, 0.1, 0.12, 0.053, x, -0.29, 0.077, trim, 0.002);
  }
  write(backText, 'USB', -0.22, -0.465, 0.047, '#d5e3e9', 0.4);
  for (const [id, text, x] of [
    ['ref-in', 'Ref. In', 0.57],
    ['ref-out', 'Ref. Out', 1.02],
    ['trigger-in', 'Trig.', 1.47],
  ] as const) {
    connector(rear, x, -0.27, 0.09, id, true);
    write(backText, text, x, -0.06, 0.048, '#d5e3e9', 0.4);
  }
  labels(rear, backLabels, 0.043);
  const screwPositions = [
    [-1.83, 0.77],
    [-0.83, 0.77],
    [0.24, 0.77],
    [1.8, 0.77],
    [-1.83, 0.58],
    [0.27, 0.58],
    [-1.83, -0.1],
    [0.27, -0.1],
    [0.35, -0.03],
    [1.77, -0.03],
    [0.35, -0.53],
    [1.77, -0.53],
    [-1.83, -0.53],
    [0.27, -0.53],
    [-1.83, -0.78],
    [-0.65, -0.78],
    [0.65, -0.78],
    [1.8, -0.78],
  ];
  const screws = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.026, 0.03, 0.01, 14),
    metal,
    screwPositions.length,
  );
  const screwTransform = new THREE.Object3D();
  screwPositions.forEach(([x, y], index) => {
    screwTransform.position.set(x, y, 0.049);
    screwTransform.rotation.x = Math.PI / 2;
    screwTransform.updateMatrix();
    screws.setMatrixAt(index, screwTransform.matrix);
  });
  rear.add(screws);

  // The mains switch lettering is on the raised switch, not a floating panel label.
  const switchLabel = document.createElement('canvas');
  switchLabel.width = 64;
  switchLabel.height = 128;
  const switchContext = switchLabel.getContext('2d')!;
  switchContext.fillStyle = '#e9efed';
  switchContext.textAlign = 'center';
  switchContext.font = '600 35px Arial';
  switchContext.fillText('I', 32, 43);
  switchContext.fillText('O', 32, 99);
  const switchTexture = new THREE.CanvasTexture(switchLabel);
  switchTexture.colorSpace = THREE.SRGBColorSpace;
  const switchFace = new THREE.Mesh(
    new THREE.PlaneGeometry(0.074, 0.18),
    new THREE.MeshBasicMaterial({ map: switchTexture, transparent: true, toneMapped: false }),
  );
  switchFace.position.set(-1.17, 0.2, 0.12);
  rear.add(switchFace);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshBasicMaterial({ color: 0xe9f0f5 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.025;
  scene.add(floor);
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const shadowContext = shadowCanvas.getContext('2d')!;
  const gradient = shadowContext.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(24,44,63,.36)');
  gradient.addColorStop(0.5, 'rgba(24,44,63,.19)');
  gradient.addColorStop(1, 'rgba(24,50,75,0)');
  shadowContext.fillStyle = gradient;
  shadowContext.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(5.15, 3.95),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(shadowCanvas),
      transparent: true,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.018;
  shadow.position.z = -0.43;
  scene.add(shadow);

  let disposed = false,
    visible = true,
    frame = 0;
  let view: InstrumentView = 'angle';
  let focusedPart: string | null = null;
  let selection: THREE.Box3Helper | null = null;
  function invalidate() {
    if (!disposed && visible && !document.hidden && !frame)
      frame = window.requestAnimationFrame(render);
  }
  function render() {
    frame = 0;
    if (disposed || !visible || document.hidden) return;
    const changed = controls.update();
    renderer.render(scene, camera);
    if (changed) invalidate();
  }
  controls.addEventListener('change', invalidate);

  function frameRegion(
    target: THREE.Vector3,
    width: number,
    height: number,
    direction: THREE.Vector3,
    closeUp: boolean,
    rearFacing = false,
  ) {
    // Clear residual orbit damping before a deliberate camera preset, so a
    // previous drag cannot pull the new close-up away from the chosen part.
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    const distance =
      (Math.max(height, width / camera.aspect) /
        (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) *
      1.12;
    controls.target.copy(target);
    controls.minDistance = closeUp ? Math.max(0.58, distance * 0.55) : 2.65;
    controls.maxDistance = Math.max(18, distance * 3);
    controls.minPolarAngle = closeUp ? 0.78 : 0.15;
    controls.maxPolarAngle = Math.PI / 2;
    controls.minAzimuthAngle = closeUp ? (rearFacing ? Math.PI - 0.5 : -0.5) : -Infinity;
    controls.maxAzimuthAngle = closeUp ? (rearFacing ? Math.PI + 0.5 : 0.5) : Infinity;
    camera.position.copy(direction.normalize().multiplyScalar(distance).add(target));
    controls.update();
    controls.enableDamping = damping;
    invalidate();
  }
  function setView(next: InstrumentView) {
    if (disposed) return;
    view = next;
    focusedPart = null;
    container.dataset.view = next;
    delete container.dataset.focusedPart;
    const regions: Record<
      InstrumentView,
      [number, number, number, number, number, number, number, number]
    > = {
      front: [0, 0.015, 0.15, 4.7, 2.42, 0, 0.02, 1],
      angle: [0, 0.015, -0.35, 4.95, 2.83, 0.5, 0.28, 0.85],
      rear: [0, 0.015, -0.5, 4.7, 2.42, 0, 0.04, -1],
      screen: [-0.43, 0.01, 0.81, 2.72, 1.72, 0, 0.02, 1],
      controls: [1.31, 0.1, 0.82, 1.35, 1.65, 0, 0.02, 1],
      ports: [1.35, -0.78, 0.83, 1.34, 0.56, 0, 0.12, 1],
    };
    const [x, y, z, width, height, dx, dy, dz] = regions[next];
    frameRegion(
      new THREE.Vector3(x, y, z),
      width,
      height,
      new THREE.Vector3(dx, dy, dz),
      ['screen', 'controls', 'ports'].includes(next),
    );
  }
  function partBounds(id: string) {
    const objects = parts.get(id);
    if (!objects?.length) return null;
    body.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    for (const object of objects) bounds.union(new THREE.Box3().setFromObject(object));
    return bounds;
  }
  function frameFocusedPart(id: string) {
    const bounds = partBounds(id);
    if (!bounds) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const rearFacing = (parts.get(id) ?? []).some((object) => object.parent === rear);
    frameRegion(
      center,
      Math.max(0.85, size.x * 1.35),
      Math.max(0.58, size.y * 1.35),
      new THREE.Vector3(0, 0.06, rearFacing ? -1 : 1),
      true,
      rearFacing,
    );
  }
  function focusPart(id: string) {
    if (disposed || !parts.has(id)) return;
    focusedPart = id;
    container.dataset.view = 'focus';
    container.dataset.focusedPart = id;
    setHighlight(id);
    frameFocusedPart(id);
  }
  function setHighlight(id: string | null) {
    if (selection) {
      scene.remove(selection);
      selection.geometry.dispose();
      (selection.material as THREE.Material).dispose();
      selection = null;
    }
    const bounds = id ? partBounds(id) : null;
    if (bounds) {
      selection = new THREE.Box3Helper(bounds.expandByScalar(0.014), 0x00a9dc);
      (selection.material as THREE.Material).depthTest = true;
      scene.add(selection);
    }
    invalidate();
  }
  const pointer = new THREE.Vector2();
  const ray = new THREE.Raycaster();
  const activePointers = new Set<number>();
  let down: { x: number; y: number; id: number; dragged: boolean } | null = null;
  function pick(event: PointerEvent) {
    const bounds = surface.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(hotspots, false)[0];
    if (!hit) return null;
    const blocker = ray.intersectObjects(blockers, false)[0];
    return blocker && blocker.distance < hit.distance - 0.002 ? null : hit;
  }
  function pointerDown(event: PointerEvent) {
    activePointers.add(event.pointerId);
    down =
      activePointers.size === 1 && event.button === 0
        ? { x: event.clientX, y: event.clientY, id: event.pointerId, dragged: false }
        : null;
  }
  function pointerMove(event: PointerEvent) {
    if (
      down &&
      down.id === event.pointerId &&
      Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6
    )
      down.dragged = true;
    surface.style.cursor = activePointers.size ? 'grabbing' : pick(event) ? 'pointer' : 'grab';
  }
  function pointerUp(event: PointerEvent) {
    activePointers.delete(event.pointerId);
    const start = down;
    down = null;
    if (
      !start ||
      start.id !== event.pointerId ||
      start.dragged ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6
    )
      return;
    const hit = pick(event);
    if (hit) {
      const id = String(hit.object.userData.partId);
      setHighlight(id);
      onSelect(id);
    }
  }
  function pointerCancel(event: PointerEvent) {
    activePointers.delete(event.pointerId);
    down = null;
  }
  function pointerLeave() {
    down = null;
    activePointers.clear();
    surface.style.cursor = 'grab';
  }
  surface.addEventListener('pointerdown', pointerDown);
  surface.addEventListener('pointermove', pointerMove);
  surface.addEventListener('pointerup', pointerUp);
  surface.addEventListener('pointercancel', pointerCancel);
  surface.addEventListener('pointerleave', pointerLeave);
  const resize = new ResizeObserver(() => {
    const width = container.clientWidth,
      height = container.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (focusedPart) frameFocusedPart(focusedPart);
    else setView(view);
  });
  resize.observe(container);
  const intersection = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? true;
    invalidate();
  });
  intersection.observe(container);
  const onVisibility = () => invalidate();
  document.addEventListener('visibilitychange', onVisibility);
  setView(view);

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (frame) window.cancelAnimationFrame(frame);
    resize.disconnect();
    intersection.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    controls.removeEventListener('change', invalidate);
    controls.dispose();
    surface.removeEventListener('pointerdown', pointerDown);
    surface.removeEventListener('pointermove', pointerMove);
    surface.removeEventListener('pointerup', pointerUp);
    surface.removeEventListener('pointercancel', pointerCancel);
    surface.removeEventListener('pointerleave', pointerLeave);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material)
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          materials.add(material);
          const map = (material as THREE.MeshBasicMaterial).map;
          if (map) textures.add(map);
        }
    });
    textures.forEach((texture) => texture.dispose());
    materials.forEach((material) => material.dispose());
    geometries.forEach((geometry) => geometry.dispose());
    studioEnvironment.dispose();
    renderer.dispose();
    surface.remove();
  }
  return {
    setView,
    focusPart,
    setHighlight,
    updateScreen() {
      screenTexture.needsUpdate = true;
      invalidate();
    },
    dispose,
  };
}
