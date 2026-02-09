/* global THREE */
// Cube Game – WebAssembly core with Three.js rendering

const CAMERA_DISTANCE = 4;
const CAMERA_HEIGHT = 1.5;
const RUN_CYCLE_DURATION = 0.4;
const PROJECTILE_RADIUS = 0.15;

// Input state (for WASM)
const keys = {};
let mouseDeltaX = 0, mouseDeltaY = 0;
let isShooting = false; // Track if shoot button is held down
let shootCooldown = 0; // Cooldown timer between shots
const SHOOT_COOLDOWN_TIME = 0.05; // Seconds between shots (3x faster: was 0.15)
let isPointerLocked = false;

// WASM module and wrappers (set after load)
let game_update, game_get_player_position, game_get_player_rotation, game_get_front;
let game_get_projectile_count, game_get_projectile;
let game_get_is_moving, game_get_is_in_air, game_get_run_time;
let game_get_obstacle_count, getObstacleX, getObstacleY, getObstacleZ, getObstacleRotation, getObstacleColor, getObstacleType;

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0.2, 0.3, 0.4);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas'), antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Terrain: hilly floor (500x500) with procedural height
function makeTerrainGeometry(width, depth, segsW, segsD) {
  const geom = new THREE.PlaneGeometry(width, depth, segsW, segsD);
  const pos = geom.attributes.position;
  const scale = 0.04;
  const amp = 6;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const h =
      amp * (0.5 * Math.sin(x * scale) * Math.cos(y * scale * 0.8) +
             0.4 * Math.sin(x * scale * 1.3 + 1) * Math.cos(y * scale * 1.1 + 0.5) +
             0.3 * Math.sin((x + y) * scale * 0.5));
    pos.setZ(i, -h);
  }
  geom.rotateX(-Math.PI / 2);
  geom.computeVertexNormals();
  return geom;
}
const floorGeom = makeTerrainGeometry(500, 500, 80, 80);
const floorMat = new THREE.MeshLambertMaterial({ color: 0x5a4a42 });
const floor = new THREE.Mesh(floorGeom, floorMat);
floor.position.set(0, 0, 0);
floor.receiveShadow = true;
scene.add(floor);

const floorTextureUrl = new URL('Assets/Textures/BricksWall.png', document.baseURI || window.location.href).href;
new THREE.TextureLoader().load(
  floorTextureUrl,
  (tex) => {
    console.log('Loaded floor texture:', floorTextureUrl, tex.image?.width, 'x', tex.image?.height);
    // Ensure correct color and filtering for JPG textures
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    // Tile the texture across the whole 500x500 floor
    tex.repeat.set(50, 50);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy?.() ?? 1;
    floorMat.map = tex;
    floorMat.color.setHex(0xffffff);
    // Needed when adding a map to a material that previously had none
    floorMat.needsUpdate = true;
  },
  undefined,
  (err) => { console.error('Floor texture failed to load:', floorTextureUrl, err); }
);

// Grass texture for cube obstacles
const grassTextureUrl = new URL('Assets/Textures/GrassTile.png', document.baseURI || window.location.href).href;
new THREE.TextureLoader().load(
  grassTextureUrl,
  (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy?.() ?? 1;
    obstacleCubeMat.map = tex;
    obstacleCubeMat.color.setHex(0xffffff);
    obstacleCubeMat.needsUpdate = true;
    // Ensure cube instances use white so the texture shows (no tint)
    if (obstacleCubes && obstacleCubeIndices.length > 0) {
      const white = new THREE.Color(0xffffff);
      for (let k = 0; k < obstacleCubeIndices.length; k++) {
        obstacleCubes.setColorAt(k, white);
      }
      if (obstacleCubes.instanceColor) obstacleCubes.instanceColor.needsUpdate = true;
    }
  },
  undefined,
  (err) => { console.error('Grass texture failed to load:', grassTextureUrl, err); }
);

// Rock tile texture for triangle obstacles
const rockTileTextureUrl = new URL('Assets/Textures/RockTile.png', document.baseURI || window.location.href).href;
new THREE.TextureLoader().load(
  rockTileTextureUrl,
  (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy?.() ?? 1;
    obstacleTriangleMat.map = tex;
    obstacleTriangleMat.color.setHex(0xffffff);
    obstacleTriangleMat.needsUpdate = true;
  },
  undefined,
  (err) => { console.error('RockTile texture failed to load:', rockTileTextureUrl, err); }
);

