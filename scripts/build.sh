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
cd "${SCRIPT_DIR}" && MURMUR_LIB_DIR="${SCRIPT_DIR}/lib" LD_LIBRARY_PATH="${SCRIPT_DIR}/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" exec "${SCRIPT_DIR}/bin/murmur-bin" "$@"
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
