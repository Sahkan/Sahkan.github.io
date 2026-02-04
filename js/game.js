/* global THREE */
// --- Constants (match C# game) ---
const MOVE_SPEED = 5;
const MOUSE_SENSITIVITY = 0.002;
const CAMERA_DISTANCE = 4;
const CAMERA_HEIGHT = 1.5;
const PLAYER_HALF_EXTENT = 0.5;
const FLOOR_HALF_SIZE = 10;
const GRAVITY = 18;
const JUMP_SPEED = 8;
const FLOOR_Y = 0.5;
const OBSTACLE_HALF_EXTENT = 0.5;
const OBSTACLE_CENTERS = [
  new THREE.Vector3(4, 0.5, 2),
  new THREE.Vector3(-3, 0.5, -1),
  new THREE.Vector3(0, 0.5, -5),
];
const RUN_CYCLE_DURATION = 0.4;
const PROJECTILE_SPEED = 25;
const PROJECTILE_RADIUS = 0.15;
const PROJECTILE_MAX_DIST = 50;

// --- State ---
const playerPosition = new THREE.Vector3(0, 0.5, 3);
let yaw = 0, pitch = 0;
let velocityY = 0;
let isMoving = false, isInAir = false;
let runTime = 0;
const keys = {};
let isPointerLocked = false;
const projectiles = []; // { mesh: THREE.Mesh, velocity: THREE.Vector3 }

// --- Scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0.2, 0.3, 0.4);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas'), antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// --- Floor ---
const floorGeom = new THREE.BoxGeometry(20, 0.5, 20);
const floorMat = new THREE.MeshLambertMaterial({ color: 0x2d4a2e });
const floor = new THREE.Mesh(floorGeom, floorMat);
floor.position.set(0, -0.25, 0);
floor.receiveShadow = true;
scene.add(floor);

// --- Obstacles ---
const obstacleMat = [
  new THREE.MeshLambertMaterial({ color: 0xcc4d33 }),
  new THREE.MeshLambertMaterial({ color: 0xe6b333 }),
  new THREE.MeshLambertMaterial({ color: 0x4dcc66 }),
];
OBSTACLE_CENTERS.forEach((pos, i) => {
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), obstacleMat[i]);
  box.position.copy(pos);
  box.castShadow = true;
  scene.add(box);
});

// --- Character (simple blocky humanoid) ---
const charColor = new THREE.Color(0.35, 0.55, 0.9);
const charMat = new THREE.MeshLambertMaterial({ color: charColor });
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

// --- Lights ---
const ambient = new THREE.AmbientLight(0x404060);
scene.add(ambient);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 50;
dirLight.shadow.camera.left = -15;
dirLight.shadow.camera.right = 15;
dirLight.shadow.camera.top = 15;
dirLight.shadow.camera.bottom = -15;
scene.add(dirLight);

// --- Projectiles (shared geometry/material) ---
const projectileGeom = new THREE.SphereGeometry(PROJECTILE_RADIUS, 8, 6);
const projectileMat = new THREE.MeshLambertMaterial({ color: 0xffff00 });

function shoot() {
  const front = getFront();
  const mesh = new THREE.Mesh(projectileGeom, projectileMat);
  mesh.position.copy(playerPosition);
  const velocity = front.clone().multiplyScalar(PROJECTILE_SPEED);
  scene.add(mesh);
  projectiles.push({ mesh, velocity });
}

function getProjectileAABB(center) {
  const r = PROJECTILE_RADIUS;
  return {
    min: new THREE.Vector3(center.x - r, center.y - r, center.z - r),
    max: new THREE.Vector3(center.x + r, center.y + r, center.z + r),
  };
}

// --- Helpers ---
function getFront() {
  return new THREE.Vector3(
    Math.cos(pitch) * Math.sin(yaw),
    Math.sin(pitch),
    Math.cos(pitch) * Math.cos(yaw)
  ).normalize();
}

function getPlayerAABB(center) {
  const h = PLAYER_HALF_EXTENT;
  return {
    min: new THREE.Vector3(center.x - h, center.y - h, center.z - h),
    max: new THREE.Vector3(center.x + h, center.y + h, center.z + h),
  };
}

function getObstacleAABB(center) {
  const h = OBSTACLE_HALF_EXTENT;
  return {
    min: new THREE.Vector3(center.x - h, center.y - h, center.z - h),
    max: new THREE.Vector3(center.x + h, center.y + h, center.z + h),
  };
}

function aabbOverlap(a, b) {
  return a.min.x < b.max.x && a.max.x > b.min.x &&
    a.min.y < b.max.y && a.max.y > b.min.y &&
    a.min.z < b.max.z && a.max.z > b.min.z;
}

function wouldOverlapObstacle(center) {
  const playerBox = getPlayerAABB(center);
  for (const c of OBSTACLE_CENTERS) {
    if (aabbOverlap(playerBox, getObstacleAABB(c))) return true;
  }
  return false;
}

