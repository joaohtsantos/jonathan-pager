#!/usr/bin/env bash
set -euo pipefail

# Send a push notification via Expo's push API
# Usage: ./send-push.sh <category> <title> <body>
# Categories: urgent, alert, info

TOKEN_FILE="$HOME/.jonathan-pager-token"

if [ $# -lt 3 ]; then
  echo "Usage: $0 <category> <title> <body>"
  echo "Categories: urgent, alert, info"
  exit 1
fi

CATEGORY="$1"
TITLE="$2"
BODY="$3"

# Validate category
case "$CATEGORY" in
  urgent|alert|info) ;;
  *)
    echo "Error: Invalid category '$CATEGORY'. Must be: urgent, alert, info"
    exit 1
    ;;
esac

# Read token
if [ ! -f "$TOKEN_FILE" ]; then
  echo "Error: Token file not found at $TOKEN_FILE"
  echo "Run the app on your device and copy the Expo push token to $TOKEN_FILE"
  exit 1
fi

PUSH_TOKEN=$(cat "$TOKEN_FILE" | tr -d '[:space:]')

if [ -z "$PUSH_TOKEN" ]; then
  echo "Error: Token file is empty"
  exit 1
fi

# Send via Expo push API
curl -s -X POST https://exp.host/--/api/v2/push/send \
  -H "Content-Type: application/json" \
  -d "$(cat <<EOF
{
  "to": "$PUSH_TOKEN",
  "title": "$TITLE",
  "body": "$BODY",
  "channelId": "$CATEGORY",
  "data": { "category": "$CATEGORY" },
  "priority": "high",
  "sound": "default"
}
EOF
)"

echo ""
echo "Sent $CATEGORY notification: $TITLE"
