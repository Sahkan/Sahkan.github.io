#include "game.h"
#include <math.h>
#include <string.h>

/* Constants (match JS game) */
#define MOVE_SPEED 5.f
#define RUN_SPEED_MULTIPLIER 1.8f  /* hold Shift to run */
#define MOUSE_SENSITIVITY 0.002f
#define PLAYER_HALF_EXTENT 0.5f
#define FLOOR_HALF_SIZE 250.f
#define GRAVITY 18.f
#define JUMP_SPEED 8.f
#define FLOOR_Y 0.5f
#define OBSTACLE_HALF_EXTENT 0.5f
#define RUN_CYCLE_DURATION 0.4f
#define PROJECTILE_SPEED 25.f
#define PROJECTILE_RADIUS 0.15f
#define PROJECTILE_MAX_DIST 50.f
#define PROJECTILE_BOUNCE_COEFFICIENT 0.7f
#define MAX_PITCH_RAD ((89.f * 3.14159265f) / 180.f)

#define OBSTACLE_TYPE_CUBE    0
#define OBSTACLE_TYPE_SPHERE  1
#define OBSTACLE_TYPE_TRIANGLE 2
#define OBSTACLE_SPHERE_RADIUS 0.5f
#define OBSTACLE_TRIANGLE_HALF_Y 0.25f
#define OBSTACLE_PLACEMENT_GAP 0.25f  /* min distance between obstacle surfaces */

/* Terrain height = world Y of surface. JS plane: vertex (x, y, -h) -> after rotateX(-90) -> (x, -h, -y), so world (x, z) = (x, -y) and world Y = -h(x, -z). */
#define TERRAIN_SCALE 0.04f
#define TERRAIN_AMP 6.f
#define TERRAIN_OBSTACLE_CLEARANCE 0.01f  /* minimal lift so obstacles sit on terrain, not float */
static float terrain_height(float x, float z) {
  float plane_y = -z; /* world Z = -plane Y */
  float h = TERRAIN_AMP * (
    0.5f * sinf(x * TERRAIN_SCALE) * cosf(plane_y * TERRAIN_SCALE * 0.8f) +
    0.4f * sinf(x * TERRAIN_SCALE * 1.3f + 1.f) * cosf(plane_y * TERRAIN_SCALE * 1.1f + 0.5f) +
    0.3f * sinf((x + plane_y) * TERRAIN_SCALE * 0.5f));
  return -h; /* world Y = -h */
}
/* Max terrain height under an obstacle's footprint (3x3 grid to catch peaks on bumpy terrain) */
static float terrain_height_under_footprint(float x, float z, float half_ext) {
  float max_y = terrain_height(x, z);
  float step = half_ext; /* 3x3 grid over full footprint: -half_ext, 0, +half_ext */
  for (int ix = -1; ix <= 1; ix++) {
    for (int iz = -1; iz <= 1; iz++) {
      float sx = x + (float)ix * step;
      float sz = z + (float)iz * step;
      float ty = terrain_height(sx, sz);
      if (ty > max_y) max_y = ty;
    }
  }
  return max_y + TERRAIN_OBSTACLE_CLEARANCE;
}

typedef struct { float x, y, z; } Vec3;
typedef struct { float x, y, z, vx, vy, vz; } Projectile;

static Vec3 obstacle_centers[NUM_OBSTACLES];
static unsigned char obstacle_types[NUM_OBSTACLES]; /* 0=cube, 1=sphere, 2=triangle */
static float obstacle_rotations[NUM_OBSTACLES];
static float obstacle_rotation_speeds[NUM_OBSTACLES];
static unsigned int obstacle_colors[NUM_OBSTACLES]; /* RGB packed as 0xRRGGBB */
static unsigned int rng_state = 12345u;

static unsigned int rng_next(void) {
  unsigned int x = rng_state;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  rng_state = x;
  return x;
}

static float rng_float(float min_val, float max_val) {
  return min_val + (max_val - min_val) * ((float)(rng_next() % 65536u) / 65536.f);
}

static Vec3 player_position;
static float yaw, pitch;
static float velocity_y;
static int is_moving, is_in_air;
static float run_time;
static unsigned int keys_mask;
static int pointer_locked;
static Projectile projectiles[MAX_PROJECTILES];
static int projectile_count;
static float pending_mouse_dx, pending_mouse_dy;
static int pending_shoot;

static void vec3_set(Vec3* v, float x, float y, float z) {
  v->x = x; v->y = y; v->z = z;
}

