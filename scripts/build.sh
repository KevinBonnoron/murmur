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
bun build --compile "$ROOT/src/main.ts" --outfile "$DIST/bin/murmur-bin"

echo "Copying native libraries..."
ONNX_DIR="$ROOT/node_modules/onnxruntime-node/bin/napi-v6/$OS/$ARCH"
cp "$ONNX_DIR"/libonnxruntime.* "$DIST/lib/"

# Copy CUDA/TensorRT provider libraries if available (downloaded by onnxruntime postinstall)
for f in "$ONNX_DIR"/libonnxruntime_providers_*.so; do
  [ -f "$f" ] && cp "$f" "$DIST/lib/" && echo "  Bundled $(basename "$f")"
done

SHARP_LIBVIPS_DIR="$ROOT/node_modules/@img/sharp-libvips-$OS-$ARCH/lib"
cp "$SHARP_LIBVIPS_DIR"/libvips-cpp.* "$DIST/lib/"

cp "$ROOT/node_modules/espeak-ng/dist/espeak-ng.wasm" "$DIST/lib/"

# Sharp uses a dynamic require(`@img/sharp-${platform}/sharp.node`) that bun
# cannot resolve at compile time. Ship the package so it can be found at runtime.
SHARP_PKG="@img/sharp-$OS-$ARCH"
mkdir -p "$DIST/node_modules/$SHARP_PKG/lib"
cp "$ROOT/node_modules/$SHARP_PKG/package.json" "$DIST/node_modules/$SHARP_PKG/"
cp "$ROOT/node_modules/$SHARP_PKG/lib/"*.node "$DIST/node_modules/$SHARP_PKG/lib/"

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
