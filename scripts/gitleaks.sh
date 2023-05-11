#!/bin/bash

git clone https://github.com/zricethezav/gitleaks.git
cd gitleaks
make build
cd ..
./gitleaks/gitleaks detect --baseline-path gitleaks-baseline.json --verbose
rm -rf gitleaks