static float vec3_len_sq(Vec3* v) {
  return v->x * v->x + v->y * v->y + v->z * v->z;
}

static void vec3_normalize(Vec3* v) {
  float len = sqrtf(v->x * v->x + v->y * v->y + v->z * v->z);
  if (len > 1e-10f) {
    v->x /= len; v->y /= len; v->z /= len;
  }
}

static int aabb_overlap(float min_ax, float min_ay, float min_az,
                       float max_ax, float max_ay, float max_az,
                       float min_bx, float min_by, float min_bz,
                       float max_bx, float max_by, float max_bz) {
  return min_ax < max_bx && max_ax > min_bx &&
         min_ay < max_by && max_ay > min_by &&
         min_az < max_bz && max_az > min_bz;
}

static int sphere_aabb_overlap(float sx, float sy, float sz, float radius,
                               float min_x, float min_y, float min_z,
                               float max_x, float max_y, float max_z) {
  float closest_x = sx < min_x ? min_x : (sx > max_x ? max_x : sx);
  float closest_y = sy < min_y ? min_y : (sy > max_y ? max_y : sy);
  float closest_z = sz < min_z ? min_z : (sz > max_z ? max_z : sz);
  float dx = sx - closest_x, dy = sy - closest_y, dz = sz - closest_z;
  return (dx*dx + dy*dy + dz*dz) < (radius * radius);
}

static int sphere_sphere_overlap(float x1, float y1, float z1, float r1,
                                 float x2, float y2, float z2, float r2) {
  float dx = x1 - x2, dy = y1 - y2, dz = z1 - z2;
  float dist_sq = dx*dx + dy*dy + dz*dz;
  float sum_r = r1 + r2;
  return dist_sq < (sum_r * sum_r);
}

static int aabb_sphere_overlap(float min_x, float min_y, float min_z,
                               float max_x, float max_y, float max_z,
                               float sx, float sy, float sz, float radius) {
  return sphere_aabb_overlap(sx, sy, sz, radius, min_x, min_y, min_z, max_x, max_y, max_z);
}

static void reflect_velocity_off_normal(float* vx, float* vy, float* vz,
                                       float nx, float ny, float nz, float bounce_coeff) {
  float dot = (*vx) * nx + (*vy) * ny + (*vz) * nz;
  *vx = (*vx) - 2.f * dot * nx * bounce_coeff;
  *vy = (*vy) - 2.f * dot * ny * bounce_coeff;
  *vz = (*vz) - 2.f * dot * nz * bounce_coeff;
}

static void obstacle_bounds(int i, float* out_min_x, float* out_min_y, float* out_min_z,
                           float* out_max_x, float* out_max_y, float* out_max_z) {
  Vec3 c = obstacle_centers[i];
  int t = (int)obstacle_types[i];
  if (t == OBSTACLE_TYPE_CUBE) {
    float o = OBSTACLE_HALF_EXTENT;
    *out_min_x = c.x - o; *out_min_y = c.y - o; *out_min_z = c.z - o;
    *out_max_x = c.x + o; *out_max_y = c.y + o; *out_max_z = c.z + o;
  } else if (t == OBSTACLE_TYPE_SPHERE) {
    float r = OBSTACLE_SPHERE_RADIUS;
    *out_min_x = c.x - r; *out_min_y = c.y - r; *out_min_z = c.z - r;
    *out_max_x = c.x + r; *out_max_y = c.y + r; *out_max_z = c.z + r;
  } else {
    float o = OBSTACLE_HALF_EXTENT;
    float ty = OBSTACLE_TRIANGLE_HALF_Y;
    *out_min_x = c.x - o; *out_min_y = c.y - ty; *out_min_z = c.z - o;
    *out_max_x = c.x + o; *out_max_y = c.y + ty; *out_max_z = c.z + o;
  }
}

/* Returns 1 if obstacle n (center + type already set) would touch any obstacle with index < n. */
static int would_new_obstacle_touch_others(int n) {
  const float margin = OBSTACLE_PLACEMENT_GAP * 0.5f + 1e-4f; /* half-gap + epsilon for float safety */
  float n_min_x, n_min_y, n_min_z, n_max_x, n_max_y, n_max_z;
  obstacle_bounds(n, &n_min_x, &n_min_y, &n_min_z, &n_max_x, &n_max_y, &n_max_z);
  n_min_x -= margin; n_min_y -= margin; n_min_z -= margin;
  n_max_x += margin; n_max_y += margin; n_max_z += margin;
  for (int i = 0; i < n; i++) {
    float i_min_x, i_min_y, i_min_z, i_max_x, i_max_y, i_max_z;
    obstacle_bounds(i, &i_min_x, &i_min_y, &i_min_z, &i_max_x, &i_max_y, &i_max_z);
    i_min_x -= margin; i_min_y -= margin; i_min_z -= margin;
    i_max_x += margin; i_max_y += margin; i_max_z += margin;  /* same margin as above */
    if (aabb_overlap(n_min_x, n_min_y, n_min_z, n_max_x, n_max_y, n_max_z,
                     i_min_x, i_min_y, i_min_z, i_max_x, i_max_y, i_max_z))
      return 1;
  }
  return 0;
}

