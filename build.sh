#!/bin/bash
# Build PhuketAI.apk without Gradle:
#   aapt2 (arm64, from Termux) -> javac -> d8 -> apksigner
set -e

ROOT=/root/workspace/pukit
APP=$ROOT/app
OUT=$ROOT/build
A2LIB=$ROOT/tux/data/data/com.termux/files/usr/lib
A2BIN=$ROOT/tux/data/data/com.termux/files/usr/bin/aapt2
AAPT2() { LD_LIBRARY_PATH="$A2LIB" "$A2BIN" "$@" 2>/dev/null; }
BT=$ROOT/bt35/android-15/lib
ANDROID_JAR=$(find $ROOT/plat35 -name android.jar | head -1)

if [ ! -f "$ANDROID_JAR" ]; then
  echo "missing android.jar"; exit 1
fi

echo "==> aapt2 compile"
rm -rf "$OUT/classes" "$OUT/dex" "$OUT/gen" "$OUT/base.apk" "$OUT/PhuketAI.apk"
mkdir -p "$OUT/classes" "$OUT/dex" "$OUT/gen"
AAPT2 compile --dir "$APP/res" -o "$OUT/res.zip"

echo "==> aapt2 link"
AAPT2 link -o "$OUT/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$APP/AndroidManifest.xml" \
  "$OUT/res.zip" \
  -A "$APP/assets" \
  --java "$OUT/gen" \
  --min-sdk-version 23 \
  --target-sdk-version 34 \
  --version-code 4 \
  --version-name 1.0.3

echo "==> javac"
javac -encoding UTF-8 -source 8 -target 8 -nowarn \
  -classpath "$ANDROID_JAR" -d "$OUT/classes" \
  $(find "$APP/src" "$OUT/gen" -name '*.java') 2>&1 | grep -v 'bootstrap class path' || true

if [ ! -f "$OUT/classes/com/phuketai/app/MainActivity.class" ]; then
  echo "javac failed"; exit 1
fi

echo "==> d8"
jar cf "$OUT/classes.jar" -C "$OUT/classes" .
java -cp "$BT/d8.jar" com.android.tools.r8.D8 \
  --release --min-api 23 --lib "$ANDROID_JAR" \
  --output "$OUT/dex" "$OUT/classes.jar"

echo "==> package dex"
python3 - "$OUT/base.apk" "$OUT/dex/classes.dex" <<'PY'
import shutil, sys, zipfile, os
apk, dex = sys.argv[1], sys.argv[2]
tmp = apk + '.tmp'
with zipfile.ZipFile(apk) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        if item.filename == 'classes.dex':
            continue
        zout.writestr(item, zin.read(item.filename))
    zout.write(dex, 'classes.dex')
shutil.move(tmp, apk)
print('  classes.dex added (%d bytes)' % os.path.getsize(dex))
PY

echo "==> sign"
if [ ! -f "$ROOT/keystore.jks" ]; then
  keytool -genkeypair -v -keystore "$ROOT/keystore.jks" -alias phuketai \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass phuketai2026 -keypass phuketai2026 \
    -dname "CN=PhuketAI, OU=App, O=PhuketAI, L=Hunan, C=CN" >/dev/null 2>&1
fi

java -jar "$BT/apksigner.jar" sign \
  --ks "$ROOT/keystore.jks" --ks-pass pass:phuketai2026 --key-pass pass:phuketai2026 \
  --ks-key-alias phuketai --min-sdk-version 23 \
  --out "$OUT/PhuketAI.apk" "$OUT/base.apk"

java -jar "$BT/apksigner.jar" verify --min-sdk-version 23 "$OUT/PhuketAI.apk"
ls -lh "$OUT/PhuketAI.apk"
echo "BUILD OK"
