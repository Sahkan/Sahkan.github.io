#!/usr/bin/env bash
# Build WASM game module (requires Emscripten: https://emscripten.org/docs/getting_started/downloads.html)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
emcc game.c -o game.js \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="createGameModule" \
  -s EXPORTED_FUNCTIONS='["_malloc","_free","_game_init","_game_update","_game_get_player_position","_game_get_player_x","_game_get_player_y","_game_get_player_angle","_game_get_bullet_count","_game_get_bullet","_game_get_bullet_x","_game_get_bullet_y","_game_get_bullet_vx","_game_get_bullet_vy","_game_get_enemy_count","_game_get_enemy","_game_get_enemy_x","_game_get_enemy_y","_game_get_enemy_width","_game_get_enemy_height","_game_get_enemy_rotation","_game_get_enemy_color","_game_get_particle_count","_game_get_particle","_game_get_particle_x","_game_get_particle_y","_game_get_particle_vx","_game_get_particle_vy","_game_get_particle_life","_game_get_particle_size","_game_get_particle_color"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
  -s INITIAL_MEMORY=67108864 \
  -O2
echo "Build complete. Output: game.js, game.wasm"