static int would_overlap_obstacle(float px, float py, float pz) {
  float h = PLAYER_HALF_EXTENT;
  float pmin_x = px - h, pmin_y = py - h, pmin_z = pz - h;
  float pmax_x = px + h, pmax_y = py + h, pmax_z = pz + h;
  for (int i = 0; i < NUM_OBSTACLES; i++) {
    Vec3 c = obstacle_centers[i];
    int t = (int)obstacle_types[i];
    if (t == OBSTACLE_TYPE_SPHERE) {
      if (sphere_aabb_overlap(c.x, c.y, c.z, OBSTACLE_SPHERE_RADIUS,
                              pmin_x, pmin_y, pmin_z, pmax_x, pmax_y, pmax_z)) return 1;
    } else {
      float o_min_x, o_min_y, o_min_z, o_max_x, o_max_y, o_max_z;
      obstacle_bounds(i, &o_min_x, &o_min_y, &o_min_z, &o_max_x, &o_max_y, &o_max_z);
      if (aabb_overlap(pmin_x, pmin_y, pmin_z, pmax_x, pmax_y, pmax_z,
                      o_min_x, o_min_y, o_min_z, o_max_x, o_max_y, o_max_z)) return 1;
    }
  }
  return 0;
}

void game_init(void) {
  float px = 0.f, pz = 3.f;
  player_position.x = px;
  player_position.z = pz;
  player_position.y = terrain_height(px, pz) + PLAYER_HALF_EXTENT;
  yaw = 0.f;
  pitch = 0.f;
  velocity_y = 0.f;
  is_moving = 0;
  is_in_air = 0;
  run_time = 0.f;
  keys_mask = 0;
  pointer_locked = 0;
  projectile_count = 0;
  pending_mouse_dx = 0.f;
  pending_mouse_dy = 0.f;
  pending_shoot = 0;

  rng_state = 12345u;
  {
    const float span = FLOOR_HALF_SIZE - 2.f;
    const float spawn_radius_sq = 36.f;
    int n = 0;
#define PLACEMENT_MAX_ATTEMPTS 600
    while (n < NUM_OBSTACLES) {
      int attempts = 0;
      for (;;) {
        if (attempts >= PLACEMENT_MAX_ATTEMPTS) break;
        float x = rng_float(-span, span);
        float z = rng_float(-span, span);
        float dx = x - 0.f, dz = z - 3.f;
        if (dx * dx + dz * dz < spawn_radius_sq) { attempts++; continue; }
        obstacle_centers[n].x = x;
        obstacle_centers[n].z = z;
        obstacle_types[n] = (unsigned char)(rng_next() % 3); /* 0=cube, 1=sphere, 2=triangle */
        /* Place obstacle so entire base clears terrain (sample under footprint to avoid clipping) */
        {
          float bottom_y = terrain_height_under_footprint(x, z, OBSTACLE_HALF_EXTENT);
          int t = (int)obstacle_types[n];
          if (t == OBSTACLE_TYPE_TRIANGLE)
            obstacle_centers[n].y = bottom_y + OBSTACLE_TRIANGLE_HALF_Y;
          else
            obstacle_centers[n].y = bottom_y + OBSTACLE_HALF_EXTENT; /* cube or sphere */
        }
        if (!would_new_obstacle_touch_others(n)) break; /* gap OK */
        attempts++;
      }
      obstacle_rotations[n] = rng_float(0.f, 6.28318530718f);
      obstacle_rotation_speeds[n] = rng_float(0.5f, 3.f);
      {
        unsigned int r = (unsigned int)(rng_float(0.f, 255.f));
        unsigned int g = (unsigned int)(rng_float(0.f, 255.f));
        unsigned int b = (unsigned int)(rng_float(0.f, 255.f));
        obstacle_colors[n] = (r << 16) | (g << 8) | b;
      }
      n++;
    }
  }
}

