#!/bin/sh
# Runs once, on the first start of an empty MySQL volume.
# Tests always use a separate database; see README "Tests never touch dev data".
set -eu
mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS kuchu_puchu_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON kuchu_puchu_test.* TO '${MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
SQL
