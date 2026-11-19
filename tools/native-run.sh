#!/usr/bin/env bash
# Run native helpers in order against the isolated test vault, resetting the UI
# between them. Usage (Git Bash): bash tools/native-run.sh obsidian-smoke obsidian-interactions ...
# Writes artifacts/run-<helper>.log and artifacts/run-summary.txt.
cd "$(dirname "$0")/.." || exit 1
mkdir -p artifacts
: > artifacts/run-summary.txt
for name in "$@"; do
  timeout 60 node tools/native-reset.mjs > /dev/null 2>&1
  start=$(date +%s)
  timeout 900 node "tools/$name.mjs" > "artifacts/run-$name.log" 2>&1
  code=$?
  echo "$name exit=$code seconds=$(( $(date +%s) - start ))" >> artifacts/run-summary.txt
done
echo done >> artifacts/run-summary.txt
cat artifacts/run-summary.txt
