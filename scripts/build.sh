#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"

rm -rf "$DIST"
mkdir -p "$DIST/bin" "$DIST/lib"

echo "Compiling binary..."
bun build --compile "$ROOT/src/main.ts" --outfile "$DIST/bin/murmur-bin"

echo "Copying native libraries..."
if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "Error: build.sh currently supports only Linux x86_64" >&2
  exit 1
fi
ONNX_DIR="$ROOT/node_modules/onnxruntime-node/bin/napi-v6/linux/x64"
cp "$ONNX_DIR/libonnxruntime.so.1" "$DIST/lib/"
cp "$ONNX_DIR/onnxruntime_binding.node" "$DIST/lib/"
cp "$ROOT/node_modules/espeak-ng/dist/espeak-ng.wasm" "$DIST/lib/"

echo "Creating wrapper..."
cat > "$DIST/murmur" << 'WRAPPER'
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MURMUR_LIB_DIR="${SCRIPT_DIR}/lib" LD_LIBRARY_PATH="${SCRIPT_DIR}/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" exec "${SCRIPT_DIR}/bin/murmur-bin" "$@"
WRAPPER
chmod +x "$DIST/murmur"

echo "Build complete: dist/murmur"
