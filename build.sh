#!/usr/bin/env bash
# Build Owlfin as a REAL, catalog-installable Jellyfin plugin, using jprm --
# the official Jellyfin Plugin Repository Manager (the same tool used by real
# plugin repos, and named in the plugin template docs).
#
# Requires: .NET SDK 9.0, and `pip install jprm --break-system-packages` (or a venv).
#
# Usage:
#   ./build.sh                                    builds dist/owlfin_<version>.zip (+ .meta.json)
#   ./build.sh --install                          builds AND drops it straight into
#                                                  $JELLYFIN_PLUGINS_DIR (default: /var/lib/jellyfin/plugins)
#                                                  -- fine for testing, but skips the repo/catalog UI
#   ./build.sh --repo http://<gitea-or-host>/path  builds AND writes/updates repo/manifest.json,
#                                                  pointing plugin URLs at the base URL you give it
#                                                  -- this is what you host and add as a Repository

set -euo pipefail

DIST_DIR="dist"
JELLYFIN_PLUGINS_DIR="${JELLYFIN_PLUGINS_DIR:-/var/lib/jellyfin/plugins}"

command -v jprm >/dev/null || {
    echo "jprm not found. Install it with: pip install jprm --break-system-packages" >&2
    exit 1
}

# Single source of truth for the version: build.yaml. Bump it there, nowhere else.
VERSION=$(python3 -c "import yaml; print(yaml.safe_load(open('build.yaml'))['version'])")

echo "==> Building Owlfin ${VERSION} with jprm (dotnet clean/restore/publish under the hood)..."
rm -rf "${DIST_DIR}"
ZIP_PATH=$(jprm plugin build . --output "${DIST_DIR}" --version "${VERSION}")
echo "==> Built: ${ZIP_PATH}"
echo "    (+ ${ZIP_PATH}.meta.json sidecar)"

case "${1:-}" in
    --install)
        TARGET="${JELLYFIN_PLUGINS_DIR}/Owlfin"
        echo "==> Installing to ${TARGET} (may need sudo)"
        mkdir -p "${TARGET}"
        python3 - "$ZIP_PATH" "$TARGET" << 'PYEOF'
import shutil, sys
shutil.unpack_archive(sys.argv[1], sys.argv[2], "zip")
PYEOF
        echo "==> Done. Restart Jellyfin: sudo systemctl restart jellyfin"
        ;;
    --repo)
        BASE_URL="${2:?Usage: ./build.sh --repo http://your-host/path}"
        REPO_DIR="repo"
        MANIFEST="${REPO_DIR}/manifest.json"
        mkdir -p "${REPO_DIR}"
        [[ -f "${MANIFEST}" ]] || jprm repo init "${MANIFEST}"
        jprm repo add "${MANIFEST}" "${ZIP_PATH}" --url "${BASE_URL}"
        echo "==> Wrote/updated ${MANIFEST}"
        echo "==> Commit and push the '${REPO_DIR}/' folder so that"
        echo "    ${BASE_URL}/manifest.json is reachable, e.g.:"
        echo "        git add repo/ && git commit -m 'Package ${VERSION}' && git push"
        echo "    Then in Jellyfin: Dashboard -> Plugins -> Repositories -> add"
        echo "        ${BASE_URL}/manifest.json"
        echo "    Catalog -> General -> Owlfin -> Install -> restart Jellyfin."
        ;;
esac
