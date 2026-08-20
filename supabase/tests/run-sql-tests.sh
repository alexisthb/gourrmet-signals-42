#!/usr/bin/env bash
# Banc d'essai SQL local pour Gourrmet.
#
# Applique la chaîne complète des migrations sur un PostgreSQL éphémère, la
# REJOUE pour vérifier la rejouabilité, puis exécute les tests de contrat.
#
# Pourquoi : jusqu'ici aucun PostgreSQL n'avait jamais exécuté ces migrations.
# La première exécution a révélé trois échecs bloquants (une parenthèse
# manquante dans `configure_gourrmet_runtime_crons`, un CASE non parenthésé
# dans une condition IF de `claim_press_scan`, et l'échec en cascade qui en
# découlait) qui auraient interrompu le cutover live en plein milieu.
#
# Usage :  bash supabase/tests/run-sql-tests.sh
# Prérequis : binaires PostgreSQL (testé avec 16.13) et un utilisateur non-root
# nommé `pgtest` (initdb refuse de tourner en root).
#
# LIMITES ASSUMÉES — ce banc n'est pas un clone de la production :
#   - pg_cron, pg_net, pgmq et supabase_vault n'existent pas ici : leurs
#     `CREATE EXTENSION` sont neutralisés et remplacés par des doublures
#     (00_supabase_bootstrap.sql). Aucun comportement runtime de ces
#     extensions n'est donc validé — uniquement le SQL qui les utilise.
#   - la production tourne sur PostgreSQL 17.x, ce banc sur 16.x.
#   - les migrations héritées d'avant le chantier (2025-12 à 2026-02) ne sont
#     pas idempotentes et échouent au rejeu : c'est attendu et hors périmètre,
#     elles sont déjà appliquées en production. Seules les migrations
#     `20260820*` doivent passer les deux passes.
set -uo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
WORK="${WORK:-/home/pgtest/sqltest}"
PGDATA="$WORK/pgdata"
SOCK="$WORK/sock"
PREP="$WORK/prepared"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TESTS="$REPO/supabase/tests"

export PGHOST="$SOCK" PGUSER=postgres

id pgtest >/dev/null 2>&1 || useradd -m pgtest
mkdir -p "$WORK" "$SOCK"; chown -R pgtest "$WORK"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  su pgtest -c "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust -E UTF8" \
    >"$WORK/initdb.log" 2>&1 || { echo "initdb a échoué"; tail -20 "$WORK/initdb.log"; exit 1; }
fi

su pgtest -c "$PGBIN/pg_ctl -D $PGDATA -l $WORK/pg.log -o \"-k $SOCK -c listen_addresses='' -c check_function_bodies=on\" -w start" \
  >/dev/null 2>&1
"$PGBIN/pg_isready" -h "$SOCK" -U postgres >/dev/null 2>&1 \
  || { echo "PostgreSQL ne démarre pas"; tail -25 "$WORK/pg.log"; exit 1; }

rm -rf "$PREP"; mkdir -p "$PREP"
for f in "$REPO"/supabase/migrations/*.sql; do
  sed -E 's/^([[:space:]]*)(CREATE EXTENSION[^;]*(pg_cron|pg_net|pgmq|supabase_vault)[^;]*;)/\1-- [banc local] \2/I' \
    "$f" > "$PREP/$(basename "$f")"
done

dropdb --if-exists gourrmet >/dev/null 2>&1
createdb gourrmet
psql -q -v ON_ERROR_STOP=1 -d gourrmet -f "$TESTS/00_supabase_bootstrap.sql" >/dev/null

rc=0
run_pass() {
  local label="$1" ok=0 legacy=0 chantier=0
  for f in "$PREP"/*.sql; do
    local name out; name=$(basename "$f")
    if out=$(psql -d gourrmet -v ON_ERROR_STOP=1 --single-transaction -q -f "$f" 2>&1); then
      ok=$((ok+1))
    else
      case "$name" in
        20260820*)
          chantier=$((chantier+1))
          echo "  ECHEC (chantier) $name"
          echo "$out" | grep -E 'ERROR|HINT' | head -2 | sed 's/^/      /'
          ;;
        *) legacy=$((legacy+1)) ;;
      esac
    fi
  done
  echo "$label : $ok appliquées | échecs chantier: $chantier | échecs hérités (attendus): $legacy"
  [ "$chantier" -eq 0 ] || rc=1
}

run_pass "PASSE 1 (base vierge)"
run_pass "PASSE 2 (rejeu)"

echo "--- tests de contrat ---"
for t in "$TESTS"/[0-9][0-9]_*.sql; do
  case "$(basename "$t")" in 00_*) continue ;; esac
  if out=$(psql -d gourrmet -v ON_ERROR_STOP=1 -f "$t" 2>&1); then
    echo "  OK   $(basename "$t")"
  else
    rc=1
    echo "  ECHEC $(basename "$t")"
    echo "$out" | grep -E 'ERROR' | head -3 | sed 's/^/      /'
  fi
done

echo "======================================================"
[ $rc -eq 0 ] && echo "BANC SQL : VERT" || echo "BANC SQL : ROUGE"
exit $rc
