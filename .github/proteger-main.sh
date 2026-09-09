#!/usr/bin/env bash
#
# Protege la rama main del repositorio del equipo.
#
# Quien lo corre: hace falta permiso de ADMIN sobre el repositorio. Tener write
# no alcanza para cambiar la proteccion de una rama.
#
#   gh auth login          # una vez, con la cuenta que administra
#   ./.github/proteger-main.sh usuario/repositorio
#
# Sin argumento, protege Aselori/Hepsa, que es el repositorio de trabajo.
set -euo pipefail

REPO="${1:-Aselori/Hepsa}"

# Cuantas aprobaciones se exigen. Con varias personas en el repositorio, una es
# lo razonable. Con una sola hay que dejarlo en 0: GitHub no deja aprobar el
# propio pull request, asi que exigir una bloquearia todo el trabajo.
#
#   APROBACIONES=1 ./.github/proteger-main.sh Aselori/Hepsa
APROBACIONES="${APROBACIONES:-1}"

echo "Protegiendo main en $REPO (aprobaciones requeridas: $APROBACIONES)"

gh api -X PUT "repos/$REPO/branches/main/protection" --input - <<JSON
{
  "required_status_checks": { "strict": true, "contexts": ["Sintaxis y suites"] },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": $APROBACIONES
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true
}
JSON

# Ajustes del repositorio que acompanan a la proteccion.
gh api -X PATCH "repos/$REPO" \
  -F delete_branch_on_merge=true \
  -F allow_merge_commit=false \
  -F allow_squash_merge=true \
  -F allow_rebase_merge=true >/dev/null

echo
echo "Listo. Comprobacion:"
gh api "repos/$REPO/branches/main/protection" -q '
  "  pull request obligatorio:    " + (.required_pull_request_reviews != null | tostring)
+ "\n  aprobaciones requeridas:     " + (.required_pull_request_reviews.required_approving_review_count|tostring)
+ "\n  aplica a administradores:    " + (.enforce_admins.enabled|tostring)
+ "\n  historial lineal:            " + (.required_linear_history.enabled|tostring)
+ "\n  force push:                  " + (.allow_force_pushes.enabled|tostring)
+ "\n  borrado de main:             " + (.allow_deletions.enabled|tostring)'

echo
echo "Para comprobar que de verdad bloquea, intenta un push directo:"
echo "  git commit --allow-empty -m prueba && git push origin main"
echo "Debe responder: GH006 Protected branch update failed."
