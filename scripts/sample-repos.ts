#!/usr/bin/env node

// Copyright 2021 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import chalk = require('chalk');
import * as yargs from 'yargs';
import * as fs from 'fs';
import * as path from 'path';

type RepoType = 'python' | 'node' | 'multi';

const typeFiles = {
  python: {
    'CHANGELOG.md': '',
    'setup.cfg': 'version=1.2.3\n',
    'setup.py': 'version=1.2.3\n',
    'version.py': '__version__=1.2.3\n',
  },
  node: {
    'CHANGELOG.md': '',
    'package.json': JSON.stringify({version: '1.2.3'}) + '\n',
  },
};

const argv = yargs
  .option('type', {
    describe: 'Should it be a monorepo?',
    type: 'string',
    choices: ['python', 'node', 'multi'],
    demandOption: true,
  })
  .option('count', {
    describe: 'How many packages (>1 signfies a monorepo)?',
    type: 'number',
    default: 1,
  })
  .option('root', {
    describe:
      'Directory in which to write repos, relative path will anchor from ' +
      'release-please repo root',
    type: 'string',
    default: 'sample-repos',
  })
  .strict(true)
  .parse();

function makeRepos() {
  const repoType = argv.type as RepoType;
  console.log(chalk.green(`creating ${argv.count} ${repoType} package repo`));
  const repoTypeDir = path.resolve(__dirname, '..', '..', argv.root, repoType);
  console.log(chalk.green(`creating ${repoTypeDir}`));
  if (!fs.existsSync(repoTypeDir)) {
    fs.mkdirSync(repoTypeDir, {recursive: true});
  }
  let useFiles: {[k: string]: {[k: string]: string}};
  if (repoType === 'multi') {
    useFiles = typeFiles;
  } else {
    useFiles = {[repoType]: typeFiles[repoType]};
  }
  for (const rt in useFiles) {
    let repoPath = repoTypeDir;
    if (repoType === 'multi') {
      repoPath = [repoPath, rt].join(path.sep);
      if (!fs.existsSync(repoPath)) {
        fs.mkdirSync(repoPath);
      }
    }
    if (argv.count === 1) {
      for (const fileName in useFiles[rt]) {
        fs.writeFileSync(
          [repoPath, fileName].join(path.sep),
          useFiles[rt][fileName]
        );
      }
    } else {
      for (let pkgNum of Array(argv.count).keys()) {
        pkgNum++;
        const packagePath = [repoPath, 'pkg' + pkgNum].join(path.sep);
        if (!fs.existsSync(packagePath)) {
          fs.mkdirSync(packagePath);
        }
        for (const fileName in useFiles[rt]) {
          fs.writeFileSync(
            [packagePath, fileName].join(path.sep),
            useFiles[rt][fileName]
          );
        }
      }
    }
  }
}
makeRepos();
