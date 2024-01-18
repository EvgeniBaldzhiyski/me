#!/bin/bash

error_code=0

for file in $(git diff --diff-filter=d --staged --name-only | grep base-box | grep -E '\.(ts)$')
do
  node_modules/.bin/eslint -c .eslintrc.js "${file/base-box\//}"
  if [ $? -ne 0 ]; then
    error_code=1
  fi
done

echo '(base-box) linting completed.'

exit $error_code
