#!/usr/bin/env bash
# Created by The Angelo Umali.
# Spike 5: which flag stops claude -p loading user and project settings? One haiku turn per variant.
set -u
spike_dir="$(cd "$(dirname "$0")" && pwd)"
project_dir="$spike_dir/fixture/project"
mkdir -p "$spike_dir/results"

run_variant() {
  local name="$1"
  shift
  local env_prefix=()
  if [[ "${1:-}" == "--claudeai-mcp-off" ]]; then
    env_prefix=(env ENABLE_CLAUDEAI_MCP_SERVERS=false)
    shift
  fi
  # Project settings set outputStyle Explanatory, --settings sets Learning: init.output_style shows which loaded.
  (cd "$project_dir" && "${env_prefix[@]}" timeout 90 claude -p "Reply with one word: ready" --model haiku --max-turns 1 \
    --output-format stream-json --verbose --tools Read "$@" </dev/null 2>"$spike_dir/results/$name.stderr") |
    node "$spike_dir/summarise-init.mjs" "$name" >"$spike_dir/results/$name.json"
  echo "$name exit=${PIPESTATUS[0]}"
}

# claude.ai connectors attach asynchronously, so each variant runs twice to expose races.
for attempt in 1 2; do
  run_variant "default-$attempt"
  run_variant "setting-sources-empty-$attempt" --setting-sources ""
  run_variant "restricted-$attempt" --restricted
  run_variant "restricted-with-settings-$attempt" --restricted --settings "$spike_dir/fixture/flag-settings.json"
  run_variant "restricted-strict-mcp-$attempt" --restricted --strict-mcp-config --mcp-config '{"mcpServers":{}}'
  run_variant "restricted-claudeai-mcp-off-$attempt" --claudeai-mcp-off --restricted
done
