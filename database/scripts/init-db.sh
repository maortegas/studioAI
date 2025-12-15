#!/bin/bash

# Script to initialize PostgreSQL database for DevFlow Studio

DB_NAME="${DB_NAME:-devflow_studio}"
DB_USER="${DB_USER:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

echo "Initializing database: $DB_NAME"

# Check if database exists
if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
    echo "Database $DB_NAME already exists"
else
    echo "Creating database $DB_NAME..."
    createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME"
fi

# Run migrations
echo "Running migrations..."
npm run migrate

echo "Database initialization complete!"