void game_update(float dt, unsigned int keys, float mouse_dx, float mouse_dy, int shoot) {
  keys_mask = keys;
  pending_mouse_dx = mouse_dx;
  pending_mouse_dy = mouse_dy;
  pending_shoot = shoot;

  if (dt > 0.1f) dt = 0.1f;

  /* Mouse */
  yaw -= mouse_dx * MOUSE_SENSITIVITY;
  pitch -= mouse_dy * MOUSE_SENSITIVITY;
  if (pitch > MAX_PITCH_RAD) pitch = MAX_PITCH_RAD;
  if (pitch < -MAX_PITCH_RAD) pitch = -MAX_PITCH_RAD;

  /* Front vector (normalized) */
  float cp = cosf(pitch), sp = sinf(pitch), cy = cosf(yaw), sy = sinf(yaw);
  Vec3 front = { cp * sy, sp, cp * cy };
  vec3_normalize(&front);

  Vec3 front_xz = { front.x, 0.f, front.z };
  vec3_normalize(&front_xz);
  if (vec3_len_sq(&front_xz) < 1e-6f) {
    front_xz.x = 0.f; front_xz.y = 0.f; front_xz.z = -1.f;
  }
  /* right = cross(up, front_xz); negate so A=left, D=right match typical FPS */
  Vec3 right = { -front_xz.z, 0.f, front_xz.x };
  vec3_normalize(&right);

  float move_speed = (keys & 32) ? (MOVE_SPEED * RUN_SPEED_MULTIPLIER) : MOVE_SPEED; /* Shift = run */
  float vx = 0.f, vz = 0.f;
  if (keys & 1)  { vx += front_xz.x * move_speed * dt; vz += front_xz.z * move_speed * dt; } /* W */
  if (keys & 2)  { vx -= front_xz.x * move_speed * dt; vz -= front_xz.z * move_speed * dt; } /* S */
  if (keys & 4)  { vx -= right.x * move_speed * dt; vz -= right.z * move_speed * dt; }       /* A */
  if (keys & 8)  { vx += right.x * move_speed * dt; vz += right.z * move_speed * dt; }       /* D */

  float new_x = player_position.x + vx;
  if (!would_overlap_obstacle(new_x, player_position.y, player_position.z))
    player_position.x = new_x;
  float new_z = player_position.z + vz;
  if (!would_overlap_obstacle(player_position.x, player_position.y, new_z))
    player_position.z = new_z;

  is_moving = (vx * vx + vz * vz > 1e-6f);

  float floor_y = terrain_height(player_position.x, player_position.z);
  float player_feet = floor_y + PLAYER_HALF_EXTENT;

  /* Jump */
  if ((keys & 16) && player_position.y <= player_feet + 0.001f && velocity_y <= 0.f)
    velocity_y = JUMP_SPEED;

  velocity_y -= GRAVITY * dt;
  player_position.y += velocity_y * dt;

  if (player_position.y < player_feet) {
    player_position.y = player_feet;
    velocity_y = 0.f;
  }

  /* Obstacle collision (vertical) */
  float h = PLAYER_HALF_EXTENT;
  for (int i = 0; i < NUM_OBSTACLES; i++) {
    Vec3 c = obstacle_centers[i];
    int t = (int)obstacle_types[i];
    float o_top, o_bottom;
    if (t == OBSTACLE_TYPE_CUBE) {
      o_top = c.y + OBSTACLE_HALF_EXTENT;
      o_bottom = c.y - OBSTACLE_HALF_EXTENT;
    } else if (t == OBSTACLE_TYPE_SPHERE) {
      o_top = c.y + OBSTACLE_SPHERE_RADIUS;
      o_bottom = c.y - OBSTACLE_SPHERE_RADIUS;
    } else {
      o_top = c.y + OBSTACLE_TRIANGLE_HALF_Y;
      o_bottom = c.y - OBSTACLE_TRIANGLE_HALF_Y;
    }
    float o_min_x, o_min_y, o_min_z, o_max_x, o_max_y, o_max_z;
    obstacle_bounds(i, &o_min_x, &o_min_y, &o_min_z, &o_max_x, &o_max_y, &o_max_z);
    if (!aabb_overlap(
          player_position.x - h, player_position.y - h, player_position.z - h,
          player_position.x + h, player_position.y + h, player_position.z + h,
          o_min_x, o_min_y, o_min_z, o_max_x, o_max_y, o_max_z))
      continue;
    if (velocity_y <= 0.f) {
      player_position.y = o_top + h;
      velocity_y = 0.f;
    } else {
      float land = (o_bottom - h) > floor_y ? (o_bottom - h) : floor_y;
      player_position.y = land + h;
      velocity_y = 0.f;
    }
  }

  is_in_air = (player_position.y > player_feet + 0.001f);

  /* Clamp to floor bounds */
  float margin = FLOOR_HALF_SIZE - PLAYER_HALF_EXTENT;
  if (player_position.x < -margin) player_position.x = -margin;
  if (player_position.x > margin)  player_position.x = margin;
  if (player_position.z < -margin) player_position.z = -margin;
  if (player_position.z > margin)  player_position.z = margin;

  if (is_moving && !is_in_air) run_time += dt;

  /* Shoot */
  if (pending_shoot && projectile_count < MAX_PROJECTILES) {
    Projectile* p = &projectiles[projectile_count++];
    p->x = player_position.x;
    p->y = player_position.y;
    p->z = player_position.z;
    p->vx = front.x * PROJECTILE_SPEED;
    p->vy = front.y * PROJECTILE_SPEED;
    p->vz = front.z * PROJECTILE_SPEED;
  }

  /* Update projectiles */
  for (int i = projectile_count - 1; i >= 0; i--) {
    Projectile* p = &projectiles[i];
    p->x += p->vx * dt;
    p->y += p->vy * dt;
    p->z += p->vz * dt;

    int remove = 0;
    float dx = p->x - player_position.x, dy = p->y - player_position.y, dz = p->z - player_position.z;
    if (dx*dx + dy*dy + dz*dz > PROJECTILE_MAX_DIST * PROJECTILE_MAX_DIST) remove = 1;
    if (p->y < -10.f) remove = 1; // Remove if too far below floor
    
    float pr = PROJECTILE_RADIUS;
    float floor_top = terrain_height(p->x, p->z);
    
    /* Floor (terrain) collision and bounce */
    if (p->y - pr < floor_top) {
      p->y = floor_top + pr;
      p->vy = -p->vy * PROJECTILE_BOUNCE_COEFFICIENT; // Bounce with energy loss
      // Small friction on floor
      p->vx *= 0.95f;
      p->vz *= 0.95f;
    }
    
    // Obstacle collision and bounce
    for (int j = 0; j < NUM_OBSTACLES && !remove; j++) {
      Vec3 c = obstacle_centers[j];
      int t = (int)obstacle_types[j];
      int hit = 0;
      float nx = 0.f, ny = 1.f, nz = 0.f;
      float o_min_x, o_min_y, o_min_z, o_max_x, o_max_y, o_max_z;
      obstacle_bounds(j, &o_min_x, &o_min_y, &o_min_z, &o_max_x, &o_max_y, &o_max_z);
      
      if (t == OBSTACLE_TYPE_SPHERE) {
        if (sphere_sphere_overlap(p->x, p->y, p->z, pr, c.x, c.y, c.z, OBSTACLE_SPHERE_RADIUS)) {
          hit = 1;
          float dx = p->x - c.x, dy = p->y - c.y, dz = p->z - c.z;
          float len = sqrtf(dx*dx + dy*dy + dz*dz);
          if (len > 1e-6f) { nx = dx/len; ny = dy/len; nz = dz/len; }
        }
      } else {
        if (sphere_aabb_overlap(p->x, p->y, p->z, pr, o_min_x, o_min_y, o_min_z, o_max_x, o_max_y, o_max_z)) {
          hit = 1;
          float dx = p->x - c.x, dy = p->y - c.y, dz = p->z - c.z;
          float len = sqrtf(dx*dx + dy*dy + dz*dz);
          if (len > 1e-6f) { nx = dx/len; ny = dy/len; nz = dz/len; }
        }
      }
      
      if (hit) {
        float obs_r = (t == OBSTACLE_TYPE_SPHERE) ? OBSTACLE_SPHERE_RADIUS : OBSTACLE_HALF_EXTENT;
        float dx = p->x - c.x, dy = p->y - c.y, dz = p->z - c.z;
        float len = sqrtf(dx*dx + dy*dy + dz*dz);
        float overlap = pr + obs_r - len;
        if (overlap > 0.f && len > 1e-6f) {
          p->x += nx * overlap;
          p->y += ny * overlap;
          p->z += nz * overlap;
        }
        reflect_velocity_off_normal(&p->vx, &p->vy, &p->vz, nx, ny, nz, PROJECTILE_BOUNCE_COEFFICIENT);
        float speed_sq = p->vx*p->vx + p->vy*p->vy + p->vz*p->vz;
        if (speed_sq < 1.f) remove = 1;
      }
    }
    
    if (remove) {
      projectiles[i] = projectiles[--projectile_count];
    }
  }

  /* Update obstacle rotations */
  for (int i = 0; i < NUM_OBSTACLES; i++) {
    obstacle_rotations[i] += obstacle_rotation_speeds[i] * dt;
    if (obstacle_rotations[i] > 6.28318530718f) {
      obstacle_rotations[i] -= 6.28318530718f;
    }
  }
}

