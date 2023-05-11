#!/bin/bash

git clone https://github.com/zricethezav/gitleaks.git
cd gitleaks
make build
cd ..
./gitleaks/gitleaks detect --verbose
rm -rf gitleaks