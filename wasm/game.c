#include "game.h"
#include <math.h>
#include <string.h>

/* Constants (match JS game) */
#define MOVE_SPEED 5.f
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

typedef struct { float x, y, z; } Vec3;
typedef struct { float x, y, z, vx, vy, vz; } Projectile;

static Vec3 obstacle_centers[NUM_OBSTACLES];
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

static void reflect_velocity_off_normal(float* vx, float* vy, float* vz,
                                       float nx, float ny, float nz, float bounce_coeff) {
  float dot = (*vx) * nx + (*vy) * ny + (*vz) * nz;
  *vx = (*vx) - 2.f * dot * nx * bounce_coeff;
  *vy = (*vy) - 2.f * dot * ny * bounce_coeff;
  *vz = (*vz) - 2.f * dot * nz * bounce_coeff;
}

static int would_overlap_obstacle(float px, float py, float pz) {
  float h = PLAYER_HALF_EXTENT;
  float pmin_x = px - h, pmin_y = py - h, pmin_z = pz - h;
  float pmax_x = px + h, pmax_y = py + h, pmax_z = pz + h;
  for (int i = 0; i < NUM_OBSTACLES; i++) {
    Vec3 c = obstacle_centers[i];
    float o = OBSTACLE_HALF_EXTENT;
    if (aabb_overlap(pmin_x, pmin_y, pmin_z, pmax_x, pmax_y, pmax_z,
                    c.x - o, c.y - o, c.z - o, c.x + o, c.y + o, c.z + o))
      return 1;
  }
  return 0;
}

void game_init(void) {
  vec3_set(&player_position, 0.f, 0.5f, 3.f);
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
    while (n < NUM_OBSTACLES) {
      float x = rng_float(-span, span);
      float z = rng_float(-span, span);
      float dx = x - 0.f, dz = z - 3.f;
      if (dx * dx + dz * dz < spawn_radius_sq) continue;
      obstacle_centers[n].x = x;
      obstacle_centers[n].y = 0.5f;
      obstacle_centers[n].z = z;
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

  float vx = 0.f, vz = 0.f;
  if (keys & 1)  { vx += front_xz.x * MOVE_SPEED * dt; vz += front_xz.z * MOVE_SPEED * dt; } /* W */
  if (keys & 2)  { vx -= front_xz.x * MOVE_SPEED * dt; vz -= front_xz.z * MOVE_SPEED * dt; } /* S */
  if (keys & 4)  { vx -= right.x * MOVE_SPEED * dt; vz -= right.z * MOVE_SPEED * dt; }       /* A */
  if (keys & 8)  { vx += right.x * MOVE_SPEED * dt; vz += right.z * MOVE_SPEED * dt; }       /* D */

  float new_x = player_position.x + vx;
  if (!would_overlap_obstacle(new_x, player_position.y, player_position.z))
    player_position.x = new_x;
  float new_z = player_position.z + vz;
  if (!would_overlap_obstacle(player_position.x, player_position.y, new_z))
    player_position.z = new_z;

  is_moving = (vx * vx + vz * vz > 1e-6f);

  /* Jump */
  if ((keys & 16) && player_position.y <= FLOOR_Y + 0.001f && velocity_y <= 0.f)
    velocity_y = JUMP_SPEED;

  velocity_y -= GRAVITY * dt;
  player_position.y += velocity_y * dt;

  if (player_position.y < FLOOR_Y) {
    player_position.y = FLOOR_Y;
    velocity_y = 0.f;
  }

  /* Obstacle collision (vertical) */
  float h = PLAYER_HALF_EXTENT;
  for (int i = 0; i < NUM_OBSTACLES; i++) {
    Vec3 c = obstacle_centers[i];
    float o = OBSTACLE_HALF_EXTENT;
    if (!aabb_overlap(
          player_position.x - h, player_position.y - h, player_position.z - h,
          player_position.x + h, player_position.y + h, player_position.z + h,
          c.x - o, c.y - o, c.z - o, c.x + o, c.y + o, c.z + o))
      continue;
    if (velocity_y <= 0.f) {
      player_position.y = c.y + o + h;
      velocity_y = 0.f;
    } else {
      float land = (c.y - o - h) > FLOOR_Y ? (c.y - o - h) : FLOOR_Y;
      player_position.y = land;
      velocity_y = 0.f;
    }
  }

  is_in_air = (player_position.y > FLOOR_Y + 0.001f);

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
    float floor_top = 0.25f; // Floor top surface (floor center Y is -0.25, half height 0.25, so top is 0)
    
    // Floor collision and bounce
    if (p->y - pr < floor_top) {
      p->y = floor_top + pr; // Move projectile above floor
      p->vy = -p->vy * PROJECTILE_BOUNCE_COEFFICIENT; // Bounce with energy loss
      // Small friction on floor
      p->vx *= 0.95f;
      p->vz *= 0.95f;
    }
    
    // Obstacle collision and bounce
    for (int j = 0; j < NUM_OBSTACLES && !remove; j++) {
      Vec3 c = obstacle_centers[j];
      float o = OBSTACLE_HALF_EXTENT;
      if (sphere_aabb_overlap(p->x, p->y, p->z, pr,
                              c.x - o, c.y - o, c.z - o,
                              c.x + o, c.y + o, c.z + o)) {
        // Calculate collision normal (from obstacle center to projectile)
        float nx = p->x - c.x, ny = p->y - c.y, nz = p->z - c.z;
        float len = sqrtf(nx*nx + ny*ny + nz*nz);
        if (len > 1e-6f) {
          nx /= len; ny /= len; nz /= len;
        } else {
          // If projectile is exactly at center, use up vector
          nx = 0.f; ny = 1.f; nz = 0.f;
        }
        
        // Move projectile out of obstacle
        float overlap = pr + o - len;
        if (overlap > 0.f && len > 1e-6f) {
          p->x += nx * overlap;
          p->y += ny * overlap;
          p->z += nz * overlap;
        }
        
        // Bounce off obstacle
        reflect_velocity_off_normal(&p->vx, &p->vy, &p->vz, nx, ny, nz, PROJECTILE_BOUNCE_COEFFICIENT);
        
        // Remove if velocity is too low (projectile has lost too much energy)
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

int game_get_is_moving(void) { return is_moving; }
int game_get_is_in_air(void) { return is_in_air; }
float game_get_run_time(void) { return run_time; }