// Obstacles: cubes (0), spheres (1), triangles (2) - each type has its own InstancedMesh
const OBSTACLE_TYPE_CUBE = 0;
const OBSTACLE_TYPE_SPHERE = 1;
const OBSTACLE_TYPE_TRIANGLE = 2;

const obstacleCubeGeom = new THREE.BoxGeometry(1, 1, 1);
const obstacleSphereGeom = new THREE.SphereGeometry(0.5, 16, 12);
const obstacleTriangleGeom = new THREE.ConeGeometry(0.5, 1, 3); // Triangular cone (3 radial segments)
const obstacleMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
// Cube obstacles use their own material so we can apply GrassTile.png
const obstacleCubeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
// Triangle obstacles use their own material so we can apply RockTile.png
const obstacleTriangleMat = new THREE.MeshLambertMaterial({ color: 0xffffff });

let obstacleCubes = null;
let obstacleSpheres = null;
let obstacleTriangles = null;
let obstacleCount = 0;
let obstacleCubeIndices = [];   // obstacle index -> instance index (for cubes)
let obstacleSphereIndices = [];
let obstacleTriangleIndices = [];

function ensureObstaclesByType(getObstacleType, count) {
  const cubeIndices = [];
  const sphereIndices = [];
  const triangleIndices = [];
  for (let i = 0; i < count; i++) {
    const t = getObstacleType(i);
    if (t === OBSTACLE_TYPE_CUBE) cubeIndices.push(i);
    else if (t === OBSTACLE_TYPE_SPHERE) sphereIndices.push(i);
    else triangleIndices.push(i);
  }
  const nCubes = cubeIndices.length;
  const nSpheres = sphereIndices.length;
  const nTriangles = triangleIndices.length;

  function disposeMesh(mesh) {
    if (!mesh) return;
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  disposeMesh(obstacleCubes);
  disposeMesh(obstacleSpheres);
  disposeMesh(obstacleTriangles);

  obstacleCubes = nCubes > 0 ? new THREE.InstancedMesh(obstacleCubeGeom, obstacleCubeMat, nCubes) : null;
  obstacleSpheres = nSpheres > 0 ? new THREE.InstancedMesh(obstacleSphereGeom, obstacleMat, nSpheres) : null;
  obstacleTriangles = nTriangles > 0 ? new THREE.InstancedMesh(obstacleTriangleGeom, obstacleTriangleMat, nTriangles) : null;
  [obstacleCubes, obstacleSpheres, obstacleTriangles].forEach(m => {
    if (m) {
      m.castShadow = true;
      m.receiveShadow = false;
      scene.add(m);
    }
  });
  obstacleCubeIndices = cubeIndices;
  obstacleSphereIndices = sphereIndices;
  obstacleTriangleIndices = triangleIndices;
  obstacleCount = count;
}

// Character (blocky humanoid)
const charMat = new THREE.MeshLambertMaterial({ color: 0x5999ff });
const skinMat = new THREE.MeshLambertMaterial({ color: 0xf2d9c4 });
function makeBox(w, h, d) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), charMat);
}
const character = new THREE.Group();
const torso = makeBox(0.35, 0.4, 0.2);
torso.position.set(0, 0.9, 0);
character.add(torso);
const head = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), skinMat);
head.position.set(0, 0.25, 0);
torso.add(head);
const lUpperLeg = makeBox(0.1, 0.35, 0.1);
lUpperLeg.position.set(-0.12, 0.35, 0);
character.add(lUpperLeg);
const lLowerLeg = makeBox(0.08, 0.35, 0.08);
lLowerLeg.position.set(0, -0.35, 0);
lUpperLeg.add(lLowerLeg);
const rUpperLeg = makeBox(0.1, 0.35, 0.1);
rUpperLeg.position.set(0.12, 0.35, 0);
character.add(rUpperLeg);
const rLowerLeg = makeBox(0.08, 0.35, 0.08);
rLowerLeg.position.set(0, -0.35, 0);
rUpperLeg.add(rLowerLeg);
const lUpperArm = makeBox(0.06, 0.25, 0.06);
lUpperArm.position.set(-0.2, 0.2, 0);
torso.add(lUpperArm);
const lLowerArm = makeBox(0.05, 0.25, 0.05);
lLowerArm.position.set(0, -0.25, 0);
lUpperArm.add(lLowerArm);
const rUpperArm = makeBox(0.06, 0.25, 0.06);
rUpperArm.position.set(0.2, 0.2, 0);
torso.add(rUpperArm);
const rLowerArm = makeBox(0.05, 0.25, 0.05);
rLowerArm.position.set(0, -0.25, 0);
rUpperArm.add(rLowerArm);
scene.add(character);

