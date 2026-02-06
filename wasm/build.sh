#!/usr/bin/env bash
# Build WASM game module (requires Emscripten: https://emscripten.org/docs/getting_started/downloads.html)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
emcc game.c -o game.js \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="createGameModule" \
  -s EXPORTED_FUNCTIONS='["_malloc","_free","_game_init","_game_update","_game_get_player_position","_game_get_player_x","_game_get_player_y","_game_get_player_z","_game_get_player_rotation","_game_get_player_yaw","_game_get_player_pitch","_game_get_front","_game_get_front_x","_game_get_front_y","_game_get_front_z","_game_get_projectile_count","_game_get_projectile","_game_get_projectile_x","_game_get_projectile_y","_game_get_projectile_z","_game_get_obstacle_count","_game_get_obstacle","_game_get_obstacle_x","_game_get_obstacle_y","_game_get_obstacle_z","_game_get_is_moving","_game_get_is_in_air","_game_get_run_time"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
  -s INITIAL_MEMORY=16777216 \
  -O2
echo "Build complete. Output: game.js, game.wasm"