void game_get_player_position(float* x, float* y, float* z) {
  *x = player_position.x; *y = player_position.y; *z = player_position.z;
}
float game_get_player_x(void) { return player_position.x; }
float game_get_player_y(void) { return player_position.y; }
float game_get_player_z(void) { return player_position.z; }

void game_get_player_rotation(float* yaw_out, float* pitch_out) {
  *yaw_out = yaw; *pitch_out = pitch;
}
float game_get_player_yaw(void) { return yaw; }
float game_get_player_pitch(void) { return pitch; }

void game_get_front(float* x, float* y, float* z) {
  float cp = cosf(pitch), sp = sinf(pitch), cy = cosf(yaw), sy = sinf(yaw);
  Vec3 front = { cp * sy, sp, cp * cy };
  vec3_normalize(&front);
  *x = front.x; *y = front.y; *z = front.z;
}
float game_get_front_x(void) {
  float cp = cosf(pitch), sp = sinf(pitch), cy = cosf(yaw), sy = sinf(yaw);
  Vec3 front = { cp * sy, sp, cp * cy };
  vec3_normalize(&front);
  return front.x;
}
float game_get_front_y(void) {
  float cp = cosf(pitch), sp = sinf(pitch), cy = cosf(yaw), sy = sinf(yaw);
  Vec3 front = { cp * sy, sp, cp * cy };
  vec3_normalize(&front);
  return front.y;
}
float game_get_front_z(void) {
  float cp = cosf(pitch), sp = sinf(pitch), cy = cosf(yaw), sy = sinf(yaw);
  Vec3 front = { cp * sy, sp, cp * cy };
  vec3_normalize(&front);
  return front.z;
}