// Lights
const ambient = new THREE.AmbientLight(0x404060);
scene.add(ambient);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 50;
dirLight.shadow.camera.left = -280;
dirLight.shadow.camera.right = 280;
dirLight.shadow.camera.top = 280;
dirLight.shadow.camera.bottom = -280;
dirLight.shadow.camera.far = 500;
scene.add(dirLight);

// Projectiles: list of Three.js meshes (count/layout driven by WASM)
const projectileGeom = new THREE.SphereGeometry(PROJECTILE_RADIUS, 8, 6);
const projectileMat = new THREE.MeshLambertMaterial({ color: 0xffff00 });
const projectileMeshes = [];

function updateCharacterAnimation(isMoving, isInAir, runTime) {
  const phase = ((runTime % RUN_CYCLE_DURATION) / RUN_CYCLE_DURATION) * Math.PI * 2;
  const s = Math.sin(phase);

  lUpperLeg.rotation.x = 0;
  lLowerLeg.rotation.x = 0;
  rUpperLeg.rotation.x = 0;
  rLowerLeg.rotation.x = 0;
  lUpperArm.rotation.x = 0;
  rUpperArm.rotation.x = 0;

  if (isInAir) {
    lUpperArm.rotation.x = -1;
    rUpperArm.rotation.x = -1;
    lUpperLeg.rotation.x = 0.4;
    rUpperLeg.rotation.x = 0.4;
    lLowerLeg.rotation.x = 0.9;
    rLowerLeg.rotation.x = 0.9;
  } else if (isMoving) {
    lUpperLeg.rotation.x = 0.6 * s;
    lLowerLeg.rotation.x = -1.2 * s;
    rUpperLeg.rotation.x = -0.6 * s;
    rLowerLeg.rotation.x = 1.2 * s;
    lUpperArm.rotation.x = -0.5 * s;
    rUpperArm.rotation.x = 0.5 * s;
  }
}

// Input
const canvas = document.getElementById('canvas');
const instructions = document.getElementById('instructions');

// Mobile touch controls
const ENABLE_JOYSTICK_ON_PC = true; // Set to true to show joystick on PC for testing
let touchControlsActive = false;
let lastTouchX = 0, lastTouchY = 0;
let isDraggingCamera = false;
let joystickActive = false;
let joystickTouchId = null;
let joystickCenterX = 0, joystickCenterY = 0;
let joystickRadius = 0;
let joystickX = 0, joystickY = 0;
// Look joystick (right side)
let lookJoystickActive = false;
let lookJoystickTouchId = null;
let lookJoystickCenterX = 0, lookJoystickCenterY = 0;
let lookJoystickRadius = 0;
let lookJoystickX = 0, lookJoystickY = 0; // -1 to 1 normalized
const LOOK_JOYSTICK_SENSITIVITY = 800; // scales look joystick to mouse-delta-like input per second

function isMobile() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

function shouldShowJoystick() {
  return isMobile() || ENABLE_JOYSTICK_ON_PC;
}