function updateCharacterAnimation(dt) {
  if (isMoving && !isInAir) runTime += dt;
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

// --- Input ---
const canvas = document.getElementById('canvas');
const instructions = document.getElementById('instructions');

canvas.addEventListener('click', () => {
  canvas.requestPointerLock();
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0 && isPointerLocked) {
    e.preventDefault();
    shoot();
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
  yaw -= e.movementX * MOUSE_SENSITIVITY;
  pitch -= e.movementY * MOUSE_SENSITIVITY;
  const maxPitch = (89 * Math.PI) / 180;
  pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Update ---
const clock = new THREE.Clock();

function update() {
  const dt = Math.min(clock.getDelta(), 0.1);

  const front = getFront();
  const frontXZ = new THREE.Vector3(front.x, 0, front.z).normalize();
  if (frontXZ.lengthSq() < 1e-6) frontXZ.set(0, 0, -1);
  const right = new THREE.Vector3().crossVectors(frontXZ, new THREE.Vector3(0, 1, 0)).normalize();

  let vx = 0, vz = 0;
  if (isPointerLocked) {
    if (keys['KeyW']) { vx += frontXZ.x * MOVE_SPEED * dt; vz += frontXZ.z * MOVE_SPEED * dt; }
    if (keys['KeyS']) { vx -= frontXZ.x * MOVE_SPEED * dt; vz -= frontXZ.z * MOVE_SPEED * dt; }
    if (keys['KeyA']) { vx -= right.x * MOVE_SPEED * dt; vz -= right.z * MOVE_SPEED * dt; }
    if (keys['KeyD']) { vx += right.x * MOVE_SPEED * dt; vz += right.z * MOVE_SPEED * dt; }
  }

  const newX = playerPosition.x + vx;
  if (!wouldOverlapObstacle(new THREE.Vector3(newX, playerPosition.y, playerPosition.z)))
    playerPosition.x = newX;
  const newZ = playerPosition.z + vz;
  if (!wouldOverlapObstacle(new THREE.Vector3(playerPosition.x, playerPosition.y, newZ)))
    playerPosition.z = newZ;

  isMoving = vx * vx + vz * vz > 1e-6;

  if (isPointerLocked && keys['Space']) {
    const onGround = playerPosition.y <= FLOOR_Y + 0.001 && velocityY <= 0;
    if (onGround) velocityY = JUMP_SPEED;
  }

  velocityY -= GRAVITY * dt;
  playerPosition.y += velocityY * dt;

  if (playerPosition.y < FLOOR_Y) {
    playerPosition.y = FLOOR_Y;
    velocityY = 0;
  }

  for (const c of OBSTACLE_CENTERS) {
    const obs = getObstacleAABB(c);
    const playerBox = getPlayerAABB(playerPosition);
    if (!aabbOverlap(playerBox, obs)) continue;
    if (velocityY <= 0) {
      playerPosition.y = obs.max.y + PLAYER_HALF_EXTENT;
      velocityY = 0;
    } else {
      playerPosition.y = Math.max(obs.min.y - PLAYER_HALF_EXTENT, FLOOR_Y);
      velocityY = 0;
    }
  }

  isInAir = playerPosition.y > FLOOR_Y + 0.001;

  playerPosition.x = Math.max(-FLOOR_HALF_SIZE + PLAYER_HALF_EXTENT, Math.min(FLOOR_HALF_SIZE - PLAYER_HALF_EXTENT, playerPosition.x));
  playerPosition.z = Math.max(-FLOOR_HALF_SIZE + PLAYER_HALF_EXTENT, Math.min(FLOOR_HALF_SIZE - PLAYER_HALF_EXTENT, playerPosition.z));

  const rootY = playerPosition.y - 0.5;
  character.position.set(playerPosition.x, rootY, playerPosition.z);
  character.rotation.y = yaw;

  updateCharacterAnimation(dt);

  // Update projectiles
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.mesh.position.addScaledVector(p.velocity, dt);
    const pos = p.mesh.position;
    let remove = false;
    if (pos.distanceTo(playerPosition) > PROJECTILE_MAX_DIST) remove = true;
    if (pos.y < -5) remove = true;
    for (const c of OBSTACLE_CENTERS) {
      if (aabbOverlap(getProjectileAABB(pos), getObstacleAABB(c))) {
        remove = true;
        break;
      }
    }
    if (remove) {
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
    }
  }

  camera.position.copy(playerPosition).sub(front.clone().multiplyScalar(CAMERA_DISTANCE)).add(new THREE.Vector3(0, CAMERA_HEIGHT, 0));
  camera.lookAt(playerPosition);
}

// --- Loop ---
function loop() {
  requestAnimationFrame(loop);
  update();
  renderer.render(scene, camera);
}

loop();
