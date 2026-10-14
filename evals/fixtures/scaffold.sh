#!/bin/bash
# Shared scaffold: copy fixture $1 into the empty workspace, commit it on main, and leave the case
# id inside .git, where the harness's hidden checks read it.
set -e
cp -r "$(dirname "$0")/$1/." .
git init -q -b main
git config user.name owner
git config user.email owner@example.com
git add -A
git commit -q -m "initial"
echo "$1" > .git/lpk-eval-case