int game_get_projectile_count(void) { return projectile_count; }

void game_get_projectile(int i, float* x, float* y, float* z, float* vx, float* vy, float* vz) {
  if (i < 0 || i >= projectile_count) return;
  Projectile* p = &projectiles[i];
  *x = p->x; *y = p->y; *z = p->z;
  *vx = p->vx; *vy = p->vy; *vz = p->vz;
}
float game_get_projectile_x(int i) { return (i >= 0 && i < projectile_count) ? projectiles[i].x : 0.f; }
float game_get_projectile_y(int i) { return (i >= 0 && i < projectile_count) ? projectiles[i].y : 0.f; }
float game_get_projectile_z(int i) { return (i >= 0 && i < projectile_count) ? projectiles[i].z : 0.f; }

int game_get_obstacle_count(void) { return NUM_OBSTACLES; }

void game_get_obstacle(int i, float* x, float* y, float* z) {
  if (i < 0 || i >= NUM_OBSTACLES) return;
  *x = obstacle_centers[i].x;
  *y = obstacle_centers[i].y;
  *z = obstacle_centers[i].z;
}
float game_get_obstacle_x(int i) { return (i >= 0 && i < NUM_OBSTACLES) ? obstacle_centers[i].x : 0.f; }
float game_get_obstacle_y(int i) { return (i >= 0 && i < NUM_OBSTACLES) ? obstacle_centers[i].y : 0.f; }
float game_get_obstacle_z(int i) { return (i >= 0 && i < NUM_OBSTACLES) ? obstacle_centers[i].z : 0.f; }
float game_get_obstacle_rotation(int i) { return (i >= 0 && i < NUM_OBSTACLES) ? obstacle_rotations[i] : 0.f; }
unsigned int game_get_obstacle_color(int i) { return (i >= 0 && i < NUM_OBSTACLES) ? obstacle_colors[i] : 0x808080; }
int game_get_obstacle_type(int i) { return (i >= 0 && i < NUM_OBSTACLES) ? (int)obstacle_types[i] : 0; }

int game_get_is_moving(void) { return is_moving; }
int game_get_is_in_air(void) { return is_in_air; }
float game_get_run_time(void) { return run_time; }
