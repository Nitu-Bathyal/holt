#!/bin/sh
# First start only: the paid-features service's own database (compose.pro.yml).
# An existing staging database needs it made once by hand (deploy/README.md).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c 'CREATE DATABASE holt_pro'
