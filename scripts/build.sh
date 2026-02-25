#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
esac

rm -rf "$DIST"
mkdir -p "$DIST/bin" "$DIST/lib"

echo "Compiling binary..."
bun build --compile --minify --external onnxruntime-web "$ROOT/src/main.ts" --outfile "$DIST/bin/murmur-bin"

echo "Copying native libraries..."
ONNX_DIR="$ROOT/node_modules/onnxruntime-node/bin/napi-v6/$OS/$ARCH"
cp "$ONNX_DIR"/libonnxruntime.* "$DIST/lib/"

# Always bundle the shared provider (15KB) — needed for provider detection even on CPU
[ -f "$ONNX_DIR/libonnxruntime_providers_shared.so" ] && cp "$ONNX_DIR/libonnxruntime_providers_shared.so" "$DIST/lib/"

cp "$ROOT/node_modules/espeak-ng/dist/espeak-ng.wasm" "$DIST/lib/"

echo "Creating wrapper..."
if [ "$OS" = "linux" ]; then
  cat > "$DIST/murmur" << 'WRAPPER'
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Build library path: bundled libs + CUDA toolkit (auto-detect) + existing paths
_LP="${SCRIPT_DIR}/lib"
for _d in "/usr/local/cuda/lib64" "/usr/lib/x86_64-linux-gnu" "/usr/lib/aarch64-linux-gnu"; do
  [ -d "$_d" ] && _LP="${_LP}:${_d}"
done
[ -n "${LD_LIBRARY_PATH:-}" ] && _LP="${_LP}:${LD_LIBRARY_PATH}"
cd "${SCRIPT_DIR}" && MURMUR_LIB_DIR="${SCRIPT_DIR}/lib" LD_LIBRARY_PATH="$_LP" exec "${SCRIPT_DIR}/bin/murmur-bin" "$@"
WRAPPER
else
  cat > "$DIST/murmur" << 'WRAPPER'
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${SCRIPT_DIR}" && MURMUR_LIB_DIR="${SCRIPT_DIR}/lib" DYLD_LIBRARY_PATH="${SCRIPT_DIR}/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" exec "${SCRIPT_DIR}/bin/murmur-bin" "$@"
WRAPPER
fi
chmod +x "$DIST/murmur"

echo "Build complete: dist/murmur"
