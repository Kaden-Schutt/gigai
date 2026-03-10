#!/bin/sh
set -e
REPO="Kaden-Schutt/kon"
BIN="kon-linux-x64"
URL="https://github.com/$REPO/releases/latest/download/$BIN"
DEST="/usr/local/bin/kon"
curl -fsSL "$URL" -o "$DEST"
chmod +x "$DEST"
echo "kon installed to $DEST"