// Initialize mobile controls
if (shouldShowJoystick()) {
  touchControlsActive = isMobile(); // Only set to true on actual mobile devices
  const mobileControls = document.getElementById('mobileControls');
  if (ENABLE_JOYSTICK_ON_PC && !isMobile()) {
    mobileControls.classList.add('force-show');
  }
  const joystick = document.getElementById('joystick');
  const joystickStick = document.getElementById('joystickStick');
  const lookJoystick = document.getElementById('lookJoystick');
  const lookJoystickStick = document.getElementById('lookJoystickStick');
  const jumpButton = document.getElementById('jumpButton');
  const shootButton = document.getElementById('shootButton');
  
  function handleTouchStart(e, key) {
    e.preventDefault();
    e.stopPropagation();
    keys[key] = true;
    e.target.classList.add('active');
  }
  
  function handleTouchEnd(e, key) {
    e.preventDefault();
    e.stopPropagation();
    keys[key] = false;
    e.target.classList.remove('active');
  }
  
  // Calculate joystick center and radius
  function updateJoystickBounds() {
    const rect = joystick.getBoundingClientRect();
    joystickCenterX = rect.left + rect.width / 2;
    joystickCenterY = rect.top + rect.height / 2;
    joystickRadius = rect.width / 2 - 25; // Half width minus stick radius
  }
  updateJoystickBounds();
  window.addEventListener('resize', updateJoystickBounds);
  
  // Joystick touch handlers
  function updateJoystickPosition(clientX, clientY) {
    const dx = clientX - joystickCenterX;
    const dy = clientY - joystickCenterY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > joystickRadius) {
      joystickX = (dx / distance) * joystickRadius;
      joystickY = (dy / distance) * joystickRadius;
    } else {
      joystickX = dx;
      joystickY = dy;
    }
    
    joystickStick.style.transform = `translate(calc(-50% + ${joystickX}px), calc(-50% + ${joystickY}px))`;
    
    // Map joystick position to movement keys
    const threshold = 0.3; // Dead zone threshold
    const normalizedX = joystickX / joystickRadius;
    const normalizedY = joystickY / joystickRadius;
    
    keys['KeyW'] = normalizedY < -threshold;
    keys['KeyS'] = normalizedY > threshold;
    keys['KeyA'] = normalizedX < -threshold;
    keys['KeyD'] = normalizedX > threshold;
  }
  
  function resetJoystick() {
    joystickX = 0;
    joystickY = 0;
    joystickStick.style.transform = 'translate(-50%, -50%)';
    joystickStick.classList.remove('active');
    keys['KeyW'] = false;
    keys['KeyS'] = false;
    keys['KeyA'] = false;
    keys['KeyD'] = false;
    joystickActive = false;
    joystickTouchId = null;
  }
  
  joystick.addEventListener('touchstart', (e) => {
    if (joystickTouchId === null && e.changedTouches.length > 0) {
      const touch = e.changedTouches[0]; // the touch that just hit this joystick (not touches[0] when 2 fingers down)
      e.preventDefault();
      e.stopPropagation();
      joystickTouchId = touch.identifier;
      joystickActive = true;
      joystickStick.classList.add('active');
      updateJoystickBounds();
      updateJoystickPosition(touch.clientX, touch.clientY);
    }
  }, { passive: false });
  
  joystick.addEventListener('touchmove', (e) => {
    if (joystickActive && joystickTouchId !== null) {
      const touch = Array.from(e.touches).find(t => t.identifier === joystickTouchId);
      if (touch) {
        e.preventDefault();
        e.stopPropagation();
        updateJoystickPosition(touch.clientX, touch.clientY);
      }
    }
  }, { passive: false });
  
  joystick.addEventListener('touchend', (e) => {
    if (joystickTouchId !== null) {
      const touch = Array.from(e.changedTouches).find(t => t.identifier === joystickTouchId);
      if (touch) {
        e.preventDefault();
        e.stopPropagation();
        resetJoystick();
      }
    }
  }, { passive: false });
  
  joystick.addEventListener('touchcancel', (e) => {
    if (joystickTouchId !== null && e.changedTouches.length > 0) {
      const cancelled = Array.from(e.changedTouches).find(t => t.identifier === joystickTouchId);
      if (cancelled) {
        e.preventDefault();
        e.stopPropagation();
        resetJoystick();
      }
    }
  }, { passive: false });

  // Look joystick bounds and position
  function updateLookJoystickBounds() {
    const rect = lookJoystick.getBoundingClientRect();
    lookJoystickCenterX = rect.left + rect.width / 2;
    lookJoystickCenterY = rect.top + rect.height / 2;
    lookJoystickRadius = rect.width / 2 - 25;
  }
  function updateLookJoystickPosition(clientX, clientY) {
    const dx = clientX - lookJoystickCenterX;
    const dy = clientY - lookJoystickCenterY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    let px = dx, py = dy;
    if (distance > lookJoystickRadius) {
      px = (dx / distance) * lookJoystickRadius;
      py = (dy / distance) * lookJoystickRadius;
    }
    lookJoystickX = lookJoystickRadius > 0 ? px / lookJoystickRadius : 0;
    lookJoystickY = lookJoystickRadius > 0 ? py / lookJoystickRadius : 0;
    lookJoystickStick.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px))`;
  }
  function resetLookJoystick() {
    lookJoystickX = 0;
    lookJoystickY = 0;
    lookJoystickStick.style.transform = 'translate(-50%, -50%)';
    lookJoystickStick.classList.remove('active');
    lookJoystickActive = false;
    lookJoystickTouchId = null;
  }
  updateLookJoystickBounds();
  window.addEventListener('resize', updateLookJoystickBounds);

  lookJoystick.addEventListener('touchstart', (e) => {
    if (lookJoystickTouchId === null && e.changedTouches.length > 0) {
      const touch = e.changedTouches[0]; // the touch that just hit this joystick
      e.preventDefault();
      e.stopPropagation();
      lookJoystickTouchId = touch.identifier;
      lookJoystickActive = true;
      lookJoystickStick.classList.add('active');
      updateLookJoystickBounds();
      updateLookJoystickPosition(touch.clientX, touch.clientY);
    }
  }, { passive: false });
  lookJoystick.addEventListener('touchmove', (e) => {
    if (lookJoystickActive && lookJoystickTouchId !== null) {
      const touch = Array.from(e.touches).find(t => t.identifier === lookJoystickTouchId);
      if (touch) {
        e.preventDefault();
        e.stopPropagation();
        updateLookJoystickPosition(touch.clientX, touch.clientY);
      }
    }
  }, { passive: false });
  lookJoystick.addEventListener('touchend', (e) => {
    if (lookJoystickTouchId !== null) {
      const touch = Array.from(e.changedTouches).find(t => t.identifier === lookJoystickTouchId);
      if (touch) {
        e.preventDefault();
        e.stopPropagation();
        resetLookJoystick();
      }
    }
  }, { passive: false });
  lookJoystick.addEventListener('touchcancel', (e) => {
    if (lookJoystickTouchId !== null && e.changedTouches.length > 0) {
      const cancelled = Array.from(e.changedTouches).find(t => t.identifier === lookJoystickTouchId);
      if (cancelled) {
        e.preventDefault();
        resetLookJoystick();
      }
    }
  }, { passive: false });

  if (ENABLE_JOYSTICK_ON_PC && !isMobile()) {
    lookJoystick.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        e.preventDefault();
        e.stopPropagation();
        lookJoystickActive = true;
        lookJoystickStick.classList.add('active');
        updateLookJoystickBounds();
        updateLookJoystickPosition(e.clientX, e.clientY);
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (lookJoystickActive) {
        updateLookJoystickPosition(e.clientX, e.clientY);
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0 && lookJoystickActive) {
        resetLookJoystick();
      }
    });
  }
  
  // Mouse handlers for PC testing
  if (ENABLE_JOYSTICK_ON_PC && !isMobile()) {
    joystick.addEventListener('mousedown', (e) => {
      if (e.button === 0) { // Left mouse button
        e.preventDefault();
        e.stopPropagation();
        joystickActive = true;
        joystickStick.classList.add('active');
        updateJoystickBounds();
        updateJoystickPosition(e.clientX, e.clientY);
      }
    });
    
    document.addEventListener('mousemove', (e) => {
      if (joystickActive) {
        e.preventDefault();
        updateJoystickPosition(e.clientX, e.clientY);
      }
    });
    
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0 && joystickActive) {
        e.preventDefault();
        resetJoystick();
      }
    });
  }
  
  jumpButton.addEventListener('touchstart', (e) => handleTouchStart(e, 'Space'));
  jumpButton.addEventListener('touchend', (e) => handleTouchEnd(e, 'Space'));
  jumpButton.addEventListener('touchcancel', (e) => handleTouchEnd(e, 'Space'));
  
  shootButton.addEventListener('touchstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
    isShooting = true;
    e.target.classList.add('active');
  });
  shootButton.addEventListener('touchend', (e) => {
    e.preventDefault();
    e.stopPropagation();
    isShooting = false;
    e.target.classList.remove('active');
  });
  shootButton.addEventListener('touchcancel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    isShooting = false;
    e.target.classList.remove('active');
  });
  
  // Mouse handlers for jump and shoot buttons on PC
  if (ENABLE_JOYSTICK_ON_PC && !isMobile()) {
    jumpButton.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        e.preventDefault();
        keys['Space'] = true;
        e.target.classList.add('active');
      }
    });
    jumpButton.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        e.preventDefault();
        keys['Space'] = false;
        e.target.classList.remove('active');
      }
    });
    jumpButton.addEventListener('mouseleave', (e) => {
      keys['Space'] = false;
      e.target.classList.remove('active');
    });
    
    shootButton.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        e.preventDefault();
        isShooting = true;
        e.target.classList.add('active');
      }
    });
    shootButton.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        e.preventDefault();
        isShooting = false;
        e.target.classList.remove('active');
      }
    });
    shootButton.addEventListener('mouseleave', (e) => {
      isShooting = false;
      e.target.classList.remove('active');
    });
  }
  
  // Camera rotation with touch drag on canvas (only if not touching joysticks)
  canvas.addEventListener('touchstart', (e) => {
    const joystickRect = joystick.getBoundingClientRect();
    const lookRect = lookJoystick.getBoundingClientRect();
    const touch = e.touches[0];
    const isOnMoveJoystick = touch.clientX >= joystickRect.left && touch.clientX <= joystickRect.right &&
                             touch.clientY >= joystickRect.top && touch.clientY <= joystickRect.bottom;
    const isOnLookJoystick = touch.clientX >= lookRect.left && touch.clientX <= lookRect.right &&
                             touch.clientY >= lookRect.top && touch.clientY <= lookRect.bottom;
    
    if (!isOnMoveJoystick && !isOnLookJoystick && e.touches.length === 1) {
      isDraggingCamera = true;
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
      e.preventDefault();
    }
  }, { passive: false });
  
  // Mouse camera drag for PC (only if not using joysticks)
  if (ENABLE_JOYSTICK_ON_PC && !isMobile()) {
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0 && !joystickActive && !lookJoystickActive) {
        const joystickRect = joystick.getBoundingClientRect();
        const lookRect = lookJoystick.getBoundingClientRect();
        const isOnMoveJoystick = e.clientX >= joystickRect.left && e.clientX <= joystickRect.right &&
                                 e.clientY >= joystickRect.top && e.clientY <= joystickRect.bottom;
        const isOnLookJoystick = e.clientX >= lookRect.left && e.clientX <= lookRect.right &&
                                 e.clientY >= lookRect.top && e.clientY <= lookRect.bottom;
        
        if (!isOnMoveJoystick && !isOnLookJoystick) {
          isDraggingCamera = true;
          lastTouchX = e.clientX;
          lastTouchY = e.clientY;
          canvas.requestPointerLock();
        }
      }
    });
  }
  
  canvas.addEventListener('touchmove', (e) => {
    if (isDraggingCamera && e.touches.length === 1) {
      const touch = e.touches[0];
      mouseDeltaX += (touch.clientX - lastTouchX) * 1.5; // Increased sensitivity from 0.5 to 1.5
      mouseDeltaY += (touch.clientY - lastTouchY) * 1.5; // Increased sensitivity from 0.5 to 1.5
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
      e.preventDefault();
    }
  }, { passive: false });
  
  canvas.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
      isDraggingCamera = false;
    }
    e.preventDefault();
  }, { passive: false });
  
  canvas.addEventListener('touchcancel', (e) => {
    isDraggingCamera = false;
    e.preventDefault();
  }, { passive: false });
  
  // Hide instructions on mobile
  instructions.classList.add('hidden');
}

canvas.addEventListener('click', () => {
  if (!touchControlsActive) {
    canvas.requestPointerLock();
  }
});

document.addEventListener('pointerlockchange', () => {
  isPointerLocked = document.pointerLockElement === canvas;
  if (isPointerLocked) instructions.classList.add('hidden');
  else instructions.classList.remove('hidden');
});

document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Escape') document.exitPointerLock();
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });

document.addEventListener('mousemove', (e) => {
  if (!isPointerLocked) return;
  // Only block mouse movement if actually on mobile, not when joystick is enabled for testing on PC
  if (touchControlsActive && isMobile()) return;
  mouseDeltaX += e.movementX;
  mouseDeltaY += e.movementY;
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0 && isPointerLocked) {
    // Only block mouse shooting if actually on mobile
    if (touchControlsActive && isMobile()) return;
    e.preventDefault();
    isShooting = true;
  }
});
canvas.addEventListener('mouseup', (e) => {
  if (e.button === 0 && isPointerLocked) {
    if (touchControlsActive && isMobile()) return;
    isShooting = false;
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Build keys mask: W=1, S=2, A=4, D=8, Space=16, Shift=32 (run)
function getKeysMask() {
  let m = 0;
  if (keys['KeyW']) m |= 1;
  if (keys['KeyS']) m |= 2;
  if (keys['KeyA']) m |= 4;
  if (keys['KeyD']) m |= 8;
  if (keys['Space']) m |= 16;
  if (keys['ShiftLeft'] || keys['ShiftRight']) m |= 32;
  return m;
}

const clock = new THREE.Clock();

function gameLoop() {
  requestAnimationFrame(gameLoop);
  if (!game_update) return;

  const dt = Math.min(clock.getDelta(), 0.1);
  const keysMask = getKeysMask();
  
  // Look joystick adds to mouse delta (right-stick look)
  if (lookJoystickActive && (lookJoystickX !== 0 || lookJoystickY !== 0)) {
    mouseDeltaX += lookJoystickX * LOOK_JOYSTICK_SENSITIVITY * dt;
    mouseDeltaY += lookJoystickY * LOOK_JOYSTICK_SENSITIVITY * dt;
  }
  
  // Handle automatic shooting with cooldown
  let shouldShoot = false;
  if (isShooting) {
    shootCooldown -= dt;
    if (shootCooldown <= 0) {
      shouldShoot = true;
      shootCooldown = SHOOT_COOLDOWN_TIME; // Reset cooldown
    }
  } else {
    shootCooldown = 0; // Reset cooldown when not shooting
  }
  
  game_update(dt, keysMask, mouseDeltaX, mouseDeltaY, shouldShoot ? 1 : 0);
  mouseDeltaX = 0;
  mouseDeltaY = 0;

  const px = game_get_player_position(0);
  const py = game_get_player_position(1);
  const pz = game_get_player_position(2);
  const yaw = game_get_player_rotation(0);
  const pitch = game_get_player_rotation(1);
  const isMoving = game_get_is_moving();
  const isInAir = game_get_is_in_air();
  const runTime = game_get_run_time();

  const rootY = py - 0.5;
  character.position.set(px, rootY, pz);
  character.rotation.y = yaw;
  updateCharacterAnimation(!!isMoving, !!isInAir, runTime);

  const projCount = game_get_projectile_count();
  while (projectileMeshes.length < projCount) {
    const mesh = new THREE.Mesh(projectileGeom, projectileMat);
    scene.add(mesh);
    projectileMeshes.push(mesh);
  }
  while (projectileMeshes.length > projCount) {
    const mesh = projectileMeshes.pop();
    scene.remove(mesh);
  }
  for (let i = 0; i < projCount; i++) {
    const mesh = projectileMeshes[i];
    mesh.position.set(
      game_get_projectile(i, 0),
      game_get_projectile(i, 1),
      game_get_projectile(i, 2)
    );
  }

  const frontX = game_get_front(0);
  const frontY = game_get_front(1);
  const frontZ = game_get_front(2);
  camera.position.set(
    px - frontX * CAMERA_DISTANCE,
    py + CAMERA_HEIGHT - frontY * CAMERA_DISTANCE,
    pz - frontZ * CAMERA_DISTANCE
  );
  camera.lookAt(px, py, pz);

  // Update obstacle rotations for all three shape meshes
  if (obstacleCount > 0 && getObstacleRotation) {
    const matrix = new THREE.Matrix4();
    function updateMesh(mesh, indices) {
      if (!mesh || !indices.length) return;
      for (let k = 0; k < indices.length; k++) {
        const i = indices[k];
        const rot = getObstacleRotation(i);
        matrix.makeRotationY(rot);
        matrix.setPosition(getObstacleX(i), getObstacleY(i), getObstacleZ(i));
        mesh.setMatrixAt(k, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    updateMesh(obstacleCubes, obstacleCubeIndices);
    updateMesh(obstacleSpheres, obstacleSphereIndices);
    updateMesh(obstacleTriangles, obstacleTriangleIndices);
  }

  renderer.render(scene, camera);
}

// Load WASM and start (wasm/game.js must be loaded via a normal <script> tag so Emscripten can set scriptDirectory)
(function () {
  const wasmDir = 'wasm/';
  const createGameModuleFn = typeof globalThis.createGameModule !== 'undefined' ? globalThis.createGameModule : null;

  if (!createGameModuleFn) {
    document.getElementById('instructions').textContent =
      'WASM build not loaded. Run wasm/build.bat or build.sh first, then refresh.';
    return;
  }

  createGameModuleFn({ locateFile: (path) => wasmDir + path })
    .then(runWithModule)
    .catch((err) => {
      console.error('WASM init failed:', err);
      document.getElementById('instructions').textContent =
        'Failed to load game (WebAssembly). Build wasm first: run wasm/build.bat or wasm/build.sh.';
    });

  function runWithModule(Module) {
    game_update = Module.cwrap('game_update', null, ['number', 'number', 'number', 'number', 'number']);
    const getPlayerX = Module.cwrap('game_get_player_x', 'number', []);
    const getPlayerY = Module.cwrap('game_get_player_y', 'number', []);
    const getPlayerZ = Module.cwrap('game_get_player_z', 'number', []);
    game_get_player_position = (axis) => (axis === 0 ? getPlayerX() : axis === 1 ? getPlayerY() : getPlayerZ());
    const getPlayerYaw = Module.cwrap('game_get_player_yaw', 'number', []);
    const getPlayerPitch = Module.cwrap('game_get_player_pitch', 'number', []);
    game_get_player_rotation = (axis) => (axis === 0 ? getPlayerYaw() : getPlayerPitch());
    const getFrontX = Module.cwrap('game_get_front_x', 'number', []);
    const getFrontY = Module.cwrap('game_get_front_y', 'number', []);
    const getFrontZ = Module.cwrap('game_get_front_z', 'number', []);
    game_get_front = (axis) => (axis === 0 ? getFrontX() : axis === 1 ? getFrontY() : getFrontZ());
    game_get_projectile_count = Module.cwrap('game_get_projectile_count', 'number', []);
    const getProjectileX = Module.cwrap('game_get_projectile_x', 'number', ['number']);
    const getProjectileY = Module.cwrap('game_get_projectile_y', 'number', ['number']);
    const getProjectileZ = Module.cwrap('game_get_projectile_z', 'number', ['number']);
    game_get_projectile = (i, axis) => (axis === 0 ? getProjectileX(i) : axis === 1 ? getProjectileY(i) : getProjectileZ(i));
    game_get_is_moving = Module.cwrap('game_get_is_moving', 'number', []);
    game_get_is_in_air = Module.cwrap('game_get_is_in_air', 'number', []);
    game_get_run_time = Module.cwrap('game_get_run_time', 'number', []);
    game_get_obstacle_count = Module.cwrap('game_get_obstacle_count', 'number', []);
    getObstacleX = Module.cwrap('game_get_obstacle_x', 'number', ['number']);
    getObstacleY = Module.cwrap('game_get_obstacle_y', 'number', ['number']);
    getObstacleZ = Module.cwrap('game_get_obstacle_z', 'number', ['number']);
    getObstacleRotation = Module.cwrap('game_get_obstacle_rotation', 'number', ['number']);
    getObstacleColor = Module.cwrap('game_get_obstacle_color', 'number', ['number']);
    // Optional: only present if WASM was built with obstacle types (cubes/spheres/triangles)
    const hasObstacleType = typeof Module['_game_get_obstacle_type'] === 'function';
    getObstacleType = hasObstacleType ? Module.cwrap('game_get_obstacle_type', 'number', ['number']) : null;

    Module.ccall('game_init', null, [], []);
    obstacleCount = game_get_obstacle_count();
    if (getObstacleType) {
      ensureObstaclesByType(getObstacleType, obstacleCount);
    } else {
      // Old WASM build: all obstacles as cubes (single InstancedMesh)
      ensureObstaclesByType(() => OBSTACLE_TYPE_CUBE, obstacleCount);
    }

    // Set initial colors for each shape mesh
    const color = new THREE.Color();
    function setColorsForMesh(mesh, indices) {
      if (!mesh || !indices.length || !getObstacleColor) return;
      for (let k = 0; k < indices.length; k++) {
        const hexValue = (getObstacleColor(indices[k]) >>> 0) & 0xFFFFFF;
        color.setHex(hexValue);
        mesh.setColorAt(k, color);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    // Cube obstacles: white instance color so GrassTile texture shows
    if (obstacleCubes && obstacleCubeIndices.length > 0) {
      const white = new THREE.Color(0xffffff);
      for (let k = 0; k < obstacleCubeIndices.length; k++) {
        obstacleCubes.setColorAt(k, white);
      }
      if (obstacleCubes.instanceColor) obstacleCubes.instanceColor.needsUpdate = true;
    }
    setColorsForMesh(obstacleSpheres, obstacleSphereIndices);
    // Triangle obstacles use RockTile texture only (no per-instance color)
    gameLoop();
  }
})();